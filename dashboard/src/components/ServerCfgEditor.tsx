'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileCode, Save, RotateCcw, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

interface CfgFile {
  id: 'repo' | 'panel'
  path: string
  content: string
  mtime: number
  dirty: boolean
  generated?: boolean
}

const GENERATED_LABEL = {
  title: 'server.cfg (gerado pelo painel)',
  help: 'O repositório não tem server.cfg, então o painel criou este a partir das pastas de resources. Ele fica fora do git: o Sync nunca apaga e reinstalar mantém suas edições. Se um dia o repositório tiver um server.cfg, aquele passa a ser usado.',
}

const LABELS: Record<CfgFile['id'], { title: string; help: string }> = {
  repo: {
    title: 'server.cfg (repositório)',
    help: 'Arquivo do repositório de resources. Edições aqui ficam só neste servidor: o próximo Sync pode falhar ou descartá-las se o mesmo arquivo mudar no GitHub. Para mudanças definitivas, altere no repositório.',
  },
  panel: {
    title: 'Overrides do servidor (panel.cfg)',
    help: 'Carregado no lugar do server.cfg: faz exec do arquivo do repositório e depois aplica estes valores. Fica fora do git — o Sync nunca apaga. Use para segredos e ajustes só desta máquina.',
  },
}

export function ServerCfgEditor() {
  const [files, setFiles] = useState<CfgFile[]>([])
  const [active, setActive] = useState<CfgFile['id']>('repo')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<false | 'save' | 'restart'>(false)
  const [error, setError] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/servercfg', { cache: 'no-store' })
      const data = await res.json()
      if (!data.success) {
        setError(data.message || 'Erro ao carregar')
        return
      }
      setFiles(data.files)
      setDrafts(Object.fromEntries(data.files.map((f: CfgFile) => [f.id, f.content])))
      setActive(prev => (data.files.some((f: CfgFile) => f.id === prev) ? prev : data.files[0].id))
    } catch {
      setError('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const file = files.find(f => f.id === active)
  const draft = drafts[active] ?? ''
  const changed = !!file && draft !== file.content
  const anyChanged = files.some(f => drafts[f.id] !== f.content)

  // Avisa antes de sair com alterações não salvas.
  useEffect(() => {
    if (!anyChanged) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [anyChanged])

  const save = useCallback(async (restart: boolean) => {
    if (!file) return
    setSaving(restart ? 'restart' : 'save')
    try {
      const res = await fetch('/api/servercfg', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: file.id, content: draft, mtime: file.mtime, restart }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.message || 'Erro ao salvar')
        return
      }
      const content = draft.endsWith('\n') ? draft : draft + '\n'
      setFiles(fs => fs.map(f => (f.id === file.id ? { ...f, content, mtime: data.mtime, dirty: data.dirty } : f)))
      setDrafts(d => ({ ...d, [file.id]: content }))
      if (data.message) toast.warning(data.message)
      else toast.success(data.restarted ? 'Salvo e servidor reiniciando' : 'Salvo. Reinicie o servidor para aplicar.')
    } catch {
      toast.error('Erro de conexão')
    } finally {
      setSaving(false)
    }
  }, [file, draft])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      if (changed && !saving) save(false)
      return
    }
    // Tab insere indentação em vez de sair do campo.
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: s, selectionEnd: end } = el
      const next = draft.slice(0, s) + '    ' + draft.slice(end)
      setDrafts(d => ({ ...d, [active]: next }))
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4 })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando server.cfg...
      </div>
    )
  }

  if (error || !file) {
    return (
      <div className="p-6 rounded-xl border border-border bg-secondary/30 text-sm text-muted-foreground flex items-center justify-between">
        <span>{error || 'Nenhum arquivo disponível.'}</span>
        <button onClick={load} className="flex items-center gap-1.5 text-foreground hover:underline">
          <RefreshCw className="w-4 h-4" /> Tentar de novo
        </button>
      </div>
    )
  }

  const lineCount = draft.split('\n').length

  return (
    <div className="space-y-4">
      {files.length > 1 && (
        <div className="flex bg-background/50 rounded-lg p-1 gap-1 w-fit border border-border">
          {files.map(f => (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${active === f.id
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
            >
              {(f.generated ? GENERATED_LABEL : LABELS[f.id]).title}{drafts[f.id] !== f.content ? ' •' : ''}
            </button>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground max-w-4xl">{(file.generated ? GENERATED_LABEL : LABELS[file.id]).help}</p>

      {file.id === 'repo' && file.dirty && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-sm text-yellow-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Este arquivo tem alterações locais que não estão no GitHub.</span>
        </div>
      )}

      <div className="bg-secondary/30 rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/50 gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-mono text-foreground truncate">{file.path}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setDrafts(d => ({ ...d, [file.id]: file.content }))}
              disabled={!changed || !!saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Descartar
            </button>
            <button
              onClick={() => save(false)}
              disabled={!changed || !!saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
              title="Ctrl+S"
            >
              {saving === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
            </button>
            <button
              onClick={() => save(true)}
              disabled={!changed || !!saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-400 text-sm font-medium hover:bg-orange-500/20 disabled:opacity-40 transition-colors"
            >
              {saving === 'restart' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Salvar e reiniciar
            </button>
          </div>
        </div>

        <div className="flex h-[600px] font-mono text-sm">
          <div
            ref={gutterRef}
            aria-hidden
            className="select-none overflow-hidden py-3 pl-3 pr-3 text-right text-muted-foreground/60 bg-background/40 border-r border-border leading-6"
          >
            {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
          </div>
          <textarea
            ref={textRef}
            value={draft}
            onChange={e => setDrafts(d => ({ ...d, [file.id]: e.target.value }))}
            onKeyDown={onKeyDown}
            onScroll={e => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop }}
            spellCheck={false}
            wrap="off"
            className="flex-1 resize-none bg-transparent py-3 px-4 leading-6 text-foreground focus:outline-none overflow-auto"
          />
        </div>
      </div>
    </div>
  )
}
