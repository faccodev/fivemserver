import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { execFile } from 'child_process'
import { PROVISION_LOG, PROVISION_STATE, verifyAuth, isSetupMode, checkSetupToken } from '@/lib/panel'

export const dynamic = 'force-dynamic'

function provisionAlive(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('pgrep', ['-f', 'installer/provision.sh'], err => resolve(!err))
  })
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const allowed = (await verifyAuth(request)) || (isSetupMode() && checkSetupToken(token))
  if (!allowed) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  let state = await readFile(PROVISION_STATE, 'utf8').then(s => s.trim()).catch(() => 'idle')
  let log = await readFile(PROVISION_LOG, 'utf8').catch(() => '')
  if (state === 'running' && !(await provisionAlive())) {
    state = 'failed'
    log += '\nInstalação interrompida (o painel ou o servidor reiniciou no meio). Clique em "Voltar e corrigir" e envie de novo.\n'
  }

  return NextResponse.json({
    success: true,
    state,
    log: log.split('\n').slice(-300).join('\n'),
  })
}
