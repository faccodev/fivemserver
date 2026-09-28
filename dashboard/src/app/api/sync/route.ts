import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { repoDir, verifyAuth } from '@/lib/panel'

const execAsync = promisify(exec)

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const GIT_TOKEN = process.env.GIT_TOKEN || ''
const GIT_REPO = process.env.GIT_REPO || ''
const BRANCH = process.env.GIT_BRANCH || 'main'


// Token vai como header via variáveis GIT_CONFIG_* do processo: não aparece
// no `ps` nem fica gravado no .git/config.
function gitAuthEnv(): NodeJS.ProcessEnv {
    if (!GIT_TOKEN) return process.env
    const basic = Buffer.from(`x-access-token:${GIT_TOKEN}`).toString('base64')
    return {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    }
}

async function sh(cmd: string, timeout = 300000): Promise<{ stdout: string; stderr: string }> {
    return execAsync(cmd, { timeout, cwd: DATA_DIR, env: gitAuthEnv() })
}

async function shRoot(cmd: string, timeout = 300000): Promise<{ stdout: string; stderr: string }> {
    return execAsync(cmd, { timeout, env: gitAuthEnv() })
}

async function isRepoReady(): Promise<boolean> {
    try {
        const { stdout } = await sh(`git -C "${repoDir()}" rev-parse --verify HEAD 2>/dev/null || echo "empty"`)
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
        // Token é opcional: repositórios públicos sincronizam sem ele.
        if (!GIT_REPO) {
            return NextResponse.json({ success: false, message: 'Repositório não configurado. Configure em Configuração.' }, { status: 400 })
        }

        const repoUrl = `${GIT_REPO.replace(/\.git$/, '')}.git`

        // ── First run: shallow clone
        if (!(await isRepoReady())) {
            console.log('[SYNC] First run — shallow clone...')
            await shRoot(`git clone --depth 1 --branch "${BRANCH}" "${repoUrl}" "${DATA_DIR}"`)
            console.log('[SYNC] Clone done.')
            // Remove Windows artifacts (DLLs, etc.) — not needed on Linux
            await sh(`rm -rf "${repoDir()}/files/artifacts" 2>/dev/null || true`)
            const { stdout: lastCommit } = await sh(
                `git -C "${repoDir()}" log -1 --pretty=format:"%h - %s" 2>/dev/null`
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
        await sh(`git -C "${repoDir()}" config branch.${BRANCH}.remote origin`)
        await sh(`git -C "${repoDir()}" config branch.${BRANCH}.merge refs/heads/${BRANCH}`)

        const { stdout: pullOut, stderr: pullErr } = await sh(
            `git -C "${repoDir()}" pull --ff-only origin "${BRANCH}" 2>&1`,
            180000 // 3 min timeout for large clones
        )
        // ── Fix permissions so fivem can write ─────────────────────────────
        await sh(`chown -R fivem:fivem "${DATA_DIR}" 2>/dev/null || true`)
        // Remove Windows artifacts on every sync — not needed on Linux
        await sh(`rm -rf "${repoDir()}/files/artifacts" 2>/dev/null || true`)

        // ── Final state ───────────────────────────────────────────────────────
        const { stdout: lastCommit } = await sh(
            `git -C "${repoDir()}" log -1 --pretty=format:"%h - %s (%an)" 2>/dev/null`
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

export async function GET(request: NextRequest) {
    if (!(await verifyAuth(request))) {
        return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
    }
    try {
        const { stdout: lastCommit } = await sh(
            `git -C "${repoDir()}" log -1 --pretty=format:"%h - %s" 2>/dev/null || echo "não disponível"`
        )
        const { stdout: branch } = await sh(
            `git -C "${repoDir()}" branch --show-current 2>/dev/null || echo "?"`
        )
        const { stdout: ahead } = await sh(
            `git -C "${repoDir()}" rev-list --left-right --count HEAD...origin/${BRANCH} 2>/dev/null || echo "0\t0"`
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
