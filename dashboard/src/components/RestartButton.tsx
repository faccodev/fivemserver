'use client'

import { useState } from 'react'
import { RotateCcw, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

export function RestartButton() {
    const [loading, setLoading] = useState(false)
    const [confirming, setConfirming] = useState(false)

    const handleRestart = async () => {
        if (!confirming) {
            setConfirming(true)
            return
        }

        setLoading(true)
        setConfirming(false)
        try {
            const response = await fetch('/api/restart', { method: 'POST' })
            const data = await response.json()

            if (data.success) {
                toast.success('Servidor reiniciando...')
            } else {
                toast.error(data.message || 'Erro ao reiniciar')
            }
        } catch {
            toast.error('Erro de conexão ao reiniciar')
        } finally {
            setLoading(false)
        }
    }

    const cancelConfirm = () => setConfirming(false)

    return (
        <>
            <button
                onClick={handleRestart}
                disabled={loading}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${
                    confirming
                        ? 'bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30'
                        : 'bg-orange-500/10 border-orange-500/20 text-orange-400 hover:bg-orange-500/20'
                }`}
                title="Reiniciar servidor FiveM"
            >
                {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : confirming ? (
                    <AlertTriangle className="w-4 h-4" />
                ) : (
                    <RotateCcw className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">
                    {confirming ? 'Confirmar?' : 'Reiniciar'}
                </span>
            </button>

            {confirming && (
                <button
                    onClick={cancelConfirm}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-border text-xs text-muted-foreground hover:bg-secondary transition-colors"
                >
                    Cancelar
                </button>
            )}
        </>
    )
}
