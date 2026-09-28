import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { open, stat } from 'fs/promises'
import { STATE_DIR, TX_DATA, readEnvFile, verifyAuth } from '@/lib/panel'
import { findTxData, isServerRunning } from '@/lib/server-control'

export const dynamic = 'force-dynamic'

const SERVER_LOG = '/var/log/fivem/server.log'
// O PIN sai no boot do txAdmin; o fim do log basta.
const TAIL_BYTES = 2 * 1024 * 1024

async function tail(path: string, bytes: number) {
  const { size } = await stat(path)
  const start = Math.max(0, size - bytes)
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

/**
 * Último PIN impresso pelo txAdmin. Formatos (core/boot/startReadyWatcher.ts
 * e core/modules/AdminStore do txAdmin):
 *   "Use the PIN below to register:" + PIN na linha seguinte (dentro de um box)
 *   "Use this PIN to add a new master account: 1234"
 */
function findPin(log: string): string | null {
  // Remove cores ANSI e as bordas do box.
  const lines = log.replace(/\x1b\[[0-9;]*m/g, '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const inline = lines[i].match(/add a new master account:\s*(\d{4})\b/)
    if (inline) return inline[1]
    if (lines[i].includes('Use the PIN below to register')) {
      for (const next of lines.slice(i + 1, i + 4)) {
        const m = next.match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/)
        if (m) return m[1]
      }
    }
  }
  return null
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  const env = await readEnvFile(`${STATE_DIR}/server.env`)
  const mode = env.SERVER_MODE || process.env.SERVER_MODE || 'txadmin'
  const txData = (await findTxData())?.txData || env.TXDATA_DIR || TX_DATA
  // Com admins.json existe pelo menos um admin: o PIN não serve mais.
  const hasAdmin = existsSync(`${txData}/admins.json`)

  let pin: string | null = null
  if (mode === 'txadmin' && !hasAdmin && existsSync(SERVER_LOG)) {
    try {
      pin = findPin(await tail(SERVER_LOG, TAIL_BYTES))
    } catch { /* log ilegível: sem PIN */ }
  }

  return NextResponse.json({
    success: true,
    mode,
    port: env.TXADMIN_PORT || '40120',
    running: await isServerRunning(),
    hasAdmin,
    pin,
    // O que o assistente "Existing Server Data" do txAdmin pede
    serverData: env.SERVER_DATA || null,
    cfgPath: env.PANEL_CFG || null,
  })
}
