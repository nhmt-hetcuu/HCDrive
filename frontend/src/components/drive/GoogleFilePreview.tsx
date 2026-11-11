import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  MoreVertical,
  Share2,
  FileText
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { API_URL, apiFetch, formatBytes } from '@/lib/api'
import { createPlyr, ensurePlyr } from '@/lib/plyr'
import { getPreviewKind, officeViewerUrl } from '@/lib/preview'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { useDownload } from '@/context/DownloadContext'
import { StreamProgressBar } from '@/components/StreamProgressBar'
import type { FileItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

export type GoogleFilePreviewProps = {
  file: FileItem | null
  files?: FileItem[]
  open: boolean
  onClose: () => void
  onShare?: (file: FileItem) => void
  onDownload?: (file: FileItem) => void
  onNavigateFile?: (file: FileItem) => void
}

export function GoogleFilePreview({
  file,
  files = [],
  open,
  onClose,
  onShare,
  onDownload,
  onNavigateFile,
}: GoogleFilePreviewProps) {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const { startDownload } = useDownload()
  const vi = lang === 'vi'

  const [previewUrl, setPreviewUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewMode, setPreviewMode] = useState<'drive' | 'stream'>('stream')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const plyrInstanceRef = useRef<{ destroy: () => void } | null>(null)

  // Current file index in list
  const currentIndex = files.findIndex((f) => f.id === file?.id || (file?.providerFileId && f.providerFileId === file.providerFileId))
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < files.length - 1

  function goToPrev() {
    if (hasPrev && onNavigateFile) {
      onNavigateFile(files[currentIndex - 1])
    }
  }

  function goToNext() {
    if (hasNext && onNavigateFile) {
      onNavigateFile(files[currentIndex + 1])
    }
  }

  // URL sync: when open, update URL with ?preview=<id>
  useEffect(() => {
    if (!open || !file) return
    const url = new URL(window.location.href)
    const currentParam = url.searchParams.get('preview')
    const fileId = file.id || file.providerFileId
    if (fileId && currentParam !== fileId) {
      url.searchParams.set('preview', fileId)
      window.history.replaceState({}, '', url.toString())
    }

    return () => {
      const cleanupUrl = new URL(window.location.href)
      if (cleanupUrl.searchParams.has('preview')) {
        cleanupUrl.searchParams.delete('preview')
        window.history.replaceState({}, '', cleanupUrl.toString())
      }
    }
  }, [open, file?.id, file?.providerFileId])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft') {
        goToPrev()
      } else if (e.key === 'ArrowRight') {
        goToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, hasPrev, hasNext, currentIndex])

  // Plyr setup for videos
  const previewKind = getPreviewKind(file?.mimeType)

  // Fetch preview stream token if needed
  useEffect(() => {
    if (!open || !file) {
      setPreviewUrl('')
      setPreviewError('')
      return
    }

    let isMounted = true
    const targetId = file.id || file.providerFileId
    if (!targetId) return

    setLoading(true)
    setPreviewError('')
    const isMedia = previewKind === 'video' || (file?.mimeType?.startsWith('audio/') ?? false)
    // Default video and audio files to HCDrive Direct player for 100% server background caching
    setPreviewMode(isMedia ? 'stream' : 'drive')

    apiFetch<{ path?: string; url: string }>(`/files/${targetId}/preview-token`, { method: 'POST' })
      .then((data) => {
        if (!isMounted) return
        const previewPath = data.path ?? new URL(data.url).pathname
        setPreviewUrl(`${API_URL}${previewPath}`)
      })
      .catch((err) => {
        if (!isMounted) return
        if (!file.providerFileId) {
          setPreviewError(err instanceof Error ? err.message : 'Failed to load preview')
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    // Proactively trigger 100% background download task on server for media
    if (isMedia) {
      apiFetch<{ status?: string; queuePosition?: number; message?: string }>(`/files/${targetId}/start-cache`, { method: 'POST' })
        .then((res) => {
          if (!isMounted) return
          if (res?.status === 'queued') {
            showSnackbar(
              vi
                ? `Hàng đợi máy chủ: File đang ở vị trí #${res.queuePosition || 1} và sẽ tự động tải khi có lượt trống.`
                : `Server Queue: File is in position #${res.queuePosition || 1} and will auto-download once a slot frees up.`
            )
          }
        })
        .catch(() => undefined)
    }

    return () => {
      isMounted = false
    }
  }, [open, file?.id, file?.providerFileId, previewKind])

  useEffect(() => {
    if (previewKind === 'video' && videoRef.current && previewUrl) {
      ensurePlyr()
        .then(() => {
          if (videoRef.current) {
            plyrInstanceRef.current = createPlyr(videoRef.current)
          }
        })
        .catch(() => undefined)
    }

    return () => {
      if (plyrInstanceRef.current) {
        plyrInstanceRef.current.destroy()
        plyrInstanceRef.current = null
      }
    }
  }, [previewKind, previewUrl])

  if (!open || !file) return null

  const visual = getFileVisual(file.mimeType)
  const Icon = visual.icon

  async function handleDownload() {
    if (onDownload && file) {
      onDownload(file)
      return
    }
    if (!file) return
    try {
      if (file.id) {
        showSnackbar(vi ? `Đang bắt đầu tải ${file.name}...` : `Starting download of ${file.name}...`)
        await startDownload(`/files/${file.id}/download`, file.name, { auth: true })
        return
      }
      if (file.providerFileId) {
        window.open(`https://drive.google.com/uc?id=${file.providerFileId}&export=download`, '_blank')
      }
    } catch {
      showSnackbar(vi ? 'Tải xuống thất bại' : 'Download failed')
    }
  }

  async function handleCopyLink() {
    if (!file?.id) return
    try {
      const data = await apiFetch<{ url: string }>(`/files/${file.id}/share`, { method: 'POST' })
      await navigator.clipboard.writeText(data.url)
      showSnackbar(vi ? 'Đã sao chép đường liên kết' : 'Link copied to clipboard')
    } catch {
      showSnackbar(vi ? 'Lỗi sao chép liên kết' : 'Failed to copy link')
    }
    setMoreMenuOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-md select-none animate-in fade-in duration-200">
      {/* Top App Bar */}
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 bg-black/30 border-b border-white/10 shrink-0">
        {/* Left: Close/Back + File Name */}
        <div className="flex items-center gap-3 min-w-0 pr-4">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title={vi ? 'Đóng (Esc)' : 'Close (Esc)'}
            aria-label="Close preview"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon className={cn('h-5 w-5 shrink-0', visual.color)} />
            <span className="font-normal text-sm sm:text-base text-white truncate" title={file.name}>
              {file.name}
            </span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Open with mode */}
          {file.providerFileId ? (
            <div className="flex items-center rounded-full bg-white/10 p-0.5 text-xs text-white">
              <button
                type="button"
                onClick={() => setPreviewMode('drive')}
                className={cn(
                  'px-3 py-1.5 rounded-full transition cursor-pointer',
                  previewMode === 'drive' ? 'bg-white/20 font-medium' : 'text-white/70 hover:text-white'
                )}
              >
                Google Drive
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('stream')}
                className={cn(
                  'px-3 py-1.5 rounded-full transition cursor-pointer',
                  previewMode === 'stream' ? 'bg-white/20 font-medium' : 'text-white/70 hover:text-white'
                )}
              >
                HCDrive Direct
              </button>
            </div>
          ) : null}

          {/* Share */}
          {onShare ? (
            <button
              type="button"
              onClick={() => onShare(file)}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title={vi ? 'Chia sẻ' : 'Share'}
            >
              <Share2 className="h-4.5 w-4.5" />
            </button>
          ) : null}

          {/* Download */}
          <button
            type="button"
            onClick={handleDownload}
            className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title={vi ? 'Tải xuống' : 'Download'}
          >
            <Download className="h-4.5 w-4.5" />
          </button>

          {/* Open in Drive tab */}
          {file.providerFileId && (
            <button
              type="button"
              onClick={() =>
                window.open(
                  file.webViewLink || `https://drive.google.com/file/d/${file.providerFileId}/view`,
                  '_blank'
                )
              }
              className="hidden sm:flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title={vi ? 'Mở trong thẻ mới' : 'Open in new tab'}
            >
              <ExternalLink className="h-4.5 w-4.5" />
            </button>
          )}

          {/* More options menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreMenuOpen(!moreMenuOpen)}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title={vi ? 'Tuỳ chọn khác' : 'More options'}
            >
              <MoreVertical className="h-4.5 w-4.5" />
            </button>

            {moreMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl bg-[#1e1f20] border border-white/10 py-1.5 shadow-2xl text-xs text-white z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2 cursor-pointer"
                >
                  <Share2 className="h-3.5 w-3.5 text-slate-400" />
                  <span>{vi ? 'Sao chép đường liên kết' : 'Copy link'}</span>
                </button>
                <div className="my-1 border-t border-white/10" />
                <div className="px-4 py-2 text-[11px] text-white/50">
                  <p>{formatBytes(file.sizeBytes)}</p>
                  <p className="truncate mt-0.5">{file.mimeType}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Preview Center Area */}
      <div className="flex-1 relative flex items-center justify-center p-4 sm:p-8 overflow-hidden">
        {/* Previous File Button */}
        {hasPrev && (
          <button
            type="button"
            onClick={goToPrev}
            className="absolute left-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-black/40 hover:bg-black/70 text-white border border-white/10 shadow-lg transition cursor-pointer"
            title={vi ? 'Tệp trước (←)' : 'Previous file (←)'}
            aria-label="Previous file"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Content Viewer */}
        <div className="w-full h-full flex items-center justify-center max-w-7xl max-h-[82vh]">
          {file.providerFileId && previewMode === 'drive' ? (
            <iframe
              src={`https://drive.google.com/file/d/${file.providerFileId}/preview`}
              title={file.name}
              className="h-full w-full rounded-xl border border-white/10 bg-white"
              allow="autoplay; fullscreen"
            />
          ) : loading ? (
            <div className="flex flex-col items-center gap-3 text-white/70">
              <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
              <span className="text-xs">{vi ? 'Đang tải bản xem trước...' : 'Loading preview...'}</span>
            </div>
          ) : previewError ? (
            <div className="p-8 text-center text-sm text-red-400 max-w-md">
              <p className="mb-3">{previewError}</p>
              <Button variant="outline" size="sm" onClick={handleDownload} className="text-white border-white/30">
                {vi ? 'Tải tệp về máy' : 'Download file'}
              </Button>
            </div>
          ) : previewKind === 'image' && previewUrl ? (
            <img
              src={previewUrl}
              alt={file.name}
              className="max-h-[82vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
              onError={() => setPreviewError(vi ? 'Không thể tải ảnh xem trước.' : 'Failed to load preview.')}
            />
          ) : previewKind === 'video' && previewUrl ? (
            <div className="w-full max-w-4xl max-h-[82vh] rounded-xl overflow-hidden shadow-2xl bg-black flex flex-col">
              <div className="p-2 sm:p-2.5 bg-black/60 border-b border-white/10 shrink-0">
                <StreamProgressBar streamUrl={previewUrl} fileId={file.id} vi={vi} />
              </div>
              <div className="flex-1 relative flex items-center justify-center min-h-0">
                <video ref={videoRef} controls playsInline preload="metadata" className="w-full h-full max-h-[72vh]">
                  <source src={previewUrl} type={file.mimeType} />
                </video>
              </div>
            </div>
          ) : previewKind === 'document' && previewUrl ? (
            <iframe
              src={previewUrl}
              title={file.name}
              className="h-full w-full rounded-xl border border-white/10 bg-white"
            />
          ) : previewKind === 'office' && previewUrl ? (
            <iframe
              src={officeViewerUrl(previewUrl)}
              title={file.name}
              className="h-full w-full rounded-xl border border-white/10 bg-white"
            />
          ) : (
            <div className="text-center text-white/80 p-8 rounded-2xl bg-white/5 border border-white/10 max-w-md">
              <FileText className="w-16 h-16 mx-auto mb-3 text-white/40" />
              <h3 className="text-base font-medium text-white mb-1">
                {vi ? 'Không có bản xem trước' : 'No preview available'}
              </h3>
              <p className="text-xs text-white/60 mb-5">
                {vi
                  ? 'Định dạng tệp này không hỗ trợ xem trực tiếp trong trình duyệt.'
                  : 'This file format cannot be displayed directly.'}
              </p>
              <Button
                variant="filled"
                size="sm"
                onClick={handleDownload}
                className="gap-2 bg-white text-slate-900 hover:bg-white/90 rounded-full"
              >
                <Download className="h-4 w-4" />
                <span>{vi ? 'Tải xuống tệp' : 'Download file'}</span>
              </Button>
            </div>
          )}
        </div>

        {/* Next File Button */}
        {hasNext && (
          <button
            type="button"
            onClick={goToNext}
            className="absolute right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-black/40 hover:bg-black/70 text-white border border-white/10 shadow-lg transition cursor-pointer"
            title={vi ? 'Tệp tiếp theo (→)' : 'Next file (→)'}
            aria-label="Next file"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  )
}
