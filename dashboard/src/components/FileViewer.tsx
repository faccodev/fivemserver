'use client'

import { useState, useEffect } from 'react'
import {
  X,
  FileCode,
  Image,
  Video,
  Music,
  FileText,
  AlertCircle,
  Download,
  Copy,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

interface FileInfo {
  success: boolean
  fileType?: string
  fileName?: string
  size?: number
  tooLarge?: boolean
  maxSize?: number
  message?: string
  dataUrl?: string      // image
  streamPath?: string   // video/audio
  mimeType?: string    // video/audio
  content?: string      // text/code
  language?: string     // text/code
}

interface FileViewerProps {
  filePath: string
  fileName: string
  onClose: () => void
}

export function FileViewer({ filePath, fileName, onClose }: FileViewerProps) {
  const [data, setData] = useState<FileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true)
      try {
        const url = `/api/files/read?path=${encodeURIComponent(filePath)}`
        const response = await fetch(url)
        const json = await response.json()
        setData(json)
      } catch {
        toast.error('Erro ao carregar arquivo')
        onClose()
      } finally {
        setLoading(false)
      }
    }
    fetchContent()
  }, [filePath, onClose])

  const handleCopy = async () => {
    if (data?.content) {
      await navigator.clipboard.writeText(data.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = `/api/files/stream?path=${encodeURIComponent(filePath)}`
    a.download = fileName
    a.target = '_blank'
    a.rel = 'noreferrer'
    a.click()
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const typeIcon = () => {
    if (!data) return <FileText className="w-6 h-6" />
    switch (data.fileType) {
      case 'image': return <Image className="w-6 h-6 text-green-400" />
      case 'video': return <Video className="w-6 h-6 text-purple-400" />
      case 'audio': return <Music className="w-6 h-6 text-yellow-400" />
      case 'code':  return <FileCode className="w-6 h-6 text-blue-400" />
      default:      return <FileText className="w-6 h-6 text-gray-400" />
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl border border-border w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-secondary shrink-0">
              {typeIcon()}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">
                {data?.fileName || fileName}
              </h2>
              {data?.size != null && (
                <p className="text-xs text-muted-foreground">
                  {formatBytes(data.size)}
                  {data.tooLarge && (
                    <span className="text-yellow-400 ml-2">• {data.message}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-4">
            {(data?.fileType === 'video' || data?.fileType === 'audio' || data?.fileType === 'image') && (
              <button
                onClick={handleDownload}
                className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Baixar arquivo"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-grow overflow-auto">

          {loading && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && data?.tooLarge && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
              <AlertCircle className="w-10 h-10 text-yellow-400" />
              <p className="text-center px-6">{data.message}</p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border transition-colors text-sm"
              >
                <Download className="w-4 h-4" />
                Baixar arquivo
              </button>
            </div>
          )}

          {/* Image preview */}
          {!loading && data?.fileType === 'image' && !data.tooLarge && (
            <div className="flex items-center justify-center p-4 bg-black/30 min-h-[300px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.dataUrl}
                alt={data.fileName}
                className="max-w-full max-h-[70vh] rounded-lg object-contain"
              />
            </div>
          )}

          {/* Video player */}
          {!loading && data?.fileType === 'video' && !data.tooLarge && (
            <div className="flex flex-col items-center p-4 gap-3">
              <video
                src={data.streamPath}
                controls
                className="max-w-full max-h-[70vh] rounded-lg bg-black"
              >
                Seu navegador não suporta vídeo.
              </video>
            </div>
          )}

          {/* Audio player */}
          {!loading && data?.fileType === 'audio' && !data.tooLarge && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="p-4 rounded-full bg-secondary">
                <Music className="w-10 h-10 text-yellow-400" />
              </div>
              <audio
                src={data.streamPath}
                controls
                className="w-full max-w-lg"
              >
                Seu navegador não suporta áudio.
              </audio>
            </div>
          )}

          {/* Code / Text viewer */}
          {!loading && (data?.fileType === 'code' || data?.fileType === 'text' || data?.fileType === 'json') && !data.tooLarge && (
            <div className="relative">
              {/* Toolbar */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-secondary/30 sticky top-0 z-10">
                <span className="text-xs text-muted-foreground font-mono">
                  {data.language?.toUpperCase()} • {data.content?.split('\n').length ?? 0} linhas
                </span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors text-xs"
                >
                  {copied ? (
                    <>
                      <span className="text-green-400">Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copiar
                    </>
                  )}
                </button>
              </div>

              {/* Code block */}
              <pre className="p-4 text-sm font-mono text-gray-300 overflow-x-auto leading-relaxed">
                <code>{data.content}</code>
              </pre>
            </div>
          )}

          {/* Binary / unsupported */}
          {!loading && data?.fileType === 'binary' && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
              <FileText className="w-12 h-12 opacity-30" />
              <p className="text-center px-6">{data.message || 'Visualização não disponível para este tipo de arquivo.'}</p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border transition-colors text-sm"
              >
                <Download className="w-4 h-4" />
                Baixar arquivo
              </button>
            </div>
          )}

          {/* Generic error */}
          {!loading && !data?.success && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-red-400">
              <AlertCircle className="w-10 h-10" />
              <p className="text-center px-6">{data?.message || 'Erro ao carregar arquivo.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
