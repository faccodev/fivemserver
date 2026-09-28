import { NextRequest } from 'next/server'
import { readFile, writeFile, rename } from 'fs/promises'
import { timingSafeEqual } from 'crypto'

// Layout criado pelo install.sh. Instalações antigas (sem install.sh) só usam
// as variáveis de ambiente e nunca entram em modo de instalação.
export const FIVEM_HOME = '/home/fivem'
export const STATE_DIR = `${FIVEM_HOME}/.panel`
export const DASHBOARD_ENV = `${STATE_DIR}/dashboard.env`
export const PROVISION_LOG = `${STATE_DIR}/provision.log`
export const PROVISION_STATE = `${STATE_DIR}/provision.state`
export const PANEL_DIR = process.env.PANEL_DIR || `${FIVEM_HOME}/panel`
export const TX_DATA = process.env.TXDATA_DIR || `${FIVEM_HOME}/txData`

export async function verifyAuth(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  if (!token || !process.env.DASHBOARD_PASSWORD) return false
  try {
    const { jwtVerify } = await import('jose')
    const JWT_SECRET = process.env.DASHBOARD_PASSWORD.slice(0, 32).padEnd(32, '0')
    const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET))
    return payload.authenticated === true
  } catch {
    return false
  }
}

/** Instalação nova: install.sh gerou um SETUP_TOKEN e ninguém definiu senha ainda. */
export function isSetupMode() {
  return !process.env.DASHBOARD_PASSWORD && !!process.env.SETUP_TOKEN
}

export function checkSetupToken(provided: string | null | undefined) {
  const expected = process.env.SETUP_TOKEN
  if (!expected || !provided) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Formato lido pelo systemd (EnvironmentFile): KEY="valor", com \ e " escapados.
function quote(value: string) {
  if (/[\r\n]/.test(value)) throw new Error('Valores não podem ter quebra de linha')
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function unquote(raw: string) {
  const m = raw.match(/^"(.*)"$/)
  return m ? m[1].replace(/\\(["\\])/g, '$1') : raw
}

export async function readEnvFile(file: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = unquote(m[2])
  }
  return out
}

/** Mescla `values` no arquivo; chaves com valor `null` são removidas. */
export async function updateEnvFile(file: string, values: Record<string, string | null>) {
  const current = await readEnvFile(file)
  for (const [k, v] of Object.entries(values)) {
    if (v === null) delete current[k]
    else current[k] = v
  }
  const body = ['# Gerenciado pelo painel. Edite com cuidado.']
    .concat(Object.entries(current).map(([k, v]) => `${k}=${quote(v)}`))
    .join('\n') + '\n'
  const tmp = `${file}.tmp`
  await writeFile(tmp, body, { mode: 0o600 })
  await rename(tmp, file)
}

/** Aceita "dono/repo", URL https (com ou sem .git) ou git@github.com:dono/repo. */
export function parseGithubRepo(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const m =
    s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)$/i) ||
    s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+)$/i) ||
    s.match(/^([\w.-]+)\/([\w.-]+)$/)
  return m ? { owner: m[1], repo: m[2] } : null
}
