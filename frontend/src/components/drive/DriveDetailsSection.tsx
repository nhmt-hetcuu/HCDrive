import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { apiFetch, formatDate } from '@/lib/api'
import { fileKey, isGoogleFile } from '@/lib/drive-actions'
import type { FileItem } from '@/data/drive-data'

// What Google Drive itself knows about a file, under the HCDrive details in the side panel.

type DriveUser = { displayName?: string; emailAddress?: string; photoLink?: string }
type DriveDetails = {
  description?: string
  createdTime?: string
  modifiedTime?: string
  viewedByMeTime?: string
  md5Checksum?: string
  copyRequiresWriterPermission?: boolean
  lastModifyingUser?: DriveUser
  owners?: DriveUser[]
  imageMediaMetadata?: { width?: number; height?: number; cameraMake?: string; cameraModel?: string; time?: string }
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string }
  contentRestrictions?: Array<{ readOnly?: boolean; reason?: string; restrictingUser?: DriveUser }>
  capabilities?: { canEdit?: boolean }
}

function duration(ms?: string) {
  const total = Math.round(Number(ms ?? 0) / 1000)
  if (!total) return null
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="py-1.5 text-xs">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 break-words font-semibold text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  )
}

export function DriveDetailsSection({ file, vi }: { file: FileItem; vi: boolean }) {
  const [details, setDetails] = useState<DriveDetails | null>(null)
  const [canModify, setCanModify] = useState(false)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const google = isGoogleFile(file)

  useEffect(() => {
    if (!google) return
    let cancelled = false
    setDetails(null)
    setError('')
    apiFetch<{ details: DriveDetails; canModify: boolean }>(`/files/${fileKey(file)}/drive-details`)
      .then((data) => {
        if (cancelled) return
        setDetails(data.details)
        setCanModify(data.canModify && data.details.capabilities?.canEdit !== false)
        setDescription(data.details.description ?? '')
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [file.id, file.providerFileId, google])

  if (!google) return null
  if (error) return <p className="pt-3 text-xs text-slate-400">{vi ? 'Không đọc được thông tin từ Google Drive.' : 'Could not read the Google Drive details.'}</p>
  if (!details) return <p className="pt-3 text-xs text-slate-400">{vi ? 'Đang đọc thông tin từ Google Drive...' : 'Reading Google Drive details...'}</p>

  async function saveDescription() {
    if (description === (details?.description ?? '')) return
    setSaving(true)
    try {
      await apiFetch(`/files/${fileKey(file)}/drive-details`, { method: 'PATCH', body: JSON.stringify({ description }) })
      setDetails((prev) => (prev ? { ...prev, description } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const lock = details.contentRestrictions?.find((item) => item.readOnly)
  const image = details.imageMediaMetadata
  const video = details.videoMediaMetadata
  const dimensions = image?.width ? `${image.width} × ${image.height}` : video?.width ? `${video.width} × ${video.height}` : null

  return (
    <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Google Drive</p>
      {lock ? (
        <p className="mb-2 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 p-2 text-xs text-amber-800 dark:text-amber-300">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {vi ? `Đã khoá${lock.restrictingUser?.displayName ? ` bởi ${lock.restrictingUser.displayName}` : ''}${lock.reason ? `: ${lock.reason}` : ''}` : `Locked${lock.restrictingUser?.displayName ? ` by ${lock.restrictingUser.displayName}` : ''}${lock.reason ? `: ${lock.reason}` : ''}`}
        </p>
      ) : null}
      <label className="block py-1.5 text-xs">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{vi ? 'Mô tả' : 'Description'}</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={saveDescription}
          disabled={!canModify || saving}
          rows={2}
          placeholder={canModify ? (vi ? 'Thêm mô tả' : 'Add a description') : '-'}
          className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] p-2 text-xs text-slate-800 dark:text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-70"
        />
      </label>
      <Row label={vi ? 'Chủ sở hữu' : 'Owner'} value={details.owners?.map((owner) => owner.displayName || owner.emailAddress).join(', ')} />
      <Row label={vi ? 'Người sửa gần nhất' : 'Last modified by'} value={details.lastModifyingUser ? `${details.lastModifyingUser.displayName ?? ''}${details.modifiedTime ? ` · ${formatDate(details.modifiedTime)}` : ''}` : null} />
      <Row label={vi ? 'Ngày tạo' : 'Created'} value={details.createdTime ? formatDate(details.createdTime) : null} />
      <Row label={vi ? 'Bạn mở lần cuối' : 'Opened by me'} value={details.viewedByMeTime ? formatDate(details.viewedByMeTime) : null} />
      <Row label={vi ? 'Kích thước' : 'Dimensions'} value={dimensions} />
      <Row label={vi ? 'Thời lượng' : 'Duration'} value={duration(video?.durationMillis)} />
      <Row label={vi ? 'Máy ảnh' : 'Camera'} value={image?.cameraMake ? `${image.cameraMake} ${image.cameraModel ?? ''}`.trim() : null} />
      <Row label={vi ? 'Chụp lúc' : 'Taken'} value={image?.time ?? null} />
      <Row label={vi ? 'Người xem không được tải / in / sao chép' : 'Viewers cannot download / print / copy'} value={details.copyRequiresWriterPermission ? (vi ? 'Có' : 'Yes') : null} />
      <Row label="MD5" value={details.md5Checksum ?? null} />
    </div>
  )
}
