import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.DASHBOARD_PASSWORD?.slice(0, 32).padEnd(32, '0') || 'default-secret-key-minimum-32-chars'
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { password } = body

    if (!password) {
      return NextResponse.json({ success: false, message: 'Senha obrigatória' }, { status: 400 })
    }

    const envPassword = process.env.DASHBOARD_PASSWORD?.trim()
    const providedPassword = password?.trim()

    if (!envPassword || providedPassword !== envPassword) {
      return NextResponse.json({ success: false, message: 'Senha inválida' }, { status: 401 })
    }

    const token = await new SignJWT({ authenticated: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('8h')
      .sign(JWT_SECRET)

    const response = NextResponse.json({ success: true, message: 'Autenticado com sucesso' })
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: false, // Allow HTTP for dashboard access behind proxies or direct IP
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 hours
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json({ success: false, message: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, message: 'Deslogado' })
  response.cookies.delete('auth-token')
  return response
}
