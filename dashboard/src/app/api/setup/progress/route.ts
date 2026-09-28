import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { PROVISION_LOG, PROVISION_STATE, verifyAuth, isSetupMode, checkSetupToken } from '@/lib/panel'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const allowed = (await verifyAuth(request)) || (isSetupMode() && checkSetupToken(token))
  if (!allowed) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  const state = await readFile(PROVISION_STATE, 'utf8').then(s => s.trim()).catch(() => 'idle')
  const log = await readFile(PROVISION_LOG, 'utf8').catch(() => '')

  return NextResponse.json({
    success: true,
    state,
    log: log.split('\n').slice(-300).join('\n'),
  })
}
