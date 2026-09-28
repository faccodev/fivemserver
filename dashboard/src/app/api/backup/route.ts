import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { createReadStream, existsSync } from 'fs'
import { mkdir, readFile, stat, unlink } from 'fs/promises'
import { basename, join } from 'path'
import { Readable } from 'stream'
import { BACKUP_DIR, verifyAuth } from '@/lib/panel'

export const dynamic = 'force-dynamic'

// Envio opcional para o Discord (limite de upload do webhook).
const DISCORD_LIMIT = 25 * 1024 * 1024

function dumpDatabase(target: string): Promise<void> {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env
  return new Promise((resolve, reject) => {
    execFile(
      'bash',
      ['-c', 'set -o pipefail; mariadb-dump --single-transaction --routines -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" | gzip > "$TARGET"'],
      {
        // Senha via MYSQL_PWD: não aparece na lista de processos.
        env: { ...process.env, DB_HOST, DB_PORT: DB_PORT || '3306', DB_USER, DB_NAME, MYSQL_PWD: DB_PASSWORD || '', TARGET: target },
        timeout: 30 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, _stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve()),
    )
  })
}

async function sendToDiscord(webhookUrl: string, file: string, sizeMB: string) {
  const form = new FormData()
  form.append('payload_json', JSON.stringify({
    embeds: [{
      title: 'Backup MySQL',
      description: `Backup do banco **${process.env.DB_NAME}**`,
      color: 0x22c55e,
      fields: [{ name: 'Tamanho', value: `${sizeMB} MB`, inline: true }],
      footer: { text: process.env.PANEL_TITLE || 'FiveM Server' },
      timestamp: new Date().toISOString(),
    }],
  }))
  form.append('file', new Blob([await readFile(file)], { type: 'application/gzip' }), basename(file))
  const res = await fetch(webhookUrl, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Discord respondeu ${res.status}: ${await res.text()}`)
}

/** Download de um backup já gerado. */
export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }
  const name = request.nextUrl.searchParams.get('file') || ''
  // Só nomes gerados por este endpoint; bloqueia ../ e afins.
  if (!/^backup-[\w.-]+\.sql\.gz$/.test(name)) {
    return NextResponse.json({ success: false, message: 'Arquivo inválido' }, { status: 400 })
  }
  const path = join(BACKUP_DIR, name)
  if (!existsSync(path)) {
    return NextResponse.json({ success: false, message: 'Backup não encontrado' }, { status: 404 })
  }
  const { size } = await stat(path)
  return new NextResponse(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  })
}

/** Gera um dump do banco em BACKUP_DIR e, se configurado, envia ao Discord. */
export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    return NextResponse.json({
      success: false,
      message: 'Banco de dados não configurado. Informe os dados do MySQL em Configuração.',
    }, { status: 400 })
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `backup-${process.env.DB_NAME}-${stamp}.sql.gz`.replace(/[^\w.-]/g, '_')
  const path = join(BACKUP_DIR, name)

  try {
    await mkdir(BACKUP_DIR, { recursive: true })
    await dumpDatabase(path)
  } catch (e: any) {
    console.error('[BACKUP] mariadb-dump falhou:', e.message)
    await unlink(path).catch(() => {})
    return NextResponse.json({ success: false, message: `Falha no backup: ${e.message}` }, { status: 500 })
  }

  const { size } = await stat(path)
  if (size < 100) {
    await unlink(path).catch(() => {})
    return NextResponse.json({ success: false, message: 'O backup gerado está vazio. O banco tem tabelas?' }, { status: 500 })
  }
  const sizeMB = (size / (1024 * 1024)).toFixed(2)

  let discord: string | null = null
  const webhookUrl = process.env.BACKUP_WEBHOOK_URL
  if (webhookUrl) {
    if (size > DISCORD_LIMIT) {
      discord = 'Grande demais para o Discord (limite 25 MB); ficou só no servidor.'
    } else {
      try {
        await sendToDiscord(webhookUrl, path, sizeMB)
        discord = 'Enviado para o Discord.'
      } catch (e: any) {
        discord = `Falha ao enviar para o Discord: ${e.message}`
      }
    }
  }

  return NextResponse.json({
    success: true,
    file: name,
    size: `${sizeMB} MB`,
    downloadUrl: `/api/backup?file=${encodeURIComponent(name)}`,
    discord,
  })
}
