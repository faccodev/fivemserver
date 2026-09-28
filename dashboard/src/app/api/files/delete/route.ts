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

export async function POST(request: NextRequest) {
    if (!(await verifyAuth(request))) {
        return NextResponse.json({ success: false, message: 'Não autorizado' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const { targetPath } = body

        if (!targetPath) {
            return NextResponse.json({ success: false, message: 'Caminho não especificado' }, { status: 400 })
        }

        const absolutePath = path.resolve(targetPath)

        // Security check: ensure path is within allowed roots AND NOT the root itself
        const isAllowed = ALLOWED_ROOTS.some(root => absolutePath.startsWith(root) && absolutePath !== root)
        if (!isAllowed) {
            return NextResponse.json({
                success: false,
                message: 'Acesso negado: não é possível excluir este diretório (raiz ou fora do escopo)'
            }, { status: 403 })
        }

        await fs.rm(absolutePath, { recursive: true, force: true })

        return NextResponse.json({
            success: true,
            message: 'Criado/Excluído com sucesso'
        })

    } catch (error: any) {
        console.error('[FILE MANAGER DELETE ERROR]', error)
        return NextResponse.json({
            success: false,
            message: error.message || 'Erro ao excluir arquivo ou diretório'
        }, { status: 500 })
    }
}
