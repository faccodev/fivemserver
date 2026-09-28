import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { verifyAuth } from '@/lib/panel'

const execAsync = promisify(exec)

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const TX_DATA = '/home/fivem/txData'
const LOG_DIR = '/var/log/fivem'


interface StorageInfo {
  path: string
  label: string
  size: string
  sizeBytes: number
  files: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function getFolderSize(folderPath: string): Promise<{ size: string; sizeBytes: number; files: number }> {
  try {
    const { stdout } = await execAsync(`du -sbL "${folderPath}" 2>/dev/null | awk '{print $1}'`)
    const sizeBytes = parseInt(stdout.trim()) || 0
    const { stdout: filesStdout } = await execAsync(`find -L "${folderPath}" -type f 2>/dev/null | wc -l`)
    const files = parseInt(filesStdout.trim()) || 0
    return { size: formatBytes(sizeBytes), sizeBytes, files }
  } catch {
    return { size: '0 B', sizeBytes: 0, files: 0 }
  }
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  try {
    const folders: { path: string; label: string }[] = [
      { path: DATA_DIR, label: 'Server Data (total)' },
      { path: `${DATA_DIR}/resources`, label: 'Resources' },
      { path: TX_DATA, label: 'txData' },
      { path: LOG_DIR, label: 'Logs' },
      { path: '/home/fivem/server', label: 'Artefatos FiveM' },
    ]

    const storageInfo: StorageInfo[] = []
    let totalSizeBytes = 0

    for (const folder of folders) {
      const { size, sizeBytes, files } = await getFolderSize(folder.path)
      storageInfo.push({ path: folder.path, label: folder.label, size, sizeBytes, files })
      totalSizeBytes += sizeBytes
    }

    // Git info
    let gitInfo = { branch: 'N/A', lastCommit: 'N/A', packSize: 'N/A' }
    try {
      const { stdout: branch } = await execAsync(`cd "${DATA_DIR}" && git branch --show-current 2>/dev/null || echo "?"`)
      const { stdout: commit } = await execAsync(`cd "${DATA_DIR}" && git log -1 --format:"%h - %s" 2>/dev/null || echo "?"`)
      const { stdout: pack } = await execAsync(`du -sh "${DATA_DIR}/.git/objects/pack" 2>/dev/null | cut -f1 || echo "0"`)
      gitInfo = {
        branch: branch.trim(),
        lastCommit: commit.trim(),
        packSize: pack.trim()
      }
    } catch { /* git não disponível */ }

    // Disk info
    let diskInfo = { total: 'N/A', used: 'N/A', free: 'N/A', usePercent: 'N/A' }
    try {
      const { stdout } = await execAsync(`df -h /home/fivem | tail -1 | awk '{print $2" "$3" "$4" "$5}'`)
      const parts = stdout.trim().split(/\s+/)
      if (parts.length >= 4) {
        diskInfo = { total: parts[0], used: parts[1], free: parts[2], usePercent: parts[3] }
      }
    } catch { }

    return NextResponse.json({
      success: true,
      storage: storageInfo,
      totalSize: formatBytes(totalSizeBytes),
      disk: diskInfo,
      git: gitInfo
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao buscar informações de armazenamento'
    }, { status: 500 })
  }
}
