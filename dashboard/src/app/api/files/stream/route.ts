import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const TX_DATA = '/home/fivem/txData'
const FIVEM_DIR = '/home/fivem/server'

const ALLOWED_ROOTS = [DATA_DIR, TX_DATA, FIVEM_DIR, '/opt/backups']

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

  let statResult: any
  try {
    statResult = await stat(absolutePath)
  } catch {
    return NextResponse.json({ success: false, message: 'Arquivo não encontrado' }, { status: 404 })
  }

  const fileSize = statResult.size
  const range = request.headers.get('range')

  if (range) {
    // Partial content (video seeking)
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    const ext = path.extname(absolutePath).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime',
      '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg',
    }
    const mime = mimeMap[ext] || 'application/octet-stream'

    const stream = createReadStream(absolutePath, { start, end })

    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)

    return new NextResponse(buffer, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': mime,
      },
    })
  }

  // Full content
  const ext = path.extname(absolutePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime',
    '.avi':'video/x-msvideo','.mkv':'video/x-matroska',
    '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg',
    '.flac':'audio/flac','.aac':'audio/aac','.m4a':'audio/mp4',
  }

  const stream = createReadStream(absolutePath)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  const buffer = Buffer.concat(chunks)

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': mimeMap[ext] || 'application/octet-stream',
    },
  })
}
