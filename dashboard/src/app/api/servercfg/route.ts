import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readFile, writeFile, copyFile, rename, stat } from 'fs/promises'
import { dirname, basename } from 'path'
import { promisify } from 'util'
import { STATE_DIR, verifyAuth } from '@/lib/panel'
import { findServerCfg, restartServer } from '@/lib/server-control'

export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const PANEL_CFG = `${STATE_DIR}/panel.cfg`
const MAX_SIZE = 512 * 1024

type CfgId = 'repo' | 'panel'

async function resolve(id: CfgId) {
  if (id === 'panel') return existsSync(PANEL_CFG) ? PANEL_CFG : null
  return findServerCfg()
}

/** Alterado localmente em relação ao último commit? (o sync pode conflitar/sobrescrever) */
async function gitDirty(path: string) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dirname(path), 'status', '--porcelain', '--', basename(path)])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function describe(id: CfgId) {
  const path = await resolve(id)
  if (!path) return null
  const st = await stat(path)
  return {
    id,
    path,
    content: await readFile(path, 'utf8'),
    mtime: st.mtimeMs,
    dirty: id === 'repo' ? await gitDirty(path) : false,
  }
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }
  const files = (await Promise.all([describe('repo'), describe('panel')])).filter(Boolean)
  if (files.length === 0) {
    return NextResponse.json({ success: false, message: 'Nenhum server.cfg encontrado. O repositório já foi sincronizado?' }, { status: 404 })
  }
  return NextResponse.json({ success: true, files })
}

export async function PUT(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const id = body.id as CfgId
  const content = body.content
  if ((id !== 'repo' && id !== 'panel') || typeof content !== 'string') {
    return NextResponse.json({ success: false, message: 'Requisição inválida.' }, { status: 400 })
  }
  if (Buffer.byteLength(content) > MAX_SIZE) {
    return NextResponse.json({ success: false, message: 'Arquivo grande demais.' }, { status: 400 })
  }

  const path = await resolve(id)
  if (!path) return NextResponse.json({ success: false, message: 'Arquivo não encontrado.' }, { status: 404 })

  // Evita sobrescrever uma mudança feita por outra pessoa/sync desde que a página abriu.
  const current = await stat(path)
  if (typeof body.mtime === 'number' && Math.abs(current.mtimeMs - body.mtime) > 1) {
    return NextResponse.json({
      success: false,
      conflict: true,
      message: 'O arquivo mudou no servidor depois que você abriu (sync ou outra edição). Recarregue antes de salvar.',
    }, { status: 409 })
  }

  await copyFile(path, `${path}.bak`)
  const tmp = `${path}.saving`
  await writeFile(tmp, content.endsWith('\n') ? content : content + '\n', { mode: id === 'panel' ? 0o600 : 0o644 })
  await rename(tmp, path)

  let restarted = false
  if (body.restart === true) {
    try {
      await restartServer()
      restarted = true
    } catch (e: any) {
      return NextResponse.json({ success: true, restarted: false, message: `Salvo, mas o restart falhou: ${e.message}` })
    }
  }

  const saved = await describe(id)
  return NextResponse.json({ success: true, restarted, mtime: saved?.mtime, dirty: saved?.dirty })
}
