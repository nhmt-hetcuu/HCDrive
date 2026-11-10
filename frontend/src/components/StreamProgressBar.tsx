import { useEffect, useState, useRef } from 'react'
import { API_URL, formatBytes } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { CheckCircle2, Loader2, Zap } from 'lucide-react'

export type CacheProgressData = {
  fileId: string
  fileName: string
  status: 'idle' | 'downloading' | 'completed' | 'error'
  downloadedBytes: number
  totalBytes: number
  percent: number
  speedBytesPerSec: number
  startedAt: number
  lastUpdatedAt: number
  error?: string
}

export function StreamProgressBar({
  streamUrl,
  fileId,
  isBuffering = false,
  vi = true,
  className = '',
}: {
  streamUrl?: string | null
  fileId?: string
  isBuffering?: boolean
  vi?: boolean
  className?: string
}) {
  const [data, setData] = useState<CacheProgressData | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Determine progress URL from streamUrl or fileId
  let progressUrl: string | null = null
  let requiresAuth = false
  if (streamUrl && streamUrl.includes('/library/stream/')) {
    const token = streamUrl.split('/library/stream/')[1]?.split('?')[0]
    if (token) {
      progressUrl = `/library/stream-progress/${token}`
    }
  } else if (streamUrl && streamUrl.includes('/files/preview/')) {
    const token = streamUrl.split('/files/preview/')[1]?.split('?')[0]
    if (token) {
      progressUrl = `/files/preview-progress/${token}`
    }
  } else if (streamUrl && streamUrl.includes('/public/files/')) {
    const token = streamUrl.split('/public/files/')[1]?.split('/')[0]?.split('?')[0]
    if (token) {
      progressUrl = `/public/files/${token}/cache-progress`
    }
  } else if (fileId) {
    progressUrl = `/files/${fileId}/cache-progress`
    requiresAuth = true
  }

  useEffect(() => {
    setDismissed(false)
    setData(null)
    if (!progressUrl) return

    let isMounted = true
    const fetchProgress = async () => {
      try {
        const headers: Record<string, string> = {}
        if (requiresAuth) {
          const token = getAccessToken()
          if (token) headers['Authorization'] = `Bearer ${token}`
        }
        const res = await fetch(`${API_URL}${progressUrl}`, { headers })
        if (!res.ok) return
        const json = (await res.json()) as CacheProgressData
        if (!isMounted) return
        setData(json)

        // Poll interval: 800ms when downloading, 1500ms when idle/buffering, stop if completed
        if (json.status === 'downloading') {
          timerRef.current = setTimeout(fetchProgress, 800)
        } else if (json.status === 'idle') {
          timerRef.current = setTimeout(fetchProgress, 1500)
        }
      } catch {
        // quiet network poll error
      }
    }

    fetchProgress()

    return () => {
      isMounted = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [progressUrl])

  if (!data || dismissed) return null

  // If idle and not buffering, don't clutter the UI
  if (data.status === 'idle' && !isBuffering) return null

  const isDownloading = data.status === 'downloading'
  const isCompleted = data.status === 'completed'

  return (
    <div
      className={`rounded-xl border border-slate-200/90 bg-white/95 p-3 shadow-xs backdrop-blur-xs transition-all dark:border-slate-800 dark:bg-[#1e1f20]/95 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 min-w-0">
          {isDownloading ? (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#0b57d0] dark:bg-[#a8c7fa]"></span>
            </span>
          ) : isCompleted ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0" />
          )}

          <span className="truncate">
            {isDownloading
              ? vi
                ? 'Đang đệm vào Server Cache (Tốc độ cao)'
                : 'Buffering to Server Cache (High Speed)'
              : isCompleted
                ? vi
                  ? 'Đã lưu Cache trên Server (Tua nhanh tức thì 30p)'
                  : 'Cached on Server (Instant 30-min seeking)'
                : vi
                  ? 'Đang kết nối luồng dữ liệu...'
                  : 'Connecting stream...'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
          {isDownloading && data.speedBytesPerSec > 0 && (
            <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
              <Zap className="h-3 w-3" />
              {formatBytes(data.speedBytesPerSec)}/s
            </span>
          )}
          {isDownloading && data.totalBytes > 0 && (
            <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
              {formatBytes(data.downloadedBytes)} / {formatBytes(data.totalBytes)} ({data.percent}%)
            </span>
          )}
          {isCompleted && (
            <span className="text-slate-400">
              {formatBytes(data.totalBytes || data.downloadedBytes)}
            </span>
          )}
          {isCompleted && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-1 cursor-pointer"
              title={vi ? 'Ẩn' : 'Dismiss'}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {isDownloading && (
        <div className="mt-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300 ease-out"
              style={{ width: `${Math.max(5, data.percent)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>
              {vi
                ? 'Bạn có thể xem ngay lúc này; máy chủ tiếp tục tải nền để tua mượt mà.'
                : 'You can watch now; server continues caching in background for smooth seeking.'}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
