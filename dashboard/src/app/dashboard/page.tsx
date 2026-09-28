'use client'

import { useState, useEffect, useRef } from 'react'
import { MonitorSection } from '@/components/MonitorSection'
import { FileViewer } from '@/components/FileViewer'
import { ServerCfgEditor } from '@/components/ServerCfgEditor'
import { PlayersDbSection } from '@/components/PlayersDbSection'
import { TxAdminCard } from '@/components/TxAdminCard'
import {
  Trash2,
  Terminal as TerminalIcon,
  Play,
  Loader2,
  HardDrive,
  RefreshCw,
  AlertTriangle,
  Database,
  Upload,
  X,
  File as FileIcon,
  Folder as FolderIcon,
  Home,
  ChevronRight,
  Activity,
  Eye,
  Code,
} from 'lucide-react'
import { toast } from 'sonner'

interface LogLine {
  type: 'stdout' | 'stderr' | 'system' | 'error' | 'success'
  message: string
  timestamp: Date
}

// Removed Actions array

export default function Dashboard() {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [activeTab, setActiveTab] = useState<'monitor' | 'logs' | 'bd' | 'cfg' | 'storage' | 'files'>('monitor')
  const [logSource, setLogSource] = useState<'fivem' | 'txadmin'>('fivem')

  // Storage state
  const [storageInfo, setStorageInfo] = useState<any[]>([])
  const [cleanTargets, setCleanTargets] = useState<any[]>([])
  const [loadingStorage, setLoadingStorage] = useState(false)
  const [cleaningTarget, setCleaningTarget] = useState<string | null>(null)

  // Backup/Restore state
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)

  // Git Sync state
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ branch: string; lastCommit: string; commitsAhead: string; commitsBehind: string } | null>(null)

  // File Manager state
  const [currentPath, setCurrentPath] = useState<string>('')
  const [files, setFiles] = useState<any[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)

  // File Viewer state
  const [viewerFile, setViewerFile] = useState<{ path: string; name: string } | null>(null)

  // Delete confirmation modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string } | null>(null)

  const filteredLogs = logs.filter(log => {
    if (log.type === 'system') return true

    // FiveM logs: server.log, citizen.log, console.log
    // txAdmin logs: FXServer.log, fivem.log

    const isFiveM = log.message.includes('[server.log]') ||
      log.message.includes('[citizen.log]') ||
      log.message.includes('[console.log]')

    const isTxAdmin = log.message.includes('[FXServer.log]') ||
      log.message.includes('[fivem.log]')

    if (logSource === 'fivem') {
      return isFiveM
    } else {
      return isTxAdmin
    }
  })

  const executeAction = async (actionId: string) => {
    if (actionId === 'backup') {
      setShowBackupModal(true)
      return
    }
    if (actionId === 'restore') {
      setShowRestoreModal(true)
      return
    }
  }

  useEffect(() => {
    const connectStream = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      const eventSource = new EventSource('/api/logs')
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        setIsStreaming(true)
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          const newLog: LogLine = {
            type: data.type,
            message: data.message,
            timestamp: new Date()
          }
          setLogs(prev => [...prev, newLog])
        } catch {
        }
      }

      eventSource.onerror = () => {
        setIsStreaming(false)
        eventSource.close()
        setTimeout(connectStream, 3000)
      }
    }

    connectStream()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Fetch storage info when storage tab is active
  useEffect(() => {
    if (activeTab === 'storage') {
      fetchStorageInfo()
      fetchCleanTargets()
    } else if (activeTab === 'files') {
      fetchFiles(currentPath)
    } else if (activeTab === 'bd') {
      fetchSyncStatus()
    }
  }, [activeTab, currentPath])

  const fetchStorageInfo = async () => {
    setLoadingStorage(true)
    try {
      const response = await fetch('/api/storage')
      const data = await response.json()
      if (data.success && Array.isArray(data.storage)) {
        setStorageInfo(data.storage)
      }
    } catch {
      toast.error('Erro ao buscar informações de armazenamento')
    } finally {
      setLoadingStorage(false)
    }
  }

  const fetchCleanTargets = async () => {
    try {
      const response = await fetch('/api/storage/clean', { method: 'GET' })
      const data = await response.json()
      if (data.success && Array.isArray(data.targets)) {
        setCleanTargets(data.targets)
      }
    } catch {
      // Ignore
    }
  }

  const handleClean = async (targetId: string, targetLabel: string) => {
    setCleaningTarget(targetId)
    try {
      const response = await fetch('/api/storage/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId })
      })
      const data = await response.json()

      if (data.success) {
        const freed = data.spaceFreed || '0 B'
        toast.success(`${targetLabel} limpo! Espaço liberado: ${freed}`)
        fetchStorageInfo()
      } else {
        toast.error(data.message || 'Erro ao limpar')
      }
    } catch {
      toast.error('Erro ao conectar ao servidor')
    } finally {
      setCleaningTarget(null)
    }
  }

  const handleBackup = async () => {
    setBackupLoading(true)
    try {
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const data = await response.json()

      if (data.success) {
        toast.success(`Backup criado: ${data.size}`)
        if (data.discord) toast.info(data.discord)
        setShowBackupModal(false)
        // Baixa o arquivo gerado no servidor
        window.location.href = data.downloadUrl
      } else {
        toast.error(data.message || 'Erro ao fazer backup')
      }
    } catch {
      toast.error('Erro ao conectar ao servidor')
    } finally {
      setBackupLoading(false)
    }
  }

  const handleRestore = async () => {
    if (!restoreFile) {
      toast.error('Selecione um arquivo primeiro')
      return
    }

    setRestoreLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', restoreFile)

      const response = await fetch('/api/restore', {
        method: 'POST',
        body: formData
      })
      const data = await response.json()

      if (data.success) {
        toast.success('Banco de dados restaurado com sucesso!')
        setShowRestoreModal(false)
        setRestoreFile(null)
      } else {
        toast.error(data.message || 'Erro ao restaurar')
      }
    } catch {
      toast.error('Erro ao conectar ao servidor')
    } finally {
      setRestoreLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const filename = file.name.toLowerCase()
      if (filename.endsWith('.sql') || filename.endsWith('.sql.gz') || filename.endsWith('.gz')) {
        setRestoreFile(file)
      } else {
        toast.error('Arquivo deve ser .sql, .sql.gz ou .gz')
      }
    }
  }

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch('/api/sync')
      const data = await response.json()
      if (data.success) {
        setSyncStatus({
          branch: data.branch,
          lastCommit: data.lastCommit,
          commitsAhead: data.commitsAhead,
          commitsBehind: data.commitsBehind,
        })
      }
    } catch { /* silent */ }
  }

  const handleSync = async () => {
    setSyncLoading(true)
    try {
      const response = await fetch('/api/sync', { method: 'POST' })
      const data = await response.json()

      if (data.success) {
        if (data.skipped) {
          toast.success(data.output || 'Já está atualizado')
        } else {
          toast.success(`Sincronizado! Commit: ${data.lastCommit}`)
        }
        await fetchSyncStatus()
      } else {
        toast.error(data.message || 'Erro ao sincronizar')
      }
    } catch {
      toast.error('Erro ao conectar ao servidor')
    } finally {
      setSyncLoading(false)
    }
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'text-green-400'
      case 'medium': return 'text-yellow-400'
      case 'high': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  const getLogClass = (type: string) => {
    switch (type) {
      case 'stdout': return 'terminal-success'
      case 'stderr': return 'terminal-warning'
      case 'error': return 'terminal-error'
      case 'system': return 'terminal-info'
      default: return 'text-gray-300'
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('pt-BR', { hour12: false })
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // File Manager functions
  const fetchFiles = async (pathStr: string) => {
    setLoadingFiles(true)
    try {
      const url = pathStr ? `/api/files/list?path=${encodeURIComponent(pathStr)}` : '/api/files/list'
      const response = await fetch(url)
      const data = await response.json()
      if (data.success) {
        setFiles(data.files)
        if (data.currentPath !== undefined) {
          setCurrentPath(data.currentPath)
        }
      } else {
        toast.error(data.message || 'Erro ao listar arquivos')
      }
    } catch {
      toast.error('Erro ao conectar ao servidor')
    } finally {
      setLoadingFiles(false)
    }
  }

  const handleDeleteFile = async () => {
    if (!deleteConfirm) return
    const { path: targetPath, name } = deleteConfirm

    setDeletingFile(targetPath)
    try {
      const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath })
      })
      const data = await response.json()

      if (data.success) {
        toast.success(`Excluído com sucesso!`)
        fetchFiles(currentPath)
      } else {
        toast.error(data.message || 'Erro ao excluir')
      }
    } catch {
      toast.error('Erro ao conectar ao servidor')
    } finally {
      setDeletingFile(null)
      setDeleteConfirm(null)
    }
  }

  const navigateUp = () => {
    if (!currentPath) return
    const parts = currentPath.split('/')
    parts.pop()
    const newPath = parts.join('/')

    // If we pop and only /home/fivem or /home/fivem/server-data is left, go to root view
    if (newPath === '/home/fivem' || newPath === '/home') {
      setCurrentPath('')
    } else {
      setCurrentPath(newPath)
    }
  }

  // Render storage tab content
  const renderStorageContent = () => (
    <div className="space-y-6">
      {/* Storage Overview */}
      <div className="bg-secondary/30 rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-lg font-medium text-foreground">Uso de Armazenamento</h3>
          </div>
          <button
            onClick={fetchStorageInfo}
            disabled={loadingStorage}
            className="p-2 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loadingStorage ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loadingStorage ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(storageInfo || []).map((item, index) => (
              <div key={index} className="bg-background/50 rounded-lg p-4 border border-border">
                <p className="text-sm text-muted-foreground mb-1">{item.label}</p>
                <p className="text-2xl font-bold text-foreground">{item.size}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.files?.toLocaleString('pt-BR')} arquivos
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clean Options */}
      <div className="bg-secondary/30 rounded-xl border border-border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">Recuperar Espaço</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(cleanTargets || []).map((target) => (
            <div
              key={target.id}
              className="bg-background/50 rounded-lg p-4 border border-border flex flex-col"
            >
              <div className="flex items-start justify-between mb-2">
                <h4 className="font-medium text-foreground">{target.label}</h4>
                <span className={`text-xs font-medium ${getRiskColor(target.risk)}`}>
                  {target.risk === 'low' && 'Baixo risco'}
                  {target.risk === 'medium' && 'Médio risco'}
                  {target.risk === 'high' && 'Alto risco'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-4 flex-grow">
                {target.description}
              </p>
              <button
                onClick={() => handleClean(target.id, target.label)}
                disabled={cleaningTarget !== null}
                className="w-full py-2 px-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cleaningTarget === target.id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Limpando...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Limpar</span>
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-400">
          <p className="font-medium mb-1">Informações de Armazenamento</p>
          <p className="text-blue-400/70">
            Após limpar, talvez seja necessário reiniciar o servidor para que todas as mudanças tenham efeito.
          </p>
        </div>
      </div>
    </div>
  )

  // Render Files tab content
  const renderFilesContent = () => {
    const isRoot = !currentPath

    return (
      <div className="bg-secondary/30 rounded-xl border border-border p-6 min-h-[500px] flex flex-col">
        {/* Navigation Bar */}
        <div className="flex items-center gap-2 mb-6 bg-background/50 p-3 rounded-lg border border-border">
          <button
            onClick={() => setCurrentPath('')}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Voltar para Raiz"
          >
            <Home className="w-4 h-4" />
          </button>

          <ChevronRight className="w-4 h-4 text-muted-foreground" />

          {!isRoot ? (
            <div className="flex items-center gap-2 flex-grow overflow-x-auto whitespace-nowrap scrollbar-hide">
              <button
                onClick={navigateUp}
                className="px-2 py-1 text-sm rounded bg-secondary/50 hover:bg-secondary border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                .. (Voltar)
              </button>
              <span className="text-sm font-mono text-foreground bg-primary/10 px-2 py-1 rounded inline-block">
                {currentPath}
              </span>
            </div>
          ) : (
            <span className="text-sm text-foreground">Volumes Principais</span>
          )}

          <button
            onClick={() => fetchFiles(currentPath)}
            disabled={loadingFiles}
            className="p-1.5 rounded hover:bg-secondary flex-shrink-0 disabled:opacity-50 ml-auto"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loadingFiles ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* File Browser list */}
        <div className="flex-grow border border-border rounded-lg bg-background/30 overflow-hidden">
          {loadingFiles ? (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-muted-foreground">
              <FolderIcon className="w-12 h-12 mb-3 opacity-20" />
              <p>Diretório vazio</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="p-3 text-xs font-medium text-muted-foreground w-10">T</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground">Nome</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground w-32">Tamanho</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground w-40">Modificado</th>
                    <th className="p-3 text-xs font-medium text-muted-foreground w-20 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {files.map((file, i) => (
                    <tr
                      key={i}
                      className={`group hover:bg-secondary/40 transition-colors ${file.isDirectory ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (file.isDirectory) {
                          setCurrentPath(file.path)
                        }
                      }}
                    >
                      <td className="p-3 text-center">
                        {file.isDirectory ?
                          <FolderIcon className="w-4 h-4 text-blue-400 mx-auto" /> :
                          <FileIcon className="w-4 h-4 text-gray-400 mx-auto" />
                        }
                      </td>
                      <td className="p-3">
                        <span className={`text-sm font-medium ${file.isDirectory ? 'text-blue-400 group-hover:underline' : 'text-foreground'}`}>
                          {file.name}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {!file.isDirectory && formatBytes(file.size)}
                        {file.isDirectory && '--'}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {file.modifiedAt ? new Date(file.modifiedAt).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
                        }) : '--'}
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        {!file.isDirectory && !file.isRoot && (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setViewerFile({ path: file.path, name: file.name })}
                              className="p-1.5 rounded hover:bg-blue-500/20 text-muted-foreground hover:text-blue-400 transition-colors"
                              title="Visualizar"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm({ path: file.path, name: file.name })}
                              disabled={deletingFile === file.path}
                              className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Excluir"
                            >
                              {deletingFile === file.path ?
                                <Loader2 className="w-4 h-4 animate-spin" /> :
                                <Trash2 className="w-4 h-4" />
                              }
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Render BD tab content
  const renderBdContent = () => (
    <div className="space-y-8">
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <button
        onClick={() => executeAction('backup')}
        className="group relative p-6 bg-secondary/50 rounded-xl border border-border hover:border-primary/50 transition-all text-left"
      >
        <div className="flex items-start justify-between">
          <div className="p-3 rounded-lg bg-secondary text-green-400">
            <Database className="w-6 h-6" />
          </div>
          <Play className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        </div>
        <div className="mt-4">
          <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
            Backup DB
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Gera um dump .sql.gz do banco e baixa no navegador
          </p>
        </div>
      </button>

      <button
        onClick={() => executeAction('restore')}
        className="group relative p-6 bg-secondary/50 rounded-xl border border-border hover:border-primary/50 transition-all text-left"
      >
        <div className="flex items-start justify-between">
          <div className="p-3 rounded-lg bg-secondary text-yellow-400">
            <Upload className="w-6 h-6" />
          </div>
          <Play className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        </div>
        <div className="mt-4">
          <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
            Restore DB
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Importa um arquivo .sql ou .sql.gz para o banco
          </p>
        </div>
      </button>

      <button
        onClick={handleSync}
        disabled={syncLoading}
        className="group relative p-6 bg-secondary/50 rounded-xl border border-border hover:border-primary/50 transition-all text-left disabled:opacity-60"
      >
        <div className="flex items-start justify-between">
          <div className="p-3 rounded-lg bg-secondary text-blue-400">
            <RefreshCw className={`w-6 h-6 ${syncLoading ? 'animate-spin' : ''}`} />
          </div>
          {syncStatus && !syncLoading && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${
              syncStatus.commitsBehind !== '0' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
            }`}>
              {syncStatus.commitsBehind !== '0' ? `${syncStatus.commitsBehind} behind` : 'OK'}
            </span>
          )}
        </div>
        <div className="mt-4">
          <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
            Git Sync
          </h3>
          {syncStatus ? (
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-muted-foreground truncate">{syncStatus.lastCommit}</p>
              <p className="text-xs text-muted-foreground">branch: {syncStatus.branch}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">
              Sincroniza arquivos do repositório Git
            </p>
          )}
        </div>
      </button>
    </div>
    <PlayersDbSection />
    </div>
  )

  // Render logs tab content
  const renderLogsContent = () => (
    <div className="space-y-4">
      {/* Sub-navigation for logs */}
      <div className="flex bg-background/50 rounded-lg p-1 gap-1 w-fit border border-border">
        <button
          onClick={() => setLogSource('fivem')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${logSource === 'fivem'
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          Servidor / Citizen
        </button>
        <button
          onClick={() => setLogSource('txadmin')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${logSource === 'txadmin'
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          txAdmin (Sistema)
        </button>
      </div>

      <div className="bg-secondary/30 rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/50">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Terminal ({logSource === 'fivem' ? 'Servidor' : 'txAdmin'})</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredLogs.length} linhas
          </span>
        </div>
        <div className="h-[600px] overflow-y-auto p-4 font-mono text-sm space-y-1">
          {filteredLogs.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Aguardando logs...
            </div>
          ) : (
            filteredLogs.map((log, index) => (
              <div key={index} className="flex gap-3 terminal-line">
                <span className="text-muted-foreground shrink-0">[{formatTime(log.timestamp)}]</span>
                <span className={getLogClass(log.type)}>{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Painel de Controle</h2>
          <p className="text-sm text-muted-foreground mt-1">Gerencie seu servidor FiveM</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs text-muted-foreground">
            {isStreaming ? 'Logs em tempo real' : 'Desconectado'}
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap bg-background/50 rounded-lg p-1 gap-1">
        <button
          onClick={() => setActiveTab('monitor')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'monitor'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Monitor
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'logs'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          Logs
        </button>
        <button
          onClick={() => setActiveTab('bd')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'bd'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          Banco de Dados
        </button>
        <button
          onClick={() => setActiveTab('storage')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'storage'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          Armazenamento
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'files'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          Arquivos
        </button>
        <button
          onClick={() => setActiveTab('cfg')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'cfg'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
        >
          server.cfg
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'monitor' && (
        <div className="space-y-6">
          <TxAdminCard />
          <MonitorSection />
        </div>
      )}
      {activeTab === 'logs' && renderLogsContent()}
      {activeTab === 'bd' && renderBdContent()}
      {activeTab === 'storage' && renderStorageContent()}
      {activeTab === 'files' && renderFilesContent()}
      {activeTab === 'cfg' && <ServerCfgEditor />}

      {/* Backup Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-xl border border-border p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Backup do Banco de Dados</h3>
              <button onClick={() => setShowBackupModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="text-sm text-blue-400">
                  O dump do banco é compactado (gzip), salvo em /home/fivem/backups e baixado no seu navegador. Se BACKUP_WEBHOOK_URL estiver configurada, também é enviado ao Discord.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowBackupModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleBackup}
                  disabled={backupLoading}
                  className="flex-1 px-4 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {backupLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Database className="w-4 h-4" />
                      <span>Fazer Backup</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-xl border border-border p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Restaurar Banco de Dados</h3>
              <button onClick={() => setShowRestoreModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <p className="text-sm text-red-400 font-medium mb-2">⚠️ Atenção!</p>
                <p className="text-sm text-red-400/70">
                  Esta operação irá sobrescrever todos os dados atuais do banco de dados.
                  Recomendado fazer um backup antes.
                </p>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">
                  Selecione o arquivo de backup (.sql, .sql.gz)
                </label>
                <input
                  type="file"
                  accept=".sql,.sql.gz,.gz"
                  onChange={handleFileChange}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-foreground file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                />
                {restoreFile && (
                  <p className="text-sm text-green-400 mt-2">
                    ✓ Arquivo selecionado: {restoreFile.name}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowRestoreModal(false); setRestoreFile(null) }}
                  className="flex-1 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRestore}
                  disabled={restoreLoading || !restoreFile}
                  className="flex-1 px-4 py-2 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {restoreLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Restaurando...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>Restaurar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      {viewerFile && (
        <FileViewer
          filePath={viewerFile.path}
          fileName={viewerFile.name}
          onClose={() => setViewerFile(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl border border-border p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-start gap-4 mb-5">
              <div className="p-3 rounded-lg bg-red-500/10 shrink-0">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">Confirmar exclusão</h3>
                <p className="text-sm text-muted-foreground">
                  Deseja excluir permanentemente <span className="font-mono text-foreground">{deleteConfirm.name}</span>?
                </p>
                <p className="text-xs text-red-400/70 mt-1">Esta ação não pode ser desfeita.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-colors text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteFile}
                disabled={deletingFile !== null}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-colors text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deletingFile ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Excluir
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
