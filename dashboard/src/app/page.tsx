'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, ArrowRight, Server, Shield, Wrench } from 'lucide-react'
import { toast } from 'sonner'

export default function Home() {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [remember, setRemember] = useState(false)
  const [setupMode, setSetupMode] = useState(false)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/setup', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setSetupMode(!!d.setupMode))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const savedPassword = localStorage.getItem('dashboard_password')
    const savedRemember = localStorage.getItem('dashboard_remember')
    if (savedPassword && savedRemember === 'true') {
      setPassword(savedPassword)
      setRemember(true)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    if (remember) {
      localStorage.setItem('dashboard_password', password)
      localStorage.setItem('dashboard_remember', 'true')
    } else {
      localStorage.removeItem('dashboard_password')
      localStorage.setItem('dashboard_remember', 'false')
    }

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success('Bem-vindo ao painel de controle')
        router.push('/dashboard')
      } else {
        toast.error(data.message || 'Senha inválida')
      }
    } catch {
      toast.error('Erro ao conectar ao servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Server className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">FiveM Dashboard</h1>
          <p className="text-muted-foreground mt-2">Painel de controle do servidor</p>
        </div>

        {setupMode ? (
          <div className="p-5 rounded-xl border border-primary/30 bg-primary/5 space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" /> Instalação pendente
            </p>
            <p className="text-sm text-muted-foreground">
              Este painel ainda não foi configurado. Abra o link de instalação que o instalador mostrou no terminal
              (<span className="font-mono">/setup?token=…</span>). Se perdeu o link, rode no servidor:
            </p>
            <pre className="text-xs font-mono bg-background/60 border border-border rounded-md p-2 overflow-x-auto">sudo grep SETUP_TOKEN /home/fivem/.panel/dashboard.env</pre>
          </div>
        ) : (
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Senha de acesso
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-12 pl-10 pr-4 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background transition-all"
                placeholder="Digite sua senha"
                disabled={loading}
                autoFocus
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-border bg-secondary text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
              />
              Salvar senha por 30 dias
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full h-12 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <>
                Acessar painel
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          Sistema de administração do servidor
        </p>
      </div>
    </div>
  )
}