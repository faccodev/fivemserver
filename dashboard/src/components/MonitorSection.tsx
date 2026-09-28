'use client'

import { useState, useEffect, useCallback } from 'react'
import { Cpu, HardDrive, MemoryStick, Server, RefreshCw, Activity, Wifi } from 'lucide-react'
import { toast } from 'sonner'

interface ProcessEntry {
  pid: number
  name: string
  memPercent: number
  memRss: string
}

interface MonitorData {
  timestamp: string
  cpu: { used: string; usedRaw: number; cores: number }
  memory: {
    total: string; used: string; free: string; buffers: string
    usedPercent: string; usedRaw: number
  }
  disk: {
    root: { total: string; used: string; free: string; usedPercent: string; usedRaw: number }
    opt: { total: string; used: string; free: string; usedPercent: string; usedRaw: number }
  }
  serverData: { size: string; files: string }
  fivem: { running: boolean; uptime: string }
  network: { rx: string; tx: string }
  processes: ProcessEntry[]
}

function PieChart({ percent, color, size = 120, stroke = 14, label }: {
  percent: number; color: string; size?: number; stroke?: number; label?: string
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (percent / 100) * circ

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke="currentColor"
            className="text-border"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-foreground">{percent.toFixed(0)}%</span>
        </div>
      </div>
      {label && <span className="text-xs text-muted-foreground font-medium">{label}</span>}
    </div>
  )
}

function ProgressBar({ label, value, total, color, subLabel }: {
  label: string; value: string; total: string; color: string; subLabel?: string
}) {
  const pct = total ? (parseFloat(value) / parseFloat(total) * 100) : 0
  const pctClamped = Math.min(pct, 100)

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          {value} <span className="text-muted-foreground/50">/ {total}</span>
        </span>
      </div>
      <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pctClamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

export function MonitorSection() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchMonitor = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor')
      const json = await res.json()
      if (json.success) {
        setData(json)
        setLastUpdate(new Date())
      }
    } catch {
      toast.error('Erro ao buscar dados do monitor')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMonitor()
    const interval = setInterval(fetchMonitor, 5000)
    return () => clearInterval(interval)
  }, [fetchMonitor])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchMonitor()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const cpuColor = data.cpu.usedRaw > 80 ? '#ef4444' : data.cpu.usedRaw > 60 ? '#f59e0b' : '#22c55e'
  const memColor = data.memory.usedRaw > 85 ? '#ef4444' : data.memory.usedRaw > 70 ? '#f59e0b' : '#3b82f6'
  const diskColor = data.disk.opt.usedRaw > 90 ? '#ef4444' : data.disk.opt.usedRaw > 75 ? '#f59e0b' : '#8b5cf6'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Monitor do Sistema</h2>
          {lastUpdate && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Atualizado às {lastUpdate.toLocaleTimeString('pt-BR')}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border transition-colors text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* FiveM Status */}
        <div className="bg-secondary/30 rounded-xl border border-border p-4 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${data.fivem.running ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
            <Server className={`w-5 h-5 ${data.fivem.running ? 'text-green-400' : 'text-red-400'}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">FiveM</p>
            <p className={`text-sm font-semibold ${data.fivem.running ? 'text-green-400' : 'text-red-400'}`}>
              {data.fivem.running ? 'Online' : 'Offline'}
            </p>
          </div>
        </div>

        {/* CPU */}
        <div className="bg-secondary/30 rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">CPU</p>
            <p className="text-sm font-semibold text-foreground">{data.cpu.cores} cores</p>
            <p className="text-xs font-medium" style={{ color: cpuColor }}>{data.cpu.used}</p>
          </div>
        </div>

        {/* Memory */}
        <div className="bg-secondary/30 rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <MemoryStick className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">RAM</p>
            <p className="text-sm font-semibold text-foreground">{data.memory.total}</p>
            <p className="text-xs font-medium" style={{ color: memColor }}>{data.memory.usedPercent}</p>
          </div>
        </div>

        {/* Network */}
        <div className="bg-secondary/30 rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Rede</p>
            <p className="text-xs font-mono text-foreground">↑ {data.network.tx}</p>
            <p className="text-xs font-mono text-muted-foreground">↓ {data.network.rx}</p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* CPU Chart */}
        <div className="bg-secondary/30 rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-6">
            <Cpu className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-semibold text-foreground">CPU</h3>
            <span className="ml-auto text-xs text-muted-foreground">{data.cpu.cores} cores</span>
          </div>
          <div className="flex items-center justify-center">
            <PieChart percent={data.cpu.usedRaw} color={cpuColor} size={140} stroke={16} />
          </div>
          <div className="mt-4 flex justify-between text-xs text-muted-foreground">
            <span>Livre: {(100 - data.cpu.usedRaw).toFixed(1)}%</span>
            <span>Usado: {data.cpu.used}</span>
          </div>
        </div>

        {/* Memory Chart */}
        <div className="bg-secondary/30 rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-6">
            <MemoryStick className="w-5 h-5 text-violet-400" />
            <h3 className="text-sm font-semibold text-foreground">Memória RAM</h3>
          </div>
          <div className="flex items-center justify-center">
            <PieChart percent={data.memory.usedRaw} color={memColor} size={140} stroke={16} />
          </div>
          <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" /> Usado</span>
              <span>{data.memory.used}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400/50 inline-block" /> Cache/Buff</span>
              <span>{data.memory.buffers}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-secondary inline-block" /> Livre</span>
              <span>{data.memory.free}</span>
            </div>
          </div>
        </div>

        {/* Disk Chart */}
        <div className="bg-secondary/30 rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-6">
            <HardDrive className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-semibold text-foreground">Disco /opt</h3>
          </div>
          <div className="flex items-center justify-center">
            <PieChart percent={data.disk.opt.usedRaw} color={diskColor} size={140} stroke={16} />
          </div>
          <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Usado</span>
              <span className="text-foreground">{data.disk.opt.used}</span>
            </div>
            <div className="flex justify-between">
              <span>Livre</span>
              <span className="text-green-400">{data.disk.opt.free}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span>{data.disk.opt.total}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Storage Breakdown */}
        <div className="bg-secondary/30 rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Armazenamento Detalhado</h3>
          </div>
          <div className="space-y-4">
            <ProgressBar
              label="Raiz (/)"
              value={data.disk.root.used}
              total={data.disk.root.total}
              color="#64748b"
              subLabel={data.disk.root.free + ' livre'}
            />
            <ProgressBar
              label="/opt (FiveM)"
              value={data.disk.opt.used}
              total={data.disk.opt.total}
              color="#8b5cf6"
            />
            <div className="pt-2 border-t border-border">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity className="w-3.5 h-3.5" />
                  Dados do Servidor
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{data.serverData.size}</p>
                  <p className="text-xs text-muted-foreground">{data.serverData.files} arquivos</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FiveM Info */}
        <div className="bg-secondary/30 rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">FiveM</h3>
            <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${data.fivem.running ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {data.fivem.running ? 'Rodando' : 'Parado'}
            </span>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Porta do jogo</span>
              <span className="text-foreground font-mono">30120</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">txAdmin</span>
              <span className="text-foreground font-mono">40120</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Dashboard</span>
              <span className="text-foreground font-mono">443 (HTTPS)</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Uptime</span>
              <span className="text-foreground font-mono text-xs">{data.fivem.uptime || 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Processes */}
      {data.processes && data.processes.length > 0 && (
        <div className="bg-secondary/30 rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Processos (RAM)</h3>
            <span className="ml-auto text-xs text-muted-foreground">Top {data.processes.length} por uso de memória</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted-foreground pb-3 pr-4">Processo</th>
                  <th className="text-right text-xs font-medium text-muted-foreground pb-3 w-20">PID</th>
                  <th className="text-right text-xs font-medium text-muted-foreground pb-3 w-24">% RAM</th>
                  <th className="text-right text-xs font-medium text-muted-foreground pb-3 w-24">Usado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.processes.map((proc) => {
                  const barColor = proc.memPercent > 15 ? '#ef4444' : proc.memPercent > 8 ? '#f59e0b' : '#22c55e'
                  return (
                    <tr key={proc.pid} className="group">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-foreground truncate max-w-[200px]" title={proc.name}>
                            {proc.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="text-xs font-mono text-muted-foreground">{proc.pid}</span>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(proc.memPercent, 100)}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <span className="text-xs font-medium w-10 text-right" style={{ color: barColor }}>
                            {proc.memPercent.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="text-xs font-mono text-muted-foreground">{proc.memRss}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
