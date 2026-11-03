import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, ExternalLink, FileArchive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { API_URL, apiFetch, formatBytes, formatDriveDate } from '@/lib/api'
import { createPlyr, ensurePlyr } from '@/lib/plyr'
import { getPreviewKind, officeViewerUrl } from '@/lib/preview'
import { useLanguage } from '@/context/LanguageContext'
import { cn } from '@/lib/utils'

type PublicFile = { name: string; mimeType: string; sizeBytes: string; createdAt: string }

export function PublicFilePage({ embed = false }: { embed?: boolean }) {
  const { token } = useParams()
  const { lang } = useLanguage()
  const vi = lang === 'vi'

  const [file, setFile] = useState<PublicFile | null>(null)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewUrl = `${API_URL}/public/files/${token}/preview`
  const downloadUrl = `${API_URL}/public/files/${token}/download`
  const kind = getPreviewKind(file?.mimeType)

  useEffect(() => {
    setFailed(false)
    apiFetch<{ file: PublicFile }>(`/public/files/${token}`, { skipAuth: true })
      .then((data) => setFile(data.file))
      .catch(() => {
        setFile(null)
        setFailed(true)
      })
  }, [token])

  useEffect(() => {
    document.title = file ? `${file.name} - HCDrive` : 'HCDrive'
    return () => {
      document.title = 'HCDrive'
    }
  }, [file])

  useEffect(() => {
    if (kind !== 'video' || !videoRef.current) return undefined
    let disposed = false
    let player: { destroy: () => void } | null = null

    ensurePlyr()
      .then(() => {
        if (disposed || !videoRef.current) return
        player = createPlyr(videoRef.current)
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      player?.destroy()
    }
  }, [kind, previewUrl])

  if (failed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#131314] p-6 text-white select-none">
        <div className="mb-6">
          <BrandLogo size="md" />
        </div>
        <div className="max-w-md rounded-[28px] border border-white/10 bg-[#1e1f20] p-8 text-center shadow-2xl">
          <FileArchive className="mx-auto h-14 w-14 text-slate-400 stroke-[1.25]" />
          <h1 className="mt-4 text-xl font-normal text-white">
            {vi ? 'Đường liên kết này không còn hoạt động' : 'This link is no longer active'}
          </h1>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            {vi
              ? 'Tệp có thể đã bị xoá, đã hết hạn chia sẻ hoặc người sở hữu đã thu hồi quyền truy cập công khai.'
              : 'The file may have been deleted, expired, or access was revoked by the owner.'}
          </p>
        </div>
      </main>
    )
  }

  if (!file) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#131314] text-xs font-normal text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-blue-500 animate-spin" />
          <span>{vi ? 'Đang tải tệp chia sẻ...' : 'Loading shared file...'}</span>
        </div>
      </main>
    )
  }

  const visual = getFileVisual(file.mimeType)
  const Icon = visual.icon

  const preview = (
    <div className="flex h-full w-full items-center justify-center p-4">
      {kind === 'image' ? (
        <img
          src={previewUrl}
          alt={file.name}
          className="max-h-[82vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
        />
      ) : kind === 'video' ? (
        <div className="w-full max-w-4xl max-h-[80vh] rounded-xl overflow-hidden shadow-2xl bg-black">
          <video ref={videoRef} controls playsInline preload="metadata" className="w-full h-full">
            <source src={previewUrl} type={file.mimeType} />
          </video>
        </div>
      ) : kind === 'document' ? (
        <iframe src={previewUrl} title={file.name} className="h-full w-full rounded-xl border border-white/10 bg-white" />
      ) : kind === 'office' ? (
        <iframe
          src={officeViewerUrl(previewUrl)}
          title={file.name}
          className="h-full w-full rounded-xl border border-white/10 bg-white"
        />
      ) : (
        <div className="flex flex-col items-center justify-center px-6 text-center text-slate-300 max-w-md">
          <div className="p-4 rounded-3xl bg-white/5 border border-white/10 mb-4">
            <Icon className={cn('h-12 w-12', visual.color)} />
          </div>
          <h2 className="text-base font-normal text-white mb-1">
            {vi ? 'Không có bản xem trước' : 'Preview not available'}
          </h2>
          <p className="text-xs text-slate-400 mb-6">
            {vi
              ? 'Tệp này không hỗ trợ hiển thị trực tiếp. Vui lòng tải xuống để mở trên thiết bị.'
              : 'This file cannot be previewed. Download it to view on your device.'}
          </p>
          <a href={downloadUrl} download>
            <Button variant="filled" className="rounded-full gap-2 px-6">
              <Download className="h-4 w-4" />
              <span>{vi ? 'Tải xuống' : 'Download'}</span>
            </Button>
          </a>
        </div>
      )}
    </div>
  )

  if (embed) {
    return <main className="h-screen overflow-hidden bg-black text-white">{preview}</main>
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#131314] text-white flex flex-col select-none">
      {/* Top Google Drive style bar */}
      <header className="flex h-16 items-center justify-between border-b border-white/10 bg-[#1e1f20]/90 px-4 sm:px-6 shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo size="sm" />
          <div className="h-5 w-px bg-white/10 mx-1 hidden sm:block" />
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={cn('h-5 w-5 shrink-0', visual.color)} />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-medium text-white max-w-[200px] sm:max-w-md" title={file.name}>
                {file.name}
              </h1>
              <p className="truncate text-[11px] text-slate-400">
                {formatBytes(file.sizeBytes)} • {formatDriveDate(file.createdAt, lang)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a href={`/public/files/${token}/embed`} target="_blank" rel="noreferrer" className="hidden sm:block">
            <Button variant="text" size="sm" className="text-white/80 hover:text-white hover:bg-white/10 text-xs">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              <span>Embed</span>
            </Button>
          </a>
          <a href={downloadUrl} download>
            <Button variant="filled" size="sm" className="rounded-full gap-1.5 text-xs px-4">
              <Download className="h-4 w-4" />
              <span>{vi ? 'Tải xuống' : 'Download'}</span>
            </Button>
          </a>
        </div>
      </header>

      {/* Main Preview */}
      <section className="flex-1 flex items-center justify-center p-3 sm:p-6 overflow-hidden">
        <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black/60 shadow-2xl flex items-center justify-center">
          {preview}
        </div>
      </section>
    </main>
  )
}
