'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ExternalLink, Copy, KeyRound, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

interface TxAdminInfo {
  mode: string
  port: string
  running: boolean
  hasAdmin: boolean
  pin: string | null
  serverData: string | null
  cfgPath: string | null
}

function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
      <code className="text-xs font-mono text-foreground truncate" title={value}>{value}</code>
      <button
        onClick={() => { navigator.clipboard.writeText(value); toast.success('Copiado') }}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        title="Copiar"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function TxAdminCard() {
  const [info, setInfo] = useState<TxAdminInfo | null>(null)
  const [host, setHost] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/txadmin', { cache: 'no-store' })
      const data = await res.json()
      if (data.success) setInfo(data)
    } catch { /* card some sem dados */ }
  }, [])

  useEffect(() => {
    setHost(window.location.hostname)
    load()
    // Enquanto o txAdmin não tem admin, o PIN pode aparecer a qualquer momento no boot.
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [load])

  if (!info || info.mode !== 'txadmin') return null
  const url = `http://${host}:${info.port}`

  if (info.hasAdmin) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-border bg-secondary/30 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-green-400" /> txAdmin configurado
        </span>
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:underline">
          Abrir txAdmin <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    )
  }

  return (
    <div className="p-5 rounded-xl border border-yellow-500/30 bg-yellow-500/5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-foreground flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-yellow-400" /> Configurar o txAdmin
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Abra o txAdmin, digite o PIN abaixo e crie a conta de administrador. Depois escolha <b>Existing Server Data</b> e use os caminhos abaixo.
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          Abrir txAdmin <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="flex items-center gap-4">
        {info.pin ? (
          <>
            <div className="font-mono text-4xl tracking-[0.4em] text-foreground select-all">{info.pin}</div>
            <button
              onClick={() => { navigator.clipboard.writeText(info.pin!); toast.success('PIN copiado') }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-secondary"
            >
              <Copy className="w-4 h-4" /> Copiar PIN
            </button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            {info.running ? 'Aguardando o txAdmin mostrar o PIN no log...' : 'O servidor está parado; inicie-o para gerar o PIN.'}
          </p>
        )}
      </div>

      {(info.serverData || info.cfgPath) && (
        <div className="space-y-1.5 pt-3 border-t border-yellow-500/20">
          {info.serverData && <CopyValue label="Server Data Folder" value={info.serverData} />}
          {info.cfgPath && <CopyValue label="CFG File Path" value={info.cfgPath} />}
        </div>
      )}
    </div>
  )
}
