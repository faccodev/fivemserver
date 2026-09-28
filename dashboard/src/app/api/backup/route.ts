import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'

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

  try {
    const webhookUrl = process.env.BACKUP_WEBHOOK_URL

    if (!webhookUrl) {
      return NextResponse.json({
        success: false,
        message: 'BACKUP_WEBHOOK_URL não configurada no servidor'
      }, { status: 400 })
    }

    const DB_HOST = process.env.DB_HOST || 'localhost'
    const DB_USER = process.env.DB_USER || 'fivem'
    const DB_PASSWORD = process.env.DB_PASSWORD || ''
    const DB_NAME = process.env.DB_NAME || 'default'

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFilename = `backup-${timestamp}.sql.gz`
    const backupPath = path.join(os.tmpdir(), backupFilename)

    // Create mariadb-dump command with pipefail to catch errors in the dump itself
    // Using --password="${DB_PASSWORD}" ensures proper password handling
    const dumpCmd = `set -o pipefail && mariadb-dump -h ${DB_HOST} -u ${DB_USER} --password="${DB_PASSWORD}" ${DB_NAME} | gzip > "${backupPath}"`

    console.log('[BACKUP] Starting database backup...')
    try {
      // Use sh instead of bash for better compatibility
      await execAsync(`sh -c '${dumpCmd}'`)
    } catch (dumpErr: any) {
      console.error('[BACKUP] mariadb-dump failed:', dumpErr.stderr || dumpErr.message)
      await execAsync(`rm -f "${backupPath}" 2>/dev/null || true`)
      return NextResponse.json({
        success: false,
        message: 'Falha ao executar o backup. Verifique as credenciais do banco.'
      }, { status: 500 })
    }

    // Get file size and verify it's not empty
    const { stdout: sizeOutput } = await execAsync(`stat -c%s "${backupPath}" 2>/dev/null || stat -f%z "${backupPath}"`)
    const fileSizeBytes = parseInt(sizeOutput.trim()) || 0

    if (fileSizeBytes < 100) { // Should at least have some headers
      await execAsync(`rm -f "${backupPath}" 2>/dev/null || true`)
      return NextResponse.json({
        success: false,
        message: 'O backup gerado está vazio (0KB). Verifique se o banco de dados contém tabelas.'
      }, { status: 500 })
    }

    const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2)
    console.log(`[BACKUP] Backup created: ${backupPath} (${fileSizeMB} MB)`)

    // Read the compressed file
    const { readFile } = await import('fs/promises')
    const fileBuffer = await readFile(backupPath)

    // Discord has 8MB limit for uploads, 25MB for webhook
    if (fileSizeBytes > 25 * 1024 * 1024) {
      // File too large, save locally and send link instead
      const localBackupDir = '/opt/backups/fivem'
      await execAsync(`mkdir -p ${localBackupDir}`)
      await execAsync(`cp "${backupPath}" ${localBackupDir}/${backupFilename}`)

      return NextResponse.json({
        success: true,
        message: `Backup criado localmente (${fileSizeMB} MB) - muito grande para Discord`,
        backupName: backupFilename,
        localPath: `${localBackupDir}/${backupFilename}`,
        size: fileSizeMB + ' MB'
      })
    }

    // Create FormData to send to Discord
    const form = new FormData()

    // Create embed message
    const embed = {
      title: '📦 Backup MySQL',
      description: `Backup do banco de dados **${DB_NAME}**`,
      color: 0x00ff00,
      fields: [
        {
          name: 'Database',
          value: DB_NAME,
          inline: true
        },
        {
          name: 'Size',
          value: `${fileSizeMB} MB`,
          inline: true
        },
        {
          name: 'Timestamp',
          value: new Date().toLocaleString('pt-BR'),
          inline: true
        }
      ],
      footer: {
        text: 'Sindicato RP - Backup System'
      },
      timestamp: new Date().toISOString()
    }

    form.append('payload_json', JSON.stringify({ embeds: [embed] }))
    const fileBlob = new Blob([fileBuffer], { type: 'application/gzip' })
    form.append('file', fileBlob, backupFilename)

    // Send to Discord webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: form
    })

    // Cleanup temp file
    await execAsync(`rm -f "${backupPath}"`)

    if (response.ok) {
      return NextResponse.json({
        success: true,
        message: 'Backup enviado para o Discord com sucesso!',
        backupName: backupFilename,
        size: fileSizeMB + ' MB'
      })
    } else {
      const errorText = await response.text()
      console.error('[BACKUP] Discord error:', errorText)
      return NextResponse.json({
        success: false,
        message: 'Erro ao enviar para Discord: ' + errorText
      }, { status: 500 })
    }
  } catch (error: any) {
    console.error('[BACKUP ERROR]', error)
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao fazer backup'
    }, { status: 500 })
  }
}
