import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const TX_DATA = '/home/fivem/txData'
const LOG_DIR = '/var/log/fivem'

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

function getLogFiles(): string[] {
  const searchPaths = [
    join(LOG_DIR, 'server.log'),
    join(TX_DATA, 'default', 'FXServer.log'),
    join(TX_DATA, 'default', 'citizen.log'),
    join(TX_DATA, 'default', 'server.log'),
    join(TX_DATA, 'default', 'console.log'),
    join(TX_DATA, 'default.log'),
  ]

  return searchPaths.filter(p => existsSync(p))
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(data))
      }

      send(`data: ${JSON.stringify({ type: 'system', message: 'Conectado ao stream de logs...\n' })}\n\n`)

      const logFiles = getLogFiles()

      if (logFiles.length === 0) {
        send(`data: ${JSON.stringify({ type: 'system', message: 'Nenhum arquivo de log encontrado em /var/log/fivem/ ou /home/fivem/txData/.Logs serão exibidos quando o servidor gerar.\n' })}\n\n`)
        controller.close()
        return
      }

      send(`data: ${JSON.stringify({ type: 'system', message: `Monitorando: ${logFiles.join(', ')}\n` })}\n\n`)

      const tails: any[] = []

      try {
        for (const logFile of logFiles) {
          const tail = spawn('tail', ['-f', '-n', '100', logFile])

          tail.stdout.on('data', (data: Buffer) => {
            send(`data: ${JSON.stringify({ type: 'stdout', message: `[${logFile.split('/').pop()}] ${data.toString()}` })}\n\n`)
          })

          tail.stderr.on('data', (data: Buffer) => {
            send(`data: ${JSON.stringify({ type: 'stderr', message: data.toString() })}\n\n`)
          })

          tails.push(tail)
        }

        const interval = setInterval(() => {
          send(`data: ${JSON.stringify({ type: 'system', message: '' })}\n\n`)
        }, 30000)

        const cleanup = () => {
          clearInterval(interval)
          tails.forEach(t => t.kill())
          send(`data: ${JSON.stringify({ type: 'system', message: '\n[Stream encerrado]\n' })}\n\n`)
          controller.close()
        }

        request.signal.addEventListener('abort', cleanup)

      } catch (error: any) {
        send(`data: ${JSON.stringify({ type: 'error', message: `Erro ao iniciar stream: ${error.message}\n` })}\n\n`)
        controller.close()
      }
    },
    cancel() { }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
