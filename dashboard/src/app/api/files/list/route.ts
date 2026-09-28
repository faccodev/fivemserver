import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { BACKUP_DIR, verifyAuth } from '@/lib/panel'

const DATA_DIR = process.env.DATA_DIR || '/home/fivem/server-data'
const TX_DATA = '/home/fivem/txData'
const FIVEM_DIR = '/home/fivem/server'

const ALLOWED_ROOTS = [
  DATA_DIR,
  TX_DATA,
  FIVEM_DIR,
  BACKUP_DIR,
]


export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const targetPath = searchParams.get('path') || ''

  try {
    if (!targetPath) {
      const rootDirs = await Promise.all(ALLOWED_ROOTS.map(async (root) => {
        try {
          await fs.stat(root)
          return {
            name: path.basename(root) || root,
            path: root,
            isDirectory: true,
            size: 0,
            isRoot: true
          }
        } catch {
          return null
        }
      }))

      return NextResponse.json({
        success: true,
        files: rootDirs.filter(Boolean),
        currentPath: ''
      })
    }

    const absolutePath = path.resolve(targetPath)

    const isAllowed = ALLOWED_ROOTS.some(root => absolutePath.startsWith(root))
    if (!isAllowed) {
      return NextResponse.json({ success: false, message: 'Acesso negado a este diretório' }, { status: 403 })
    }

    const items = await fs.readdir(absolutePath)

    const fileList = await Promise.all(items.map(async (item) => {
      const itemPath = path.join(absolutePath, item)
      try {
        const stat = await fs.stat(itemPath)
        return {
          name: item,
          path: itemPath,
          isDirectory: stat.isDirectory(),
          size: stat.isDirectory() ? 0 : stat.size,
          modifiedAt: stat.mtime
        }
      } catch {
        return null
      }
    }))

    const sortedFiles = fileList
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
        return a.isDirectory ? -1 : 1
      })

    return NextResponse.json({
      success: true,
      files: sortedFiles,
      currentPath: absolutePath
    })

  } catch (error: any) {
    console.error('[FILE MANAGER ERROR]', error)
    return NextResponse.json({
      success: false,
      message: error.message || 'Erro ao listar diretório'
    }, { status: 500 })
  }
}
