import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const TX_DATA = '/home/fivem/txData'

async function verifyAuth(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  if (!token) return false

  try {
    const { jwtVerify } = await import('jose')
    const JWT_SECRET = process.env.DASHBOARD_PASSWORD?.slice(0, 32).padEnd(32, '0') || 'default-secret-key-minimum-32-chars'
    const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET))
    return payload.authenticated === true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  try {
    const cleanCommands = [
      // txData cache
      `rm -rf ${TX_DATA}/cache/* 2>/dev/null || true`,
      `rm -rf ${TX_DATA}/citizen/* 2>/dev/null || true`,
      // txData logs (old ones)
      `find ${TX_DATA} -name "*.log" -mtime +3 -delete 2>/dev/null || true`,
      // Resources cache
      `rm -rf ${DATA_DIR}/resources/*/cache/* 2>/dev/null || true`,
      // Backup files
      `find /opt/backups -name "*.gz" -mtime +7 -delete 2>/dev/null || true`,
    ]

    for (const cmd of cleanCommands) {
      await execAsync(cmd)
    }

    return NextResponse.json({
      success: true,
      message: 'Cache e artifacts limpos com sucesso'
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao limpar cache'
    }, { status: 500 })
  }
}
