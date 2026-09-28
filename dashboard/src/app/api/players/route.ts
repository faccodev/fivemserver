import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { readFile, writeFile, copyFile, rename, stat, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { TX_DATA, verifyAuth } from '@/lib/panel'
import { findTxData, isServerRunning, startServer, stopServer } from '@/lib/server-control'

export const dynamic = 'force-dynamic'

// Arquivos do txAdmin (confirmados no código-fonte do txAdmin v8):
//   <txData>/<perfil>/data/playersDB.json  jogadores, bans/warns, whitelist
//   <txData>/admins.json                   contas de admin do txAdmin
type Kind = 'players' | 'admins'

async function paths() {
  const found = await findTxData()
  const txData = found?.txData || TX_DATA
  const profile = found?.profile || 'default'
  return {
    players: `${txData}/${profile}/data/playersDB.json`,
    admins: `${txData}/admins.json`,
  }
}

function validate(kind: Kind, data: any): string | null {
  if (kind === 'players') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'O arquivo não é um playersDB.json (esperado um objeto).'
    if (typeof data.version !== 'number') return 'playersDB.json sem o campo "version".'
    if (!Array.isArray(data.players)) return 'playersDB.json sem a lista "players".'
    return null
  }
  if (!Array.isArray(data)) return 'O arquivo não é um admins.json (esperado uma lista).'
  if (!data.every(a => a && typeof a.name === 'string' && Array.isArray(a.permissions))) {
    return 'admins.json inválido: cada admin precisa de "name" e "permissions".'
  }
  if (!data.some(a => a.master === true)) return 'admins.json sem nenhuma conta master; o txAdmin ficaria inacessível.'
  return null
}

function summarize(kind: Kind, data: any) {
  if (kind === 'players') {
    return {
      players: data.players?.length ?? 0,
      actions: data.actions?.length ?? 0,
      whitelist: data.whitelistApprovals?.length ?? 0,
      version: data.version,
    }
  }
  return { admins: data.length }
}

async function describe(kind: Kind, path: string) {
  if (!existsSync(path)) return { path, exists: false }
  const st = await stat(path)
  try {
    const data = JSON.parse(await readFile(path, 'utf8'))
    return { path, exists: true, size: st.size, modified: st.mtime.toISOString(), ...summarize(kind, data) }
  } catch {
    return { path, exists: true, size: st.size, modified: st.mtime.toISOString(), corrupt: true }
  }
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }
  const p = await paths()
  const download = request.nextUrl.searchParams.get('download') as Kind | null

  if (download === 'players' || download === 'admins') {
    if (!existsSync(p[download])) {
      return NextResponse.json({ success: false, message: 'Arquivo não encontrado.' }, { status: 404 })
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const name = download === 'players' ? `playersDB-${stamp}.json` : `admins-${stamp}.json`
    return new NextResponse(await readFile(p[download]), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({
    success: true,
    running: await isServerRunning(),
    players: await describe('players', p.players),
    admins: await describe('admins', p.admins),
  })
}

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  const kind = form?.get('kind') as Kind | null
  const file = form?.get('file')
  if ((kind !== 'players' && kind !== 'admins') || !(file instanceof Blob)) {
    return NextResponse.json({ success: false, message: 'Envie o arquivo e o tipo (players ou admins).' }, { status: 400 })
  }

  const text = await file.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return NextResponse.json({ success: false, message: 'O arquivo não é um JSON válido.' }, { status: 400 })
  }
  const invalid = validate(kind, data)
  if (invalid) return NextResponse.json({ success: false, message: invalid }, { status: 400 })

  const target = (await paths())[kind]
  const wasRunning = await isServerRunning()
  const log: string[] = []

  try {
    // O txAdmin mantém o banco em memória e grava periodicamente: com o
    // servidor ligado, o arquivo importado seria sobrescrito.
    if (wasRunning) {
      await stopServer()
      log.push('Servidor parado.')
    }

    await mkdir(dirname(target), { recursive: true })
    let backup: string | null = null
    if (existsSync(target)) {
      backup = target.replace(/\.json$/, `.before-import-${Date.now()}.json`)
      await copyFile(target, backup)
      log.push(`Backup do atual: ${backup}`)
    }

    const tmp = `${target}.importing`
    await writeFile(tmp, text)
    await rename(tmp, target)
    log.push(`Importado para ${target}.`)

    if (wasRunning) {
      await startServer()
      log.push('Servidor iniciado novamente.')
    }

    return NextResponse.json({ success: true, backup, log, ...summarize(kind, data) })
  } catch (e: any) {
    // Não deixa o servidor desligado por causa de uma falha no meio.
    if (wasRunning) await startServer().catch(() => {})
    return NextResponse.json({ success: false, message: `Falha ao importar: ${e.message}`, log }, { status: 500 })
  }
}
