import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { timingSafeEqual } from 'crypto'
import { jwtSecret } from '@/lib/panel'

function samePassword(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json()

    if (!password) {
      return NextResponse.json({ success: false, message: 'Senha obrigatória' }, { status: 400 })
    }

    const envPassword = process.env.DASHBOARD_PASSWORD?.trim()
    const secret = jwtSecret()
    if (!envPassword || !secret) {
      return NextResponse.json({ success: false, message: 'Painel ainda não configurado. Use o link de instalação.' }, { status: 503 })
    }
    if (!samePassword(String(password).trim(), envPassword)) {
      return NextResponse.json({ success: false, message: 'Senha inválida' }, { status: 401 })
    }

    const token = await new SignJWT({ authenticated: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('8h')
      .sign(secret)

    const response = NextResponse.json({ success: true, message: 'Autenticado com sucesso' })
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      // HTTPS quando atrás do Caddy; acesso direto por IP:porta continua funcionando.
      secure: request.headers.get('x-forwarded-proto') === 'https',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
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
