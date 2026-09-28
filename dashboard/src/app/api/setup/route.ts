import { NextRequest, NextResponse } from 'next/server'
import { spawn, execFile } from 'child_process'
import { openSync, closeSync, existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import {
  DASHBOARD_ENV, PROVISION_LOG, PROVISION_STATE, PANEL_DIR,
  verifyAuth, isSetupMode, checkSetupToken, updateEnvFile, parseGithubRepo,
} from '@/lib/panel'

export const dynamic = 'force-dynamic'

type DbInput = { host?: string; port?: string; user?: string; password?: string; name?: string }
type SetupBody = {
  setupToken?: string
  password?: string
  gitRepo?: string
  gitBranch?: string
  gitToken?: string
  serverMode?: 'txadmin' | 'direct'
  licenseKey?: string
  db?: DbInput
}

async function provisionState() {
  try {
    return (await readFile(PROVISION_STATE, 'utf8')).trim()
  } catch {
    return 'idle'
  }
}

/** Hash bcrypt para a conta master do txAdmin (TXHOST_DEFAULT_ACCOUNT). */
function bcrypt(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('htpasswd', ['-niBC', '10', 'admin'], (err, stdout) => {
      if (err) return reject(err)
      // htpasswd gera $2y$; bcryptjs (txAdmin) aceita $2a$, que é equivalente.
      resolve(stdout.trim().split(':')[1].replace(/^\$2y\$/, '$2a$'))
    })
    child.stdin?.end(password)
  })
}

async function checkGithub(owner: string, repo: string, token: string, branch: string) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sindicato-panel',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, cache: 'no-store' })
  if (res.status === 401) return { error: 'Token do GitHub inválido ou expirado.' }
  if (res.status === 404) return { error: `Repositório ${owner}/${repo} não encontrado ou o token não tem acesso a ele.` }
  if (!res.ok) return { error: `GitHub respondeu ${res.status} ao consultar o repositório.` }
  const info = await res.json()
  const useBranch = branch || info.default_branch
  const br = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(useBranch)}`, { headers, cache: 'no-store' })
  if (!br.ok) return { error: `Branch "${useBranch}" não existe em ${owner}/${repo}.` }
  return { branch: useBranch as string }
}

function mysqlUrl(db: Required<DbInput>) {
  const enc = encodeURIComponent
  return `mysql://${enc(db.user)}:${enc(db.password)}@${db.host}:${db.port}/${enc(db.name)}?charset=utf8mb4`
}

export async function GET(request: NextRequest) {
  const authed = await verifyAuth(request)
  return NextResponse.json({
    setupMode: isSetupMode(),
    // Instalação feita pelo install.sh (tem provision.sh e dashboard.env)
    managed: existsSync(DASHBOARD_ENV),
    state: await provisionState(),
    current: authed ? {
      gitRepo: process.env.GIT_REPO || '',
      gitBranch: process.env.GIT_BRANCH || 'main',
      hasToken: !!process.env.GIT_TOKEN,
      hasLicense: !!process.env.SV_LICENSEKEY,
      serverMode: process.env.SERVER_MODE || 'txadmin',
      db: { host: process.env.DB_HOST || '', port: process.env.DB_PORT || '3306', user: process.env.DB_USER || '', name: process.env.DB_NAME || '' },
    } : null,
  })
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as SetupBody
  const authed = await verifyAuth(request)
  const setup = isSetupMode() && checkSetupToken(body.setupToken)
  if (!authed && !setup) {
    return NextResponse.json({ success: false, message: 'Link de instalação inválido ou sessão expirada.' }, { status: 401 })
  }
  if (!existsSync(DASHBOARD_ENV)) {
    return NextResponse.json({ success: false, message: 'Este servidor não foi instalado pelo install.sh; a instalação automática não está disponível.' }, { status: 400 })
  }
  if ((await provisionState()) === 'running') {
    return NextResponse.json({ success: false, message: 'Já existe uma instalação em andamento.' }, { status: 409 })
  }

  const password = body.password?.trim() || ''
  if (setup && password.length < 8) {
    return NextResponse.json({ success: false, message: 'A senha do painel precisa ter pelo menos 8 caracteres.' }, { status: 400 })
  }
  const parsed = parseGithubRepo(body.gitRepo || '')
  if (!parsed) {
    return NextResponse.json({ success: false, message: 'Repositório inválido. Use https://github.com/dono/repo.' }, { status: 400 })
  }

  // Ao reconfigurar logado, campo vazio = manter o valor atual.
  const keep = (v: string | undefined, current: string | undefined) => v?.trim() || (authed ? current || '' : '')
  const gitToken = keep(body.gitToken, process.env.GIT_TOKEN)
  const licenseKey = keep(body.licenseKey, process.env.SV_LICENSEKEY)
  if (licenseKey && !/^cfxk_[A-Za-z0-9_]+$/.test(licenseKey)) {
    return NextResponse.json({ success: false, message: 'License key deve começar com cfxk_.' }, { status: 400 })
  }

  const gh = await checkGithub(parsed.owner, parsed.repo, gitToken, body.gitBranch?.trim() || '')
  if ('error' in gh) {
    return NextResponse.json({ success: false, message: gh.error }, { status: 400 })
  }

  const serverMode = body.serverMode === 'direct' ? 'direct' : 'txadmin'

  const input = body.db || {}
  const db: Required<DbInput> = {
    host: keep(input.host, process.env.DB_HOST),
    port: input.port?.trim() || (authed && process.env.DB_PORT) || '3306',
    user: keep(input.user, process.env.DB_USER),
    password: input.password || (authed ? process.env.DB_PASSWORD || '' : ''),
    name: keep(input.name, process.env.DB_NAME),
  }
  if (db.host && (!db.user || !db.name)) {
    return NextResponse.json({ success: false, message: 'Para o banco, informe pelo menos host, usuário e nome do banco.' }, { status: 400 })
  }
  const mysql = db.host ? mysqlUrl(db) : ''

  const gitRepo = `https://github.com/${parsed.owner}/${parsed.repo}`
  const envUpdate: Record<string, string | null> = {
    GIT_REPO: gitRepo,
    GIT_BRANCH: gh.branch,
    GIT_TOKEN: gitToken,
    SERVER_MODE: serverMode,
    SV_LICENSEKEY: licenseKey || null,
    SETUP_TOKEN: null,
  }
  if (password) envUpdate.DASHBOARD_PASSWORD = password
  if (db.host) {
    Object.assign(envUpdate, { DB_HOST: db.host, DB_PORT: db.port, DB_USER: db.user, DB_PASSWORD: db.password, DB_NAME: db.name })
  }

  let txadminAccount = ''
  if (serverMode === 'txadmin' && password) {
    try {
      txadminAccount = `admin::${await bcrypt(password)}`
    } catch {
      // Sem htpasswd o txAdmin pede o PIN no primeiro acesso; não é fatal.
    }
  }

  try {
    await updateEnvFile(DASHBOARD_ENV, envUpdate)
  } catch (e: any) {
    return NextResponse.json({ success: false, message: `Não consegui salvar a configuração: ${e.message}` }, { status: 500 })
  }

  // Marca antes de disparar para o assistente não ler um 'done' de uma execução anterior.
  await writeFile(PROVISION_STATE, 'running\n')
  const out = openSync(PROVISION_LOG, 'w')
  const child = spawn('bash', [`${PANEL_DIR}/installer/provision.sh`], {
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/fivem',
      DATA_DIR: process.env.DATA_DIR || '/home/fivem/server-data',
      GIT_REPO: gitRepo,
      GIT_BRANCH: gh.branch,
      GIT_TOKEN: gitToken,
      SERVER_MODE: serverMode,
      SV_LICENSEKEY: licenseKey,
      MYSQL_CONNECTION_STRING: mysql,
      TXADMIN_ACCOUNT: txadminAccount,
      // Senha/token novos só valem no processo do painel depois de reiniciar.
      RESTART_DASHBOARD: '1',
    },
  })
  child.unref()
  closeSync(out)

  return NextResponse.json({ success: true, branch: gh.branch })
}
