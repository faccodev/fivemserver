import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/panel'
import { isServerRunning, restartServer, usesSystemd } from '@/lib/server-control'

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  try {
    console.log(`[RESTART] Restarting FiveM server via ${usesSystemd() ? 'systemd' : 'screen'}...`)
    await restartServer()

    // Aguarda start
    await new Promise(r => setTimeout(r, 3000))
    const running = await isServerRunning()

    return NextResponse.json({
      success: true,
      message: running ? 'Servidor FiveM reiniciado com sucesso' : 'Servidor pode não ter iniciado corretamente',
    })
  } catch (error: any) {
    console.error('[RESTART ERROR]', error)
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao reiniciar servidor'
    }, { status: 500 })
  }
}
