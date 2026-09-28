import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { verifyAuth } from '@/lib/panel'

const execAsync = promisify(exec)

// Paths
const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const TX_DATA = '/home/fivem/txData'


function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatPercent(val: number): string {
  return val.toFixed(1) + '%'
}

async function getCpuUsage(): Promise<{ used: number; cores: number }> {
  try {
    const [raw1, raw2] = await Promise.all([
      readFile('/proc/stat', 'utf8'),
      readFile('/proc/stat', 'utf8'),
    ])

    const parseCpu = (raw: string): { idle: number; total: number } => {
      const line = raw.split('\n').find(l => l.startsWith('cpu '))
      if (!line) return { idle: 0, total: 0 }
      const vals = line.split(/\s+/).slice(1, 5).map(Number)
      const idle = vals[3] || 0
      const total = vals.reduce((a, b) => a + b, 0)
      return { idle, total }
    }

    const s1 = parseCpu(raw1)
    await new Promise(r => setTimeout(r, 500))
    const s2 = parseCpu(await readFile('/proc/stat', 'utf8'))

    const deltaTotal = s2.total - s1.total
    const deltaIdle = s2.idle - s1.idle
    const used = deltaTotal > 0 ? ((deltaTotal - deltaIdle) / deltaTotal) * 100 : 0

    const cpuinfo = await readFile('/proc/cpuinfo', 'utf8')
    const cores = cpuinfo.split('\n').filter(l => l.startsWith('processor')).length || 1

    return { used, cores }
  } catch {
    return { used: 0, cores: 1 }
  }
}

async function getMemoryUsage(): Promise<{ total: number; used: number; free: number; buffers: number; cached: number; usedPercent: number }> {
  try {
    const raw = await readFile('/proc/meminfo', 'utf8')
    const get = (key: string) => {
      const line = raw.split('\n').find(l => l.startsWith(key))
      return line ? parseInt(line.split(/\s+/)[1]) * 1024 : 0
    }

    const total = get('MemTotal:')
    const free = get('MemFree:')
    const buffers = get('Buffers:')
    const cached = get('Cached:')
    const available = free + buffers + cached
    const used = total - available
    const usedPercent = total > 0 ? (used / total) * 100 : 0

    return { total, used, free, buffers, cached, usedPercent }
  } catch {
    return { total: 0, used: 0, free: 0, buffers: 0, cached: 0, usedPercent: 0 }
  }
}

async function getDiskUsage(path: string = '/'): Promise<{ total: number; used: number; free: number; usedPercent: number }> {
  try {
    const { stdout } = await execAsync(`df -B1 "${path}" | tail -1 | awk '{print $2" "$3" "$4}'`)
    const [total, used, free] = stdout.trim().split(/\s+/).map(Number)
    const usedPercent = total > 0 ? (used / total) * 100 : 0
    return { total: total || 0, used: used || 0, free: free || 0, usedPercent }
  } catch {
    return { total: 0, used: 0, free: 0, usedPercent: 0 }
  }
}

async function getFiveMStatus(): Promise<{ running: boolean; players: number; uptime: string }> {
  try {
    const { stdout } = await execAsync(
      'systemctl is-active fivem-server 2>/dev/null || echo inactive'
    )
    const running = stdout.trim() === 'active'

    // Uptime do serviço
    const { stdout: up } = await execAsync(
      'systemctl show fivem-server --property=ActiveEnterTimestamp --value 2>/dev/null'
    )
    const uptime = up.trim() || 'N/A'

    return { running, players: 0, uptime }
  } catch {
    return { running: false, players: 0, uptime: 'N/A' }
  }
}

async function getServerDataSize(): Promise<{ size: number; files: number }> {
  try {
    const { stdout } = await execAsync(
      `du -sbL "${DATA_DIR}" 2>/dev/null | awk '{print $1}'`
    )
    const size = parseInt(stdout.trim()) || 0
    const { stdout: f } = await execAsync(
      `find -L "${DATA_DIR}" -type f 2>/dev/null | wc -l`
    )
    const files = parseInt(f.trim()) || 0
    return { size, files }
  } catch {
    return { size: 0, files: 0 }
  }
}

async function getNetworkStats(): Promise<{ rx: number; tx: number }> {
  try {
    const { stdout } = await execAsync(
      'cat /proc/net/dev | grep -E "eth0|ens|enp|eno" | grep -v "Inter" | head -1 | awk "{print \\$2 \\$10}"'
    )
    const [rx, tx] = stdout.trim().split(/\s+/).map(Number)
    return { rx: rx || 0, tx: tx || 0 }
  } catch {
    return { rx: 0, tx: 0 }
  }
}

interface ProcessInfo {
  pid: number
  name: string
  memPercent: number
  memRss: number
}

async function getTopProcesses(limit: number = 8): Promise<ProcessInfo[]> {
  try {
    const { stdout } = await execAsync(
      `ps aux --sort=-%mem | awk 'NR>1 && $4!="0.0" {print $2,$3,$4,$6}' | head -${limit}`
    )
    const lines = stdout.trim().split('\n').filter(Boolean)
    return lines.map(line => {
      const [pid, cpu, memPct, rss] = line.trim().split(/\s+/)
      return {
        pid: parseInt(pid) || 0,
        name: '', // nome vem depois
        memPercent: parseFloat(memPct) || 0,
        memRss: parseInt(rss) || 0,
      }
    })
  } catch {
    return []
  }
}

async function getProcessNames(pids: number[]): Promise<Record<number, string>> {
  if (pids.length === 0) return {}
  try {
    const { stdout } = await execAsync(
      `ps -p ${pids.join(',')} -o pid,comm --no-headers`
    )
    const lines = stdout.trim().split('\n').filter(Boolean)
    const map: Record<number, string> = {}
    lines.forEach(l => {
      const parts = l.trim().split(/\s+/)
      const pid = parseInt(parts[0])
      const name = parts.slice(1).join(' ') || 'unknown'
      if (pid) map[pid] = name
    })
    return map
  } catch {
    return {}
  }
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  try {
    const [cpu, memory, diskRoot, diskOpt, fivem, serverData] = await Promise.all([
      getCpuUsage(),
      getMemoryUsage(),
      getDiskUsage('/'),
      getDiskUsage('/opt'),
      getFiveMStatus(),
      getServerDataSize(),
    ])

    const network = await getNetworkStats()
    const processes = await getTopProcesses(8)
    const pids = processes.map(p => p.pid)
    const names = await getProcessNames(pids)
    processes.forEach(p => { p.name = names[p.pid] || 'unknown' })

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      cpu: {
        used: formatPercent(cpu.used),
        usedRaw: parseFloat(cpu.used.toFixed(1)),
        cores: cpu.cores,
      },
      memory: {
        total: formatBytes(memory.total),
        used: formatBytes(memory.used),
        free: formatBytes(memory.free),
        buffers: formatBytes(memory.buffers + memory.cached),
        usedPercent: formatPercent(memory.usedPercent),
        usedRaw: parseFloat(memory.usedPercent.toFixed(1)),
      },
      disk: {
        root: {
          total: formatBytes(diskRoot.total),
          used: formatBytes(diskRoot.used),
          free: formatBytes(diskRoot.free),
          usedPercent: formatPercent(diskRoot.usedPercent),
          usedRaw: parseFloat(diskRoot.usedPercent.toFixed(1)),
        },
        opt: {
          total: formatBytes(diskOpt.total),
          used: formatBytes(diskOpt.used),
          free: formatBytes(diskOpt.free),
          usedPercent: formatPercent(diskOpt.usedPercent),
          usedRaw: parseFloat(diskOpt.usedPercent.toFixed(1)),
        },
      },
      serverData: {
        size: formatBytes(serverData.size),
        files: serverData.files.toLocaleString('pt-BR'),
      },
      processes: processes.map(p => ({
        pid: p.pid,
        name: p.name,
        memPercent: parseFloat(p.memPercent.toFixed(1)),
        memRss: formatBytes(p.memRss * 1024),
      })),
      fivem: {
        running: fivem.running,
        uptime: fivem.uptime,
      },
      network: {
        rx: formatBytes(network.rx),
        tx: formatBytes(network.tx),
      }
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      message: error.message
    }, { status: 500 })
  }
}
