import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import { writeFile, unlink } from 'fs/promises'

const execAsync = promisify(exec)

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

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') || ''

  try {
    // Handle multipart form data (file upload)
    if (contentType.includes('multipart/form-data')) {
      return await handleFileUpload(request)
    }

    // Handle JSON with URL
    const body = await request.json()
    const { fileUrl } = body

    if (fileUrl) {
      return await handleUrlDownload(request, fileUrl)
    }

    return NextResponse.json({
      success: false,
      message: 'Envie um arquivo ou URL'
    }, { status: 400 })

  } catch (error: any) {
    console.error('[RESTORE ERROR]', error)
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao restaurar backup'
    }, { status: 500 })
  }
}

async function handleFileUpload(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({
      success: false,
      message: 'Nenhum arquivo enviado'
    }, { status: 400 })
  }

  const filename = file.name.toLowerCase()

  // Validate extension
  if (!filename.endsWith('.sql') && !filename.endsWith('.sql.gz') && !filename.endsWith('.gz')) {
    return NextResponse.json({
      success: false,
      message: 'Arquivo deve ser .sql, .sql.gz ou .gz'
    }, { status: 400 })
  }

  // Save uploaded file
  const tempPath = path.join(os.tmpdir(), `restore-${Date.now()}-${file.name}`)
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  await writeFile(tempPath, buffer)

  console.log('[RESTORE] File uploaded to:', tempPath)

  return await performRestore(tempPath, filename)
}

async function handleUrlDownload(request: NextRequest, fileUrl: string) {
  const filename = fileUrl.toLowerCase()

  if (!filename.endsWith('.sql') && !filename.endsWith('.sql.gz') && !filename.endsWith('.gz')) {
    return NextResponse.json({
      success: false,
      message: 'URL deve apontar para arquivo .sql ou .sql.gz'
    }, { status: 400 })
  }

  const tempPath = path.join(os.tmpdir(), `restore-${Date.now()}-download.sql.gz`)

  // Download file
  console.log('[RESTORE] Downloading from:', fileUrl)
  const response = await fetch(fileUrl)

  if (!response.ok) {
    return NextResponse.json({
      success: false,
      message: 'Erro ao baixar arquivo da URL'
    }, { status: 400 })
  }

  const buffer = await response.arrayBuffer()
  await writeFile(tempPath, Buffer.from(buffer))

  console.log('[RESTORE] File downloaded to:', tempPath)

  return await performRestore(tempPath, path.basename(fileUrl))
}

async function performRestore(filePath: string, originalFilename: string) {
  const DB_HOST = process.env.DB_HOST || 'localhost'
  const DB_USER = process.env.DB_USER || 'fivem'
  const DB_PASSWORD = process.env.DB_PASSWORD || ''
  const DB_NAME = process.env.DB_NAME || 'default'

  let restoreCmd = ''

  try {
    // Check if file is gzipped
    if (originalFilename.endsWith('.gz') || originalFilename.endsWith('.sql.gz')) {
      console.log('[RESTORE] Decompressing gzipped file...')
      restoreCmd = `gunzip -c "${filePath}" | mariadb -h ${DB_HOST} -u ${DB_USER} --password="${DB_PASSWORD}" ${DB_NAME}`
    } else {
      restoreCmd = `mariadb -h ${DB_HOST} -u ${DB_USER} --password="${DB_PASSWORD}" ${DB_NAME} < "${filePath}"`
    }

    console.log('[RESTORE] Starting database restore...')

    // execAsync rejects if there's any output on stderr, even warnings like "Deprecated program name"
    // So we'll run it and catch, but check if it's a real error
    try {
      await execAsync(restoreCmd)
    } catch (execErr: any) {
      // If there's an exit code, it actually failed. If there's just stderr, it might be a warning.
      if (execErr.code && execErr.code !== 0) {
        throw execErr
      } else if (execErr.stderr) {
        console.warn('[RESTORE] Warning during restore:', execErr.stderr)
      }
    }

    // Cleanup
    await unlink(filePath)

    return NextResponse.json({
      success: true,
      message: 'Banco de dados restaurado com sucesso!',
      database: DB_NAME
    })

  } catch (error: any) {
    console.error('[RESTORE ERROR]', error)

    // Cleanup on error
    try {
      await unlink(filePath)
    } catch { }

    return NextResponse.json({
      success: false,
      message: 'Erro ao restaurar: ' + (error.message || error.stderr || 'Unknown error')
    }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'API de restore - envie arquivo via POST (multipart/form-data) ou URL via JSON',
    examples: {
      upload: 'Content-Type: multipart/form-data, body: FormData com campo "file"',
      url: 'Content-Type: application/json, body: { "fileUrl": "https://..." }'
    }
  })
}
