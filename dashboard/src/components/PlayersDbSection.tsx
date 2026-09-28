'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Users, ShieldCheck, Download, Upload, Loader2, AlertTriangle, X } from 'lucide-react'
import { toast } from 'sonner'

type Kind = 'players' | 'admins'

interface FileInfo {
  path: string
  exists: boolean
  size?: number
  modified?: string
  corrupt?: boolean
  players?: number
  actions?: number
  whitelist?: number
  admins?: number
}

interface Info {
  running: boolean
  players: FileInfo
  admins: FileInfo
}

const META: Record<Kind, { title: string; file: string; icon: typeof Users; color: string }> = {
  players: { title: 'Jogadores (txAdmin)', file: 'playersDB.json', icon: Users, color: 'text-purple-400' },
  admins: { title: 'Admins (txAdmin)', file: 'admins.json', icon: ShieldCheck, color: 'text-cyan-400' },
}

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function summary(kind: Kind, f: FileInfo) {
  if (!f.exists) return 'Arquivo ainda não existe (o txAdmin cria no primeiro uso).'
  if (f.corrupt) return 'Arquivo existe mas não é um JSON válido.'
  const when = f.modified ? new Date(f.modified).toLocaleString('pt-BR') : ''
  const counts = kind === 'players'
    ? `${f.players} jogadores · ${f.actions} bans/warns · ${f.whitelist} na whitelist`
    : `${f.admins} admins`
  return `${counts} · ${formatSize(f.size)} · ${when}`
}

export function PlayersDbSection() {
  const [info, setInfo] = useState<Info | null>(null)
  const [pending, setPending] = useState<{ kind: Kind; file: File } | null>(null)
  const [importing, setImporting] = useState(false)
  const inputs = { players: useRef<HTMLInputElement>(null), admins: useRef<HTMLInputElement>(null) }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/players', { cache: 'no-store' })
      const data = await res.json()
      if (data.success) setInfo(data)
    } catch { /* seção mostra estado vazio */ }
  }, [])

  useEffect(() => { load() }, [load])

  const doImport = async () => {
    if (!pending) return
    setImporting(true)
    try {
      const form = new FormData()
      form.append('kind', pending.kind)
      form.append('file', pending.file)
      const res = await fetch('/api/players', { method: 'POST', body: form })
      const data = await res.json()
      if (data.success) {
        toast.success(`${META[pending.kind].file} importado`)
        setPending(null)
        load()
      } else {
        toast.error(data.message || 'Erro ao importar')
      }
    } catch {
      toast.error('Erro de conexão')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-medium text-foreground">Dados do txAdmin</h3>
        <p className="text-sm text-muted-foreground">
          Exporte ou importe jogadores, bans, warns, whitelist e contas de admin do txAdmin. Dados de personagem (dinheiro, inventário) ficam no MySQL — use o Backup DB.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.keys(META) as Kind[]).map(kind => {
          const meta = META[kind]
          const Icon = meta.icon
          const f = info?.[kind]
          return (
            <div key={kind} className="p-5 bg-secondary/50 rounded-xl border border-border space-y-4">
              <div className="flex items-start gap-3">
                <div className={`p-3 rounded-lg bg-secondary ${meta.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-medium text-foreground">{meta.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{f ? summary(kind, f) : 'Carregando...'}</p>
                  {f && <p className="text-xs text-muted-foreground/70 font-mono truncate mt-0.5" title={f.path}>{f.path}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={f?.exists ? `/api/players?download=${kind}` : undefined}
                  aria-disabled={!f?.exists}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium transition-colors ${f?.exists ? 'text-foreground hover:bg-secondary' : 'text-muted-foreground opacity-40 pointer-events-none'}`}
                >
                  <Download className="w-4 h-4" /> Exportar
                </a>
                <button
                  onClick={() => inputs[kind].current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                >
                  <Upload className="w-4 h-4" /> Importar
                </button>
                <input
                  ref={inputs[kind]}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) setPending({ kind, file })
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {pending && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Importar {META[pending.kind].file}</h3>
              <button onClick={() => setPending(null)} disabled={importing} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Arquivo: <span className="font-mono text-foreground">{pending.file.name}</span> ({formatSize(pending.file.size)})
            </p>
            <div className="flex items-start gap-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-sm text-yellow-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                O arquivo atual será substituído (uma cópia de segurança fica na mesma pasta).
                {info?.running && ' O servidor será parado durante a importação e iniciado de novo em seguida — jogadores online serão desconectados.'}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPending(null)}
                disabled={importing}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={doImport}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Importar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
