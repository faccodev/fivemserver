'use client'

import { useState } from 'react'
import { GitPullRequest, Loader2, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'

export function SyncButton() {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSync = async () => {
    setLoading(true)
    setDone(false)
    try {
      const response = await fetch('/api/sync', { method: 'POST' })
      const data = await response.json()

      if (data.success) {
        toast.success(data.lastCommit ? `Sincronizado: ${data.lastCommit}` : 'Código sincronizado!')
        setDone(true)
        setTimeout(() => setDone(false), 4000)
      } else {
        toast.error(data.message || data.output || 'Erro ao sincronizar')
      }
    } catch {
      toast.error('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 transition-colors disabled:opacity-50 text-sm font-medium"
      title="Sincronizar código do GitHub"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : done ? (
        <CheckCircle className="w-4 h-4" />
      ) : (
        <GitPullRequest className="w-4 h-4" />
      )}
      <span className="hidden sm:inline">{done ? 'Sincronizado!' : 'Sync Git'}</span>
    </button>
  )
}
