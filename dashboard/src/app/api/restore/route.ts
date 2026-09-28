import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import path from 'path'
import os from 'os'
import { writeFile, unlink } from 'fs/promises'
import { verifyAuth } from '@/lib/panel'



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
  const tempPath = path.join(os.tmpdir(), `restore-${Date.now()}${filename.endsWith('.gz') ? '.sql.gz' : '.sql'}`)
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

function runRestore(filePath: string, gzipped: boolean): Promise<void> {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env
  const script = gzipped
    ? 'set -o pipefail; gunzip -c "$FILE" | mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME"'
    : 'mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" < "$FILE"'
  return new Promise((resolve, reject) => {
    execFile('bash', ['-c', script], {
      // Caminho e credenciais só por variável de ambiente: nada do usuário vira shell.
      env: { ...process.env, FILE: filePath, DB_PORT: DB_PORT || '3306', MYSQL_PWD: DB_PASSWORD || '' },
      timeout: 60 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, _stdout, stderr) => {
      // mariadb escreve avisos no stderr; só o código de saída indica falha.
      if (err) return reject(new Error(stderr.trim() || err.message))
      if (stderr.trim()) console.warn('[RESTORE] aviso:', stderr.trim())
      resolve()
    })
  })
}

async function performRestore(filePath: string, originalFilename: string) {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    await unlink(filePath).catch(() => {})
    return NextResponse.json({ success: false, message: 'Banco de dados não configurado.' }, { status: 400 })
  }
  try {
    console.log('[RESTORE] Starting database restore...')
    await runRestore(filePath, originalFilename.toLowerCase().endsWith('.gz'))
    return NextResponse.json({
      success: true,
      message: 'Banco de dados restaurado com sucesso!',
      database: process.env.DB_NAME,
    })
  } catch (error: any) {
    console.error('[RESTORE ERROR]', error.message)
    return NextResponse.json({
      success: false,
      message: 'Erro ao restaurar: ' + error.message,
    }, { status: 500 })
  } finally {
    await unlink(filePath).catch(() => {})
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
