import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'

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

export async function GET(request: NextRequest) {
    if (!(await verifyAuth(request))) {
        return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // 'resources'

    if (type !== 'resources') {
        return NextResponse.json({ success: false, message: 'Invalid type' }, { status: 400 })
    }

    const logFile = `/tmp/sync_progress_resources.log`

    try {
        let content = ''
        try {
            content = await fs.readFile(logFile, 'utf-8')
        } catch {
            // File doesn't exist yet, meaning it hasn't started fetching
            return NextResponse.json({ success: true, progress: 'Iniciando...' })
        }

        // Git outputs progress with carriage returns (\r) instead of newlines
        // So we split by both \r and \n and take the last few non-empty chunks
        const lines = content.split(/[\r\n]+/).filter(Boolean)

        if (lines.length === 0) {
            return NextResponse.json({ success: true, progress: 'Conectando...' })
        }

        // Parse progress from the last line, e.g "Receiving objects:  45% (45/100), 10.00 MiB | 2.00 MiB/s"
        const lastLine = lines[lines.length - 1]

        // Extract everything before the first period/comma to keep it concise, or just send the whole thing
        return NextResponse.json({ success: true, progress: lastLine.trim() })

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 })
    }
}
