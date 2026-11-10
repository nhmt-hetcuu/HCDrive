import { createContext, useContext, useState, useRef, type ReactNode } from 'react'
import { API_URL, formatBytes } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { Download, CheckCircle2, AlertCircle, X, ChevronDown, ChevronUp, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DownloadItem = {
  id: string
  fileName: string
  loadedBytes: number
  totalBytes: number
  percent: number
  speedBytesPerSec: number
  status: 'downloading' | 'completed' | 'error'
  error?: string
  startedAt: number
}

export type StartDownloadOptions = {
  auth?: boolean
  method?: 'GET' | 'POST'
  body?: BodyInit | null
  headers?: Record<string, string>
}

type DownloadContextType = {
  downloads: DownloadItem[]
  startDownload: (url: string, fileName: string, options?: StartDownloadOptions) => Promise<void>
  dismissDownload: (id: string) => void
  clearCompleted: () => void
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [minimized, setMinimized] = useState(false)
  const abortControllers = useRef<Map<string, AbortController>>(new Map())

  const startDownload = async (url: string, fileName: string, options: StartDownloadOptions = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const controller = new AbortController()
    abortControllers.current.set(id, controller)

    const initialItem: DownloadItem = {
      id,
      fileName,
      loadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      speedBytesPerSec: 0,
      status: 'downloading',
      startedAt: Date.now(),
    }

    setDownloads((prev) => [initialItem, ...prev])

    try {
      const headers: Record<string, string> = { ...(options.headers || {}) }
      if (options.auth !== false) {
        const token = getAccessToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
      }
      if (options.body && !headers['Content-Type'] && typeof options.body === 'string') {
        headers['Content-Type'] = 'application/json'
      }

      const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`

      const response = await fetch(fullUrl, {
        method: options.method || (options.body ? 'POST' : 'GET'),
        body: options.body,
        headers,
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Download failed'}`)
      }

      const contentLength = response.headers.get('content-length')
      const total = contentLength ? parseInt(contentLength, 10) : 0

      // Check for content-disposition suggested filename
      const dispHeader = response.headers.get('content-disposition')
      let saveAsName = fileName
      if (dispHeader) {
        const utf8Match = dispHeader.match(/filename\*=UTF-8''([^;]+)/i)
        const plainMatch = dispHeader.match(/filename="?([^";]+)"?/i)
        if (utf8Match?.[1]) {
          try { saveAsName = decodeURIComponent(utf8Match[1]) } catch {}
        } else if (plainMatch?.[1]) {
          saveAsName = plainMatch[1]
        }
      }

      // If no streaming body or direct download, fallback to blob
      if (!response.body) {
        const blob = await response.blob()
        triggerSaveBlob(blob, saveAsName)
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, fileName: saveAsName, status: 'completed', percent: 100, loadedBytes: total || blob.size, totalBytes: total || blob.size }
              : item
          )
        )
        return
      }

      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      let lastReport = Date.now()
      let bytesSinceLast = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          loaded += value.length
          bytesSinceLast += value.length

          const now = Date.now()
          if (now - lastReport >= 400) {
            const durationSec = (now - lastReport) / 1000
            const speed = Math.round(bytesSinceLast / durationSec)
            const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0

            setDownloads((prev) =>
              prev.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      fileName: saveAsName,
                      loadedBytes: loaded,
                      totalBytes: total || loaded,
                      percent,
                      speedBytesPerSec: speed,
                    }
                  : item
              )
            )

            lastReport = now
            bytesSinceLast = 0
          }
        }
      }

      // Finalize download
      const mime = response.headers.get('content-type') || 'application/octet-stream'
      const finalBlob = new Blob(chunks as BlobPart[], { type: mime })
      triggerSaveBlob(finalBlob, saveAsName)

      setDownloads((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                fileName: saveAsName,
                status: 'completed',
                loadedBytes: loaded,
                totalBytes: total || loaded,
                percent: 100,
                speedBytesPerSec: 0,
              }
            : item
        )
      )

      // Auto dismiss after 8s
      setTimeout(() => {
        setDownloads((prev) => prev.filter((item) => item.id !== id))
      }, 8000)
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setDownloads((prev) => prev.filter((item) => item.id !== id))
        return
      }
      setDownloads((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: 'error', error: err?.message || 'Download failed' }
            : item
        )
      )
    } finally {
      abortControllers.current.delete(id)
    }
  }

  const dismissDownload = (id: string) => {
    const controller = abortControllers.current.get(id)
    if (controller) {
      controller.abort()
      abortControllers.current.delete(id)
    }
    setDownloads((prev) => prev.filter((item) => item.id !== id))
  }

  const clearCompleted = () => {
    setDownloads((prev) => prev.filter((item) => item.status === 'downloading'))
  }

  const activeCount = downloads.filter((d) => d.status === 'downloading').length

  return (
    <DownloadContext.Provider value={{ downloads, startDownload, dismissDownload, clearCompleted }}>
      {children}

      {/* Floating Download Progress Drawer (Bottom Right) */}
      {downloads.length > 0 && (
        <div className="fixed inset-x-3 bottom-3 z-[75] max-h-[70dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-slate-800 dark:bg-[#1e1f20]/95 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[min(420px,calc(100vw-2.5rem))]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2.5 font-semibold text-sm text-slate-900 dark:text-slate-100 min-w-0">
              <Download className={cn('h-4 w-4 shrink-0', activeCount > 0 ? 'text-[#0b57d0] dark:text-[#a8c7fa] animate-bounce' : 'text-emerald-500')} />
              <span className="truncate">
                {activeCount > 0
                  ? `Đang tải xuống (${activeCount} tệp)...`
                  : 'Tải xuống hoàn tất'}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMinimized((m) => !m)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                title={minimized ? 'Mở rộng' : 'Thu nhỏ'}
              >
                {minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setDownloads([])}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                title="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* List of items */}
          {!minimized && (
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 p-2 space-y-2">
              {downloads.map((item) => {
                const isDownloading = item.status === 'downloading'
                const isDone = item.status === 'completed'
                const isErr = item.status === 'error'

                return (
                  <div key={item.id} className="p-2 space-y-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-[#282a2c]/50 transition">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-slate-800 dark:text-slate-200 min-w-0" title={item.fileName}>
                        {item.fileName}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {isDone && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        {isErr && <AlertCircle className="h-4 w-4 text-red-500" />}
                        <button
                          type="button"
                          onClick={() => dismissDownload(item.id)}
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {isDownloading && (
                      <div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300"
                            style={{ width: `${Math.max(5, item.percent)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>
                            {formatBytes(item.loadedBytes)} {item.totalBytes > 0 ? `/ ${formatBytes(item.totalBytes)}` : ''} ({item.percent}%)
                          </span>
                          {item.speedBytesPerSec > 0 && (
                            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                              <Zap className="h-3 w-3" />
                              {formatBytes(item.speedBytesPerSec)}/s
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {isDone && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        ✓ Đã tải xong ({formatBytes(item.loadedBytes)})
                      </p>
                    )}

                    {isErr && (
                      <p className="text-[11px] text-red-500 truncate" title={item.error}>
                        Lỗi: {item.error || 'Tải thất bại'}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </DownloadContext.Provider>
  )
}

export function useDownload() {
  const context = useContext(DownloadContext)
  if (!context) {
    throw new Error('useDownload must be used within a DownloadProvider')
  }
  return context
}

function triggerSaveBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 15000)
}
