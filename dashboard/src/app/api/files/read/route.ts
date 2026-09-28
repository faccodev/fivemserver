import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const TX_DATA = '/home/fivem/txData'
const FIVEM_DIR = '/home/fivem/server'

const ALLOWED_ROOTS = [
  DATA_DIR,
  TX_DATA,
  FIVEM_DIR,
  '/opt/backups',
]

// Limits
const MAX_IMAGE_SIZE = 5 * 1024 * 1024      // 5 MB  — returned as base64
const MAX_VIDEO_SIZE = 50 * 1024 * 1024   // 50 MB — returned as stream URL
const MAX_AUDIO_SIZE = 50 * 1024 * 1024   // 50 MB — returned as stream URL
const MAX_TEXT_SIZE  = 2 * 1024 * 1024    // 2 MB  — returned as string

const IMAGE_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.bmp','.tiff'])
const VIDEO_EXTS = new Set(['.mp4','.webm','.mov','.avi','.mkv','.ogg'])
const AUDIO_EXTS = new Set(['.mp3','.wav','.ogg','.flac','.aac','.m4a'])
const BINARY_EXTS = new Set([
  '.zip','.tar','.gz','.rar','.7z',
  '.pdf','.doc','.docx','.xls','.xlsx',
  '.exe','.dll','.so','.dylib',
  '.ttf','.otf','.woff','.woff2',
  '.db','.sqlite','.sqlite3',
])

function getExt(name: string) {
  const lower = name.toLowerCase()
  const idx = lower.lastIndexOf('.')
  return idx >= 0 ? lower.slice(idx) : ''
}

function detectType(name: string) {
  const ext = getExt(name)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (ext === '.json') return 'json'
  if (['.lua','.js','.ts','.jsx','.tsx','.sh','.bash'].includes(ext)) return 'code'
  if (['.cfg','.ini','.yml','.yaml','.toml','.env'].includes(ext)) return 'code'
  if (['.log','.txt','.md','.html','.css','.xml'].includes(ext)) return 'text'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'text'
}

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

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetPath = searchParams.get('path') || ''

  if (!targetPath) {
    return NextResponse.json({ success: false, message: 'path é obrigatório' }, { status: 400 })
  }

  const absolutePath = path.resolve(targetPath)
  const isAllowed = ALLOWED_ROOTS.some(root => absolutePath.startsWith(root))
  if (!isAllowed) {
    return NextResponse.json({ success: false, message: 'Acesso negado' }, { status: 403 })
  }

  let stat: any
  try {
    stat = await fs.stat(absolutePath)
  } catch {
    return NextResponse.json({ success: false, message: 'Arquivo não encontrado' }, { status: 404 })
  }

  if (!stat.isFile()) {
    return NextResponse.json({ success: false, message: 'Não é um arquivo' }, { status: 400 })
  }

  const fileType = detectType(absolutePath)
  const size = stat.size

  // Binary files — just return metadata
  if (fileType === 'binary') {
    return NextResponse.json({
      success: true,
      fileType,
      fileName: path.basename(absolutePath),
      size,
      message: 'Arquivo binário — visualização não disponível',
    })
  }

  // Image — base64 data URL (small only)
  if (fileType === 'image') {
    if (size > MAX_IMAGE_SIZE) {
      return NextResponse.json({
        success: true,
        fileType,
        fileName: path.basename(absolutePath),
        size,
        tooLarge: true,
        maxSize: MAX_IMAGE_SIZE,
        message: `Imagem muito grande (${(size/1024/1024).toFixed(1)} MB). Máximo: 5 MB`,
      })
    }
    const buffer = await fs.readFile(absolutePath)
    const ext = getExt(absolutePath)
    const mimeMap: Record<string, string> = {
      '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml',
      '.ico':'image/x-icon','.bmp':'image/bmp','.tiff':'image/tiff',
    }
    const mime = mimeMap[ext] || 'image/png'
    const base64 = buffer.toString('base64')
    return NextResponse.json({
      success: true,
      fileType,
      fileName: path.basename(absolutePath),
      size,
      dataUrl: `data:${mime};base64,${base64}`,
    })
  }

  // Video / Audio — return stream URL path (client will call /api/files/stream)
  if (fileType === 'video' || fileType === 'audio') {
    if (size > MAX_VIDEO_SIZE) {
      return NextResponse.json({
        success: true,
        fileType,
        fileName: path.basename(absolutePath),
        size,
        tooLarge: true,
        maxSize: MAX_VIDEO_SIZE,
        message: `Arquivo muito grande (${(size/1024/1024).toFixed(1)} MB). Máximo: 50 MB`,
      })
    }
    const ext = getExt(absolutePath)
    const mimeMap: Record<string, string> = {
      '.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime',
      '.avi':'video/x-msvideo','.mkv':'video/x-matroska',
      '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg',
      '.flac':'audio/flac','.aac':'audio/aac','.m4a':'audio/mp4',
    }
    return NextResponse.json({
      success: true,
      fileType,
      fileName: path.basename(absolutePath),
      size,
      streamPath: `/api/files/stream?path=${encodeURIComponent(absolutePath)}`,
      mimeType: mimeMap[ext] || 'application/octet-stream',
    })
  }

  // Text / Code / JSON — return content
  if (size > MAX_TEXT_SIZE) {
    return NextResponse.json({
      success: true,
      fileType,
      fileName: path.basename(absolutePath),
      size,
      tooLarge: true,
      maxSize: MAX_TEXT_SIZE,
      message: `Arquivo muito grande (${(size/1024/1024).toFixed(1)} MB). Máximo: 2 MB`,
    })
  }

  const content = await fs.readFile(absolutePath, 'utf-8')
  const ext = getExt(absolutePath)

  return NextResponse.json({
    success: true,
    fileType,
    fileName: path.basename(absolutePath),
    size,
    content,
    language: ext.replace('.', '') || 'text',
  })
}
