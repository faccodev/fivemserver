import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const GIT_TOKEN = process.env.GIT_TOKEN || ''
const GIT_REPO = process.env.GIT_REPO || 'https://github.com/faccodev/sindicatorp'
const BRANCH = 'main'

async function verifyAuth(request: NextRequest) {
    const token = request.cookies.get('auth-token')?.value
    if (!token) return false
    try {
        const { jwtVerify } = await import('jose')
        const JWT_SECRET = (process.env.DASHBOARD_PASSWORD?.slice(0, 32) || 'default-secret-key-minimum-32-chars').padEnd(32, '0')
        const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET))
        return payload.authenticated === true
    } catch {
        return false
    }
}

async function sh(cmd: string, timeout = 300000): Promise<{ stdout: string; stderr: string }> {
    return execAsync(cmd, { timeout, cwd: DATA_DIR })
}

async function shRoot(cmd: string, timeout = 300000): Promise<{ stdout: string; stderr: string }> {
    return execAsync(cmd, { timeout })
}

async function isRepoReady(): Promise<boolean> {
    try {
        const { stdout } = await sh(`git -C "${DATA_DIR}" rev-parse --verify HEAD 2>/dev/null || echo "empty"`)
        return stdout.trim().length > 0 && stdout.trim() !== 'empty'
    } catch {
        return false
    }
}

export async function POST(request: NextRequest) {
    if (!(await verifyAuth(request))) {
        return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
    }

    try {
        const gitToken = process.env.GIT_TOKEN
        if (!gitToken) {
            return NextResponse.json({ success: false, message: 'GIT_TOKEN não configurado.' }, { status: 400 })
        }

const authUrl = `https://x-access-token:${GIT_TOKEN}@github.com/${GIT_REPO.replace('https://github.com/', '')}.git`

        // ── First run: shallow clone
        if (!(await isRepoReady())) {
            console.log('[SYNC] First run — shallow clone...')
            await shRoot(`git clone --depth 1 --branch "${BRANCH}" "${authUrl}" "${DATA_DIR}"`)
            console.log('[SYNC] Clone done.')
            // Remove Windows artifacts (DLLs, etc.) — not needed on Linux
            await sh(`rm -rf "${DATA_DIR}/files/artifacts" 2>/dev/null || true`)
            const { stdout: lastCommit } = await sh(
                `git -C "${DATA_DIR}" log -1 --pretty=format:"%h - %s" 2>/dev/null`
            )
            return NextResponse.json({
                success: true,
                lastCommit: lastCommit.trim(),
                output: 'Clone concluído.',
                skipped: false,
            })
        }

// ── Fetch + fast-forward ─────────────────────────────────────────────────────
        // Force tracking since shallow repo may have lost upstream ref
        await sh(`git -C "${DATA_DIR}" config branch.main.remote origin`)
        await sh(`git -C "${DATA_DIR}" config branch.main.merge refs/heads/main`)

        const { stdout: pullOut, stderr: pullErr } = await sh(
            `git -C "${DATA_DIR}" pull --ff-only origin "${BRANCH}" 2>&1`,
            180000 // 3 min timeout for large clones
        )
        // ── Fix permissions so fivem can write ─────────────────────────────
        await sh(`chown -R fivem:fivem "${DATA_DIR}" 2>/dev/null || true`)
        // Remove Windows artifacts on every sync — not needed on Linux
        await sh(`rm -rf "${DATA_DIR}/files/artifacts" 2>/dev/null || true`)

        // ── Final state ───────────────────────────────────────────────────────
        const { stdout: lastCommit } = await sh(
            `git -C "${DATA_DIR}" log -1 --pretty=format:"%h - %s (%an)" 2>/dev/null`
        )

        return NextResponse.json({
            success: true,
            lastCommit: lastCommit.trim() || null,
            output: [pullOut, pullErr].filter(Boolean).join('\n').trim(),
        })
    } catch (error: any) {
        console.error('[SYNC ERROR]', error)
        return NextResponse.json({
            success: false,
            message: error.message || 'Erro ao sincronizar',
            output: error.stdout || error.stderr || error.message,
        }, { status: 500 })
    }
}

export async function GET() {
    try {
        const { stdout: lastCommit } = await sh(
            `git -C "${DATA_DIR}" log -1 --pretty=format:"%h - %s" 2>/dev/null || echo "não disponível"`
        )
        const { stdout: branch } = await sh(
            `git -C "${DATA_DIR}" branch --show-current 2>/dev/null || echo "?"`
        )
        const { stdout: ahead } = await sh(
            `git -C "${DATA_DIR}" rev-list --left-right --count HEAD...origin/main 2>/dev/null || echo "0\t0"`
        )
        const [aheadN = '0', behindN = '0'] = ahead.trim().split('\t')

        return NextResponse.json({
            success: true,
            branch: branch.trim(),
            lastCommit: lastCommit.trim(),
            commitsAhead: aheadN,
            commitsBehind: behindN,
        })
    } catch {
        return NextResponse.json({ success: false, message: 'Erro ao ler status git' }, { status: 500 })
    }
}
