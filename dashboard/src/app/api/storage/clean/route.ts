import { NextRequest, NextResponse } from 'next/server'
import { exec, execSync } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const execSyncFn = (cmd: string) => execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
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

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getDirSize(path: string): number {
  try {
    const stdout = execSyncFn(`du -sbL "${path}" 2>/dev/null | awk '{print $1}'`)
    return parseInt(stdout.trim()) || 0
  } catch {
    return 0
  }
}

interface CleanTarget {
  id: string
  label: string
  description: string
  command: string
  risk: 'low' | 'medium' | 'high'
  targetPaths: string[]
}

const cleanTargets: CleanTarget[] = [
  {
    id: 'git-history',
    label: 'Git GC — Otimizar Pack File',
    description: 'Executa git gc --aggressive para compactar loose objects e otimizar o pack file. Libera espaço sem remover o working tree.',
    command: `git -C "${DATA_DIR}" reflog expire --expire=now --all 2>/dev/null; git -C "${DATA_DIR}" gc --aggressive --prune=now 2>/dev/null; true`,
    risk: 'low',
    targetPaths: [DATA_DIR]
  },
  {
    id: 'git-pack',
    label: 'Git Shallow — Resetar Pack File',
    description: 'Refaz o repo com --depth 1, limpa todo o histórico git. Pode liberar 5GB+ do pack file.',
    command: `
      ORIGIN_URL=\$(cd "${DATA_DIR}" && git remote get-url origin 2>/dev/null || echo "")
      TMP_GIT="/tmp/git-shallow-new"
      rm -rf "$TMP_GIT"
      if [ -n "\$ORIGIN_URL" ]; then
        git clone --depth 1 --bare "$ORIGIN_URL" "$TMP_GIT" 2>/dev/null || true
        cp -r "${DATA_DIR}/.git" "${DATA_DIR}/.git.bak" 2>/dev/null || true
        rm -rf "${DATA_DIR}/.git"
        cp -r "$TMP_GIT" "${DATA_DIR}/.git"
        git -C "${DATA_DIR}" checkout HEAD -- . 2>/dev/null || true
        rm -rf "$TMP_GIT"
        rm -rf "${DATA_DIR}/.git.bak"
      fi
      true
    `,
    risk: 'high',
    targetPaths: [DATA_DIR]
  },
  {
    id: 'cache',
    label: 'Cache txData',
    description: 'Limpa cache do txAdmin e dados temporários do FiveM.',
    command: `rm -rf ${TX_DATA}/cache/* 2>/dev/null; rm -rf ${TX_DATA}/data/cache/* 2>/dev/null; find ${TX_DATA} -name "*.tmp" -mtime +1 -delete 2>/dev/null; true`,
    risk: 'low',
    targetPaths: [`${TX_DATA}/cache`, `${TX_DATA}/data/cache`]
  },
  {
    id: 'tmp',
    label: 'Arquivos Temporários',
    description: 'Remove arquivos temporários do /tmp do FiveM e core dumps.',
    command: `find /tmp/fxserver /tmp/sync /tmp/fivem -type f -delete 2>/dev/null; find ${DATA_DIR} -name "core.*" -type f -delete 2>/dev/null; true`,
    risk: 'medium',
    targetPaths: ['/tmp/fxserver', '/tmp/sync', '/tmp/fivem']
  },
  {
    id: 'logs',
    label: 'Logs Antigos',
    description: 'Remove logs do FiveM e txAdmin com mais de 5 dias.',
    command: `find ${LOG_DIR} -name "*.log" -mtime +5 -delete 2>/dev/null; find ${TX_DATA} -name "*.log" -mtime +5 -delete 2>/dev/null; true`,
    risk: 'low',
    targetPaths: [LOG_DIR]
  },
  {
    id: 'journal',
    label: 'Logs do Systemd (journal)',
    description: 'Limpa journalctl, mantém apenas os últimos 100MB.',
    command: `journalctl --vacuum-size=100M 2>/dev/null; true`,
    risk: 'medium',
    targetPaths: []
  }
]

async function getTotalTargetBytes(target: CleanTarget): Promise<number> {
  if (target.id === 'journal') {
    try {
      const { stdout } = await execAsync('journalctl --disk-usage | grep -oP "\\d+" | head -1')
      const mb = parseInt(stdout.trim()) || 0
      return mb * 1024 * 1024
    } catch { return 0 }
  }
  if (target.targetPaths.length === 0) return 0
  let total = 0
  for (const p of target.targetPaths) {
    try {
      const { stdout } = await execAsync(`du -sbL "${p}" 2>/dev/null | awk '{print $1}'`)
      total += parseInt(stdout.trim()) || 0
    } catch { /* ignore */ }
  }
  return total
}

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { targetId } = body

    if (!targetId) {
      return NextResponse.json({ success: false, message: 'Target não especificado' }, { status: 400 })
    }

    const target = cleanTargets.find(t => t.id === targetId)

    if (!target) {
      return NextResponse.json({ success: false, message: 'Target inválido' }, { status: 400 })
    }

    if (target.risk === 'high') {
      return NextResponse.json({
        success: false,
        message: 'Operação de alto risco bloqueada por segurança. Execute manualmente via SSH.'
      }, { status: 403 })
    }

    const bytesBefore = await getTotalTargetBytes(target)

    await execAsync(target.command, { timeout: 180000 })

    await execAsync('sync', { timeout: 10000 })

    const bytesAfter = await getTotalTargetBytes(target)

    const freed = bytesBefore - bytesAfter
    return NextResponse.json({
      success: true,
      message: `${target.label} limpo com sucesso`,
      spaceFreed: formatBytes(Math.max(0, freed)),
      freedBytes: Math.max(0, freed),
      bytesBefore,
      bytesAfter
    })
  } catch (error: any) {
    console.error('[CLEANUP ERROR]', error)
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao limpar'
    }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    targets: cleanTargets.map(t => ({
      id: t.id,
      label: t.label,
      description: t.description,
      risk: t.risk
    }))
  })
}
