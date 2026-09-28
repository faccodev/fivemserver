'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Server, GitBranch, KeyRound, Database, Loader2, CheckCircle2, XCircle, ChevronDown, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

interface SetupInfo {
  setupMode: boolean
  managed: boolean
  state: string
  current: null | {
    gitRepo: string
    gitBranch: string
    hasToken: boolean
    hasLicense: boolean
    hasSteamKey: boolean
    maxClients: string
    serverMode: 'txadmin' | 'direct'
    db: { host: string; port: string; user: string; name: string }
  }
}

const input = 'w-full h-11 px-3 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary'
const label = 'text-sm font-medium text-foreground'
const hint = 'text-xs text-muted-foreground'

function Field({ title, help, children }: { title: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className={label}>{title}</span>
      {children}
      {help && <span className={`block ${hint}`}>{help}</span>}
    </label>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof Server; title: string; children: React.ReactNode }) {
  return (
    <section className="p-5 rounded-xl border border-border bg-secondary/30 space-y-4">
      <h2 className="font-medium text-foreground flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" /> {title}
      </h2>
      {children}
    </section>
  )
}

function SetupWizard() {
  const token = useSearchParams().get('token') || ''
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [view, setView] = useState<'form' | 'progress'>('form')
  const [submitting, setSubmitting] = useState(false)
  const [state, setState] = useState('idle')
  const [log, setLog] = useState('')
  const [showDb, setShowDb] = useState(false)
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const sawDone = useRef(false)

  const [form, setForm] = useState({
    password: '', confirm: '',
    gitRepo: '', gitBranch: '', gitToken: '',
    serverMode: 'txadmin' as 'txadmin' | 'direct',
    licenseKey: '', steamKey: '', maxClients: '',
    dbHost: '', dbPort: '3306', dbUser: '', dbPassword: '', dbName: '',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    fetch('/api/setup', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: SetupInfo) => {
        setInfo(d)
        if (d.current) {
          setForm(f => ({
            ...f,
            gitRepo: d.current!.gitRepo,
            gitBranch: d.current!.gitBranch,
            serverMode: d.current!.serverMode,
            maxClients: d.current!.maxClients,
          }))
        }
        if (d.state === 'running') setView('progress')
      })
      .catch(() => setInfo({ setupMode: false, managed: false, state: 'idle', current: null }))
  }, [])

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/setup/progress?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      if (!res.ok) return
      const d = await res.json()
      setState(d.state)
      setLog(d.log)
      if (d.state === 'done') sawDone.current = true
    } catch {
      // O painel reinicia no fim da instalação: erro de rede aqui é esperado.
    }
  }, [token])

  useEffect(() => {
    if (view !== 'progress') return
    poll()
    const id = setInterval(() => {
      if (sawDone.current) return clearInterval(id)
      poll()
    }, 1500)
    return () => clearInterval(id)
  }, [view, poll])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  const reconfigure = !!info?.current
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Senha vazia: mantém a atual (reconfiguração) ou é gerada (primeira instalação).
    if (form.password) {
      if (form.password.length < 8) return toast.error('A senha precisa ter pelo menos 8 caracteres')
      if (form.password !== form.confirm) return toast.error('As senhas não conferem')
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupToken: token,
          password: form.password,
          gitRepo: form.gitRepo,
          gitBranch: form.gitBranch,
          gitToken: form.gitToken,
          serverMode: form.serverMode,
          licenseKey: form.licenseKey,
          steamKey: form.steamKey,
          maxClients: form.maxClients,
          db: showDb ? { host: form.dbHost, port: form.dbPort, user: form.dbUser, password: form.dbPassword, name: form.dbName } : undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.message || 'Erro ao iniciar a instalação')
        return
      }
      sawDone.current = false
      setGeneratedPassword(data.generatedPassword || null)
      setState('running')
      setLog('')
      setView('progress')
    } catch {
      toast.error('Erro de conexão')
    } finally {
      setSubmitting(false)
    }
  }

  if (!info) {
    return <div className="flex justify-center py-24 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }

  if (!info.managed) {
    return (
      <Notice title="Instalação automática indisponível">
        Este painel não foi instalado pelo <span className="font-mono">install.sh</span>. Configure pelas variáveis de ambiente ou reinstale com o comando do README.
      </Notice>
    )
  }

  if (!info.setupMode && !info.current) {
    return (
      <Notice title="Painel já configurado">
        Entre com a senha do painel para alterar a configuração.
        <Link href="/" className="mt-4 inline-flex items-center gap-2 text-primary hover:underline">Ir para o login <ArrowRight className="w-4 h-4" /></Link>
      </Notice>
    )
  }

  if (info.setupMode && !token) {
    return (
      <Notice title="Link de instalação incompleto">
        Use o link completo mostrado no terminal ao final do <span className="font-mono">install.sh</span> (termina com <span className="font-mono">?token=…</span>).
      </Notice>
    )
  }

  if (view === 'progress') {
    const done = state === 'done'
    const failed = state === 'failed'
    const dataFolder = log.match(/Server Data Folder:\s*(.+)/)?.[1]?.trim()
    const cfgPath = log.match(/CFG File Path:\s*(.+)/)?.[1]?.trim()
    const host = typeof window !== 'undefined' ? window.location.hostname : 'seu-servidor'
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          {done ? <CheckCircle2 className="w-6 h-6 text-green-400" /> : failed ? <XCircle className="w-6 h-6 text-red-400" /> : <Loader2 className="w-6 h-6 animate-spin text-primary" />}
          <h1 className="text-xl font-semibold text-foreground">
            {done ? 'Instalação concluída' : failed ? 'A instalação falhou' : 'Instalando...'}
          </h1>
        </div>

        <pre ref={logRef} className="h-[420px] overflow-auto rounded-xl border border-border bg-black/40 p-4 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
          {log || 'Iniciando...'}
        </pre>

        {done && (
          <div className="p-5 rounded-xl border border-green-500/30 bg-green-500/5 space-y-3 text-sm">
            {form.serverMode === 'txadmin' ? (
              <>
                <p className="text-foreground font-medium">Último passo: configurar o txAdmin</p>
                <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                  <li>Abra <a className="text-primary hover:underline" href={`http://${host}:40120`} target="_blank" rel="noreferrer">http://{host}:40120</a></li>
                  <li>Entre com o usuário <span className="font-mono text-foreground">admin</span> e a senha do painel{reconfigure ? ' (definida na primeira instalação)' : ''}. Se o txAdmin pedir um PIN, ele aparece na aba Monitor do painel.</li>
                  <li>No assistente, escolha <b>Existing Server Data</b> e use:
                    <div className="mt-1 font-mono text-xs text-foreground space-y-0.5">
                      <div>Server Data Folder: {dataFolder || '(veja o log acima)'}</div>
                      <div>CFG File Path: {cfgPath || '(veja o log acima)'}</div>
                    </div>
                  </li>
                </ol>
              </>
            ) : (
              <p className="text-foreground">O servidor FiveM foi iniciado. Acompanhe pela aba Logs do painel.</p>
            )}
            {generatedPassword && (
              <div className="p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                <p className="text-yellow-300 text-xs">Senha gerada para o painel e para o admin do txAdmin — anote agora, ela não aparece de novo:</p>
                <p className="font-mono text-base text-foreground mt-1 select-all">{generatedPassword}</p>
                <p className="text-xs text-muted-foreground mt-1">Se perder: sudo grep DASHBOARD_PASSWORD /home/fivem/.panel/dashboard.env</p>
              </div>
            )}
            <p className="text-muted-foreground">O painel reinicia sozinho para aplicar a nova configuração.</p>
            <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90">
              Ir para o painel <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {failed && (
          <button onClick={() => setView('form')} className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-secondary">
            Voltar e corrigir
          </button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{reconfigure ? 'Configuração do servidor' : 'Instalar servidor FiveM'}</h1>
        <p className="text-muted-foreground mt-1">
          {reconfigure
            ? 'Alterar e salvar roda a instalação de novo: sincroniza o repositório, regrava a configuração e reinicia o servidor. Campos secretos vazios mantêm o valor atual.'
            : 'Informe o repositório com seus resources. O painel clona, baixa o FXServer recomendado, configura e inicia tudo.'}
        </p>
      </div>

      <Section icon={KeyRound} title="Acesso ao painel">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field title="Senha do painel" help={reconfigure ? 'Deixe vazio para manter a atual.' : 'Deixe vazio para gerar uma senha forte automaticamente. Também é a senha do usuário admin do txAdmin.'}>
            <input type="password" className={input} value={form.password} onChange={set('password')} autoComplete="new-password" placeholder={reconfigure ? 'Manter atual' : 'Gerar automaticamente'} />
          </Field>
          <Field title="Confirmar senha">
            <input type="password" className={input} value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required={!!form.password} disabled={!form.password} />
          </Field>
        </div>
      </Section>

      <Section icon={GitBranch} title="Repositório de resources">
        <Field title="URL do repositório no GitHub" help="Precisa conter um server.cfg (na raiz ou em uma subpasta) e a pasta resources/ ao lado dele.">
          <input className={input} value={form.gitRepo} onChange={set('gitRepo')} placeholder="https://github.com/usuario/meu-servidor" required />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field title="Token do GitHub" help={<>Só para repositórios privados. Crie em GitHub → Settings → Developer settings → <i>Fine-grained token</i> com leitura de <i>Contents</i>.{info.current?.hasToken && ' Vazio = manter o atual.'}</>}>
            <input type="password" className={input} value={form.gitToken} onChange={set('gitToken')} placeholder={info.current?.hasToken ? '•••••••• (configurado)' : 'github_pat_… ou ghp_…'} autoComplete="off" />
          </Field>
          <Field title="Branch" help="Vazio = branch padrão do repositório.">
            <input className={input} value={form.gitBranch} onChange={set('gitBranch')} placeholder="main" />
          </Field>
        </div>
      </Section>

      <Section icon={Server} title="Servidor FiveM">
        <div className="grid sm:grid-cols-2 gap-3">
          {([
            ['txadmin', 'Com txAdmin (recomendado)', 'Painel do txAdmin na porta 40120: bans, whitelist, console e restart agendado.'],
            ['direct', 'Direto (sem txAdmin)', 'FXServer roda sozinho com o server.cfg. Mais simples, sem o painel do txAdmin.'],
          ] as const).map(([value, title, desc]) => (
            <label key={value} className={`p-4 rounded-lg border cursor-pointer transition-colors ${form.serverMode === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/50'}`}>
              <input type="radio" name="mode" value={value} checked={form.serverMode === value} onChange={() => setForm(f => ({ ...f, serverMode: value }))} className="sr-only" />
              <span className="block text-sm font-medium text-foreground">{title}</span>
              <span className={`block mt-1 ${hint}`}>{desc}</span>
            </label>
          ))}
        </div>
        <Field title="License key (opcional)" help={<>Gere em <a className="text-primary hover:underline" href="https://portal.cfx.re" target="_blank" rel="noreferrer">portal.cfx.re</a>. Se preenchida, substitui a do server.cfg.{info.current?.hasLicense && ' Vazio = manter a atual.'}</>}>
          <input className={input} value={form.licenseKey} onChange={set('licenseKey')} placeholder="cfxk_…" autoComplete="off" />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field title="Steam Web API key (opcional)" help={<>Gere em <a className="text-primary hover:underline" href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">steamcommunity.com/dev/apikey</a>.{info.current?.hasSteamKey && ' Vazio = manter a atual.'}</>}>
            <input className={input} value={form.steamKey} onChange={set('steamKey')} autoComplete="off" />
          </Field>
          <Field title="Slots (opcional)" help="Vazio = usar o sv_maxclients do server.cfg.">
            <input className={input} value={form.maxClients} onChange={set('maxClients')} inputMode="numeric" placeholder="48" />
          </Field>
        </div>
      </Section>

      <section className="rounded-xl border border-border bg-secondary/30">
        <button type="button" onClick={() => setShowDb(v => !v)} className="w-full p-5 flex items-center justify-between text-left">
          <span className="font-medium text-foreground flex items-center gap-2"><Database className="w-4 h-4 text-primary" /> Banco de dados externo (avançado)</span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showDb ? 'rotate-180' : ''}`} />
        </button>
        {showDb && (
          <div className="px-5 pb-5 space-y-4">
            <p className={hint}>
              O instalador já criou um banco MariaDB neste servidor, com usuário e senha gerados, e o usa por padrão.
              Preencha só se quiser usar outro servidor MySQL. Se o repositório tiver um arquivo .sql e o banco estiver vazio, ele é importado automaticamente.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2"><Field title="Host"><input className={input} value={form.dbHost} onChange={set('dbHost')} placeholder="127.0.0.1" /></Field></div>
              <Field title="Porta"><input className={input} value={form.dbPort} onChange={set('dbPort')} /></Field>
              <Field title="Usuário"><input className={input} value={form.dbUser} onChange={set('dbUser')} /></Field>
              <Field title="Senha"><input type="password" className={input} value={form.dbPassword} onChange={set('dbPassword')} placeholder={reconfigure ? 'Vazio = manter' : ''} autoComplete="off" /></Field>
              <Field title="Banco"><input className={input} value={form.dbName} onChange={set('dbName')} /></Field>
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-4">
        {reconfigure ? <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">Cancelar</Link> : <span />}
        <button type="submit" disabled={submitting} className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {reconfigure ? 'Salvar e reinstalar' : 'Instalar'}
        </button>
      </div>
    </form>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-6 rounded-xl border border-border bg-secondary/30">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <div className="text-sm text-muted-foreground mt-2">{children}</div>
    </div>
  )
}

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Suspense fallback={null}>
          <SetupWizard />
        </Suspense>
      </div>
    </div>
  )
}
