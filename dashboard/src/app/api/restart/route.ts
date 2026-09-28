import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
    console.log('[RESTART] Restarting FiveM server via screen...')

    // Para processo existente se houver
    await execAsync('pkill -f "ld-musl-x86_64.*fx" 2>/dev/null || true', { timeout: 10000 })
    await execAsync('screen -S fivem -X kill 2>/dev/null || true', { timeout: 5000 })

    // Limpa qualquer resíduo
    await execAsync('pkill -9 -f "fivem-server\|cfx-server\|FXServer" 2>/dev/null || true', { timeout: 5000 })

    // Inicia em screen
    await execAsync('cd /home/fivem/server && screen -dmS fivem bash run.sh', { timeout: 10000 })

    // Aguarda start
    await new Promise(r => setTimeout(r, 3000))

    // Verifica se subiu
    const { stdout } = await execAsync('screen -ls | grep fivem || echo "not running"', { timeout: 5000 })

    return NextResponse.json({
      success: true,
      message: stdout.includes('fivem') ? 'Servidor FiveM reiniciado com sucesso' : 'Servidor pode não ter iniciado corretamente',
      screenStatus: stdout.trim()
    })
  } catch (error: any) {
    console.error('[RESTART ERROR]', error)
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao reiniciar servidor'
    }, { status: 500 })
  }
}