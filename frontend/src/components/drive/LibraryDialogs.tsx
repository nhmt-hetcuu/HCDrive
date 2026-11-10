import { useEffect, useState } from 'react'
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Cookie,
  Copy,
  ExternalLink,
  Folder,
  GraduationCap,
  HardDriveDownload,
  Info,
  Link2,
  Loader2,
  Mail,
  UserCheck,
  UserRound,
} from 'lucide-react'
import { API_URL, apiFetch, formatDriveDate } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { useSnackbar } from '@/context/SnackbarContext'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Dialogs of the Courses page (pages/LibraryPage.tsx): the internal share link, and copying a course
// into the user's own Drive.

/**
 * Downloads the course (or one chapter) as a ZIP. The server hands out a signed URL, so the browser saves
 * the file as it streams instead of holding gigabytes of video in memory first.
 */
export async function startCourseDownload(
  linkId: string,
  chapter?: { folderId?: string; rk?: string; name?: string },
  customDownload?: (url: string, filename: string, options?: { auth?: boolean }) => Promise<void>
) {
  const data = await apiFetch<{ path: string }>(`/library/${linkId}/download-link`, { method: 'POST', body: JSON.stringify(chapter ?? {}) })
  if (customDownload) {
    await customDownload(data.path, chapter?.name ? `${chapter.name}.zip` : 'course.zip', { auth: false })
    return
  }
  const anchor = document.createElement('a')
  anchor.href = `${API_URL}${data.path}`
  anchor.rel = 'noopener'
  // Keeps the page in place; the server's Content-Disposition names the file.
  anchor.download = ''
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Downloads a shared course without requiring account ownership of the saved link. */
export async function startSharedCourseDownload(
  token: string,
  chapter?: { folderId?: string; rk?: string; name?: string },
  customDownload?: (url: string, filename: string, options?: { auth?: boolean }) => Promise<void>
) {
  const data = await apiFetch<{ path: string }>(`/library/shared/${encodeURIComponent(token)}/download-link`, { method: 'POST', body: JSON.stringify(chapter ?? {}) })
  if (customDownload) {
    await customDownload(data.path, chapter?.name ? `${chapter.name}.zip` : 'course.zip', { auth: false })
    return
  }
  const anchor = document.createElement('a')
  anchor.href = `${API_URL}${data.path}`
  anchor.rel = 'noopener'
  anchor.download = ''
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** One lesson as a file: the signed stream URL, asked to download instead of play. */
export function lessonDownloadUrl(streamUrl: string, name: string) {
  const base = streamUrl.startsWith('http://') || streamUrl.startsWith('https://')
    ? streamUrl
    : `${API_URL}${streamUrl.startsWith('/') ? '' : '/'}${streamUrl}`
  return `${base}${base.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`
}

type CourseRef = { id: string; title: string; teacher: string; shared: boolean; isFolder: boolean }

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function ShareCourseModal({ link, vi, onClose, onChanged }: { link: CourseRef | null; vi: boolean; onClose: () => void; onChanged: (id: string, shared: boolean) => void }) {
  const { showSnackbar } = useSnackbar()
  const [path, setPath] = useState<string | null>(null)
  const [allowDownload, setAllowDownload] = useState(true)
  const [busy, setBusy] = useState(false)
  const url = path ? `${window.location.origin}${path}` : ''

  useEffect(() => {
    setPath(null)
    setAllowDownload(true)
    if (!link?.shared) return
    apiFetch<{ path: string | null; allowDownload?: boolean }>(`/library/${link.id}/share`)
      .then((data) => {
        setPath(data.path)
        setAllowDownload(data.allowDownload !== false)
      })
      .catch(() => undefined)
  }, [link?.id, link?.shared])

  async function create(downloadSetting = allowDownload) {
    if (!link) return
    setBusy(true)
    try {
      const data = await apiFetch<{ path: string; allowDownload?: boolean }>(`/library/${link.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ allowDownload: downloadSetting }),
      })
      setPath(data.path)
      setAllowDownload(data.allowDownload !== false)
      onChanged(link.id, true)
      await copyText(`${window.location.origin}${data.path}`).then(() => showSnackbar(vi ? 'Đã tạo và sao chép link' : 'Link created and copied')).catch(() => undefined)
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không tạo được link' : 'Could not create the link'))
    } finally {
      setBusy(false)
    }
  }

  async function toggleDownload(newVal: boolean) {
    setAllowDownload(newVal)
    if (!path || !link) return
    try {
      await apiFetch(`/library/${link.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ allowDownload: newVal }),
      })
      showSnackbar(newVal ? (vi ? 'Đã bật cho phép tải xuống' : 'Download allowed') : (vi ? 'Đã chặn tải bài học (chỉ xem online)' : 'Download blocked (watch online only)'))
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không cập nhật được tuỳ chọn tải' : 'Could not update download setting'))
    }
  }

  async function revoke() {
    if (!link) return
    setBusy(true)
    try {
      await apiFetch(`/library/${link.id}/share`, { method: 'DELETE' })
      setPath(null)
      onChanged(link.id, false)
      showSnackbar(vi ? 'Đã tắt link chia sẻ' : 'Share link turned off')
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không tắt được link' : 'Could not turn the link off'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DummyModal open={Boolean(link)} onClose={onClose} title={vi ? `Chia sẻ "${link?.title ?? ''}"` : `Share "${link?.title ?? ''}"`} description={vi ? 'Link chia sẻ nội bộ HCDrive cho mọi người xem, tải và lưu khóa học.' : 'Share course link for watching, downloading and saving.'}>
      <div className="space-y-4 text-sm">
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {vi
            ? 'Người nhận mở link chia sẻ có thể xem trực tuyến toàn bộ bài học, video và tài liệu mà không cần đăng nhập hoặc đăng nhập tùy ý. Người xem cũng có thể tải từng bài học hoặc tải ZIP toàn khóa (nếu bạn cho phép), và lưu khóa học vào tài khoản HCDrive của họ.'
            : 'Viewers opening this link can watch all lessons, videos and documents online with or without logging in. Viewers can also download individual lessons or full ZIP (if permitted) and save to their HCDrive library.'}
        </p>

        {/* Allow download toggle switch */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-[#1e1f20]">
          <label className="flex items-start justify-between gap-3 cursor-pointer select-none">
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                {vi ? 'Cho phép người xem tải bài học & tải ZIP' : 'Allow viewers to download lessons & ZIP'}
              </span>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {allowDownload
                  ? (vi ? 'Người xem có thể tải từng bài học hoặc tải ZIP toàn bộ khóa.' : 'Viewers can download individual lessons or full course ZIP.')
                  : (vi ? 'Chặn tải: Người xem chỉ có thể xem trực tuyến trong trình phát, các nút tải sẽ bị tắt.' : 'Blocked: Viewers can only stream online in the player; download buttons are disabled.')}
              </p>
            </div>
            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(e) => toggleDownload(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0b57d0] focus:ring-[#0b57d0] dark:border-slate-700 cursor-pointer"
            />
          </label>
        </div>

        {path ? (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {vi ? 'Liên kết chia sẻ' : 'Shareable link'}
            </label>
            <div className="flex gap-2">
              <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-[#131314] dark:text-slate-200" />
              <Button size="sm" variant="tonal" onClick={() => copyText(url).then(() => showSnackbar(vi ? 'Đã sao chép link' : 'Link copied')).catch(() => showSnackbar(vi ? 'Không sao chép được' : 'Could not copy'))}>
                <Copy className="mr-1.5 h-4 w-4" />{vi ? 'Sao chép' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          {path ? <Button size="sm" variant="danger" onClick={revoke} disabled={busy}>{vi ? 'Tắt link' : 'Turn off link'}</Button> : null}
          {!path ? (
            <Button size="sm" onClick={() => create(allowDownload)} disabled={busy || !link}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
              {vi ? 'Tạo link chia sẻ' : 'Create share link'}
            </Button>
          ) : (
            <Button size="sm" variant="text" onClick={onClose}>{vi ? 'Đóng' : 'Close'}</Button>
          )}
        </div>
      </div>
    </DummyModal>
  )
}

type CopyJob = {
  status: 'running' | 'done' | 'failed'
  accountEmail: string
  folderName: string
  folderUrl: string | null
  copied: number
  folders: number
  skipped: number
  failed: number
  current: string | null
  error: string | null
}

export function SaveToDriveModal({
  link,
  accounts,
  vi,
  onClose,
}: {
  link: (CourseRef & { account?: { id: string; email: string } | null; isCourse?: boolean }) | null
  accounts?: Array<{ id: string; email: string }>
  vi: boolean
  onClose: () => void
}) {
  const { showSnackbar } = useSnackbar()
  const [job, setJob] = useState<CopyJob | null>(null)
  const [starting, setStarting] = useState(false)
  const [availableAccounts, setAvailableAccounts] = useState<Array<{ id: string; email: string }>>(accounts ?? [])
  const [targetAccountId, setTargetAccountId] = useState('')
  const linkId = link?.id

  // Fetch accounts if not provided
  useEffect(() => {
    if (accounts && accounts.length > 0) {
      setAvailableAccounts(accounts)
      return
    }
    apiFetch<{ accounts: Array<{ id: string; email: string; provider?: string }> }>('/connected-accounts')
      .then((data) => {
        const gAccounts = (data.accounts || []).filter((a) => !a.provider || a.provider === 'google_drive')
        setAvailableAccounts(gAccounts)
      })
      .catch(() => undefined)
  }, [accounts])

  // Set initial target account
  useEffect(() => {
    if (link?.account?.id) {
      setTargetAccountId(link.account.id)
    } else if (availableAccounts.length > 0 && !targetAccountId) {
      setTargetAccountId(availableAccounts[0].id)
    }
  }, [link, availableAccounts, targetAccountId])

  // Shows a copy that is already running (or finished) for this course.
  useEffect(() => {
    setJob(null)
    if (!linkId) return
    apiFetch<{ job: CopyJob | null }>(`/library/${linkId}/save-to-drive`).then((data) => setJob(data.job)).catch(() => undefined)
  }, [linkId])

  useEffect(() => {
    if (!linkId || job?.status !== 'running') return
    const timer = window.setInterval(() => {
      apiFetch<{ job: CopyJob | null }>(`/library/${linkId}/save-to-drive`)
        .then((data) => {
          setJob(data.job)
          if (data.job?.status === 'done') window.dispatchEvent(new Event('hcdrive:storage-changed'))
        })
        .catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [linkId, job?.status])

  async function start() {
    if (!linkId) return
    setStarting(true)
    try {
      const data = await apiFetch<{ job: CopyJob }>(`/library/${linkId}/save-to-drive`, {
        method: 'POST',
        body: JSON.stringify({ targetAccountId: targetAccountId || undefined }),
      })
      setJob(data.job)
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không bắt đầu được' : 'Could not start'))
    } finally {
      setStarting(false)
    }
  }

  const name = link ? (link.teacher ? `${link.title} - ${link.teacher}` : link.title) : ''
  const isCourseItem = link?.isCourse !== false

  return (
    <DummyModal
      open={Boolean(link)}
      onClose={onClose}
      title={
        vi
          ? `Lưu ${isCourseItem ? 'khóa học' : 'thư mục'} vào Drive`
          : `Save ${isCourseItem ? 'course' : 'folder'} to Drive`
      }
      description={
        vi
          ? 'Chép toàn bộ tệp vào Google Drive đích của bạn (tự động bypass nếu tệp bị hạn chế tải hoặc chặn sao chép).'
          : 'Real copies of every file into your destination Google Drive (automatically bypasses copy-restricted files).'
      }
    >
      <div className="space-y-3.5 text-sm">
        {!job ? (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {vi ? 'Tài khoản Google Drive đích' : 'Destination Google Drive account'}
              </label>
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                disabled={starting}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#282a2c] px-3 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {availableAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.email} {link?.account?.id === acc.id ? (vi ? '(Đang mở liên kết này)' : '(Current opener)') : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {vi
                  ? 'Bạn có thể chọn bất kỳ tài khoản Google nào đã kết nối để lưu, không nhất thiết phải là mail dính quyền xem.'
                  : 'You can choose any connected Google account to save, not necessarily the email with view rights.'}
              </p>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              {vi
                ? `HCDrive tạo ${link?.isFolder ? 'thư mục' : 'tệp'} "${name}" ở thư mục gốc Drive của tài khoản Google được chọn, giữ nguyên cấu trúc các mục bên trong. Bản sao chiếm dung lượng của tài khoản đích.`
                : `HCDrive creates ${link?.isFolder ? 'the folder' : 'the file'} "${name}" in the root Drive of the chosen Google account, keeping its structure. The copies use that account's storage.`}
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="text" onClick={onClose} disabled={starting}>
                {vi ? 'Huỷ' : 'Cancel'}
              </Button>
              <Button size="sm" onClick={start} disabled={starting || !targetAccountId}>
                {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <HardDriveDownload className="mr-1.5 h-4 w-4" />}
                {vi ? 'Bắt đầu lưu' : 'Start saving'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 dark:bg-[#1e1f20] dark:text-slate-200">
              <p className="flex items-center gap-2 font-medium">
                {job.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-[#0b57d0]" /> : job.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                {job.status === 'running' ? (vi ? 'Đang chép…' : 'Copying…') : job.status === 'done' ? (vi ? 'Đã lưu xong' : 'Saved') : vi ? 'Dừng vì lỗi' : 'Stopped by an error'}
              </p>
              <p className="mt-1">
                {vi
                  ? `${job.copied} tệp, ${job.folders} thư mục → ${job.accountEmail}`
                  : `${job.copied} files, ${job.folders} folders → ${job.accountEmail}`}
              </p>
              {job.skipped ? (
                <div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="font-semibold">{vi ? `${job.skipped} tệp không thể sao chép (đã bỏ qua).` : `${job.skipped} files could not be copied (skipped).`}</p>
                  <p className="mt-1 opacity-90">
                    {vi
                      ? 'Lý do: Chủ sở hữu link đã khóa quyền "Người xem không thể tải xuống, in hoặc sao chép" trên Google Drive. Vì vậy Google cấm tạo bản sao sang tài khoản khác. Bạn có thể mở xem trực tiếp video bằng tài khoản Google được cấp quyền.'
                      : 'Reason: Owner disabled "Download, print, and copy for commenters and viewers". Google rejects copying. You can stream or watch directly with the authorized Google account.'}
                  </p>
                </div>
              ) : null}
              {job.failed ? <p className="mt-1 text-red-600 dark:text-red-400">{vi ? `${job.failed} tệp chép lỗi; bấm lưu lại để thử lần nữa.` : `${job.failed} files failed; save again to retry.`}</p> : null}
              {job.current ? <p className="mt-1 truncate text-slate-500">{job.current}</p> : null}
              {job.error ? <p className="mt-1 break-all text-red-600 dark:text-red-400">{job.error}</p> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {job.folderUrl ? (
                <a href={job.folderUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-[#0b57d0] hover:bg-[#0b57d0]/10 dark:text-[#a8c7fa]">
                  <ExternalLink className="mr-1.5 h-4 w-4" />{vi ? 'Mở trên Google Drive' : 'Open in Google Drive'}
                </a>
              ) : null}
              {job.status !== 'running' ? <Button size="sm" variant="outline" onClick={start} disabled={starting}>{vi ? 'Lưu lại lần nữa' : 'Save again'}</Button> : null}
              <Button size="sm" variant="text" onClick={onClose}>{job.status === 'running' ? (vi ? 'Chạy nền' : 'Run in background') : vi ? 'Đóng' : 'Close'}</Button>
            </div>
          </>
        )}
      </div>
    </DummyModal>
  )
}

export type CourseDetailRef = {
  id: string
  driveFileId: string
  title: string
  url: string
  mimeType: string
  isFolder: boolean
  ownerName: string | null
  ownerEmail: string | null
  collection: string
  teacher: string
  note: string
  isCourse?: boolean
  shared: boolean
  lastOpenedAt: string | null
  createdAt: string
  account: { id: string; email: string } | null
  completedCount: number
}

export function CourseDetailsModal({
  link,
  accounts,
  vi,
  onClose,
  onAccountChanged,
}: {
  link: CourseDetailRef | null
  accounts: Array<{ id: string; email: string }>
  vi: boolean
  onClose: () => void
  onAccountChanged: (updated: CourseDetailRef) => void
}) {
  const { showSnackbar } = useSnackbar()
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [changing, setChanging] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  useEffect(() => {
    if (link) {
      setSelectedAccountId(link.account?.id ?? '')
    }
  }, [link])

  if (!link) return null

  async function handleSwitchAccount(newAccountId: string) {
    if (!link) return
    setSelectedAccountId(newAccountId)
    setChanging(true)
    try {
      const data = await apiFetch<{ link: CourseDetailRef }>(`/library/${link.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ accountId: newAccountId || null }),
      })
      onAccountChanged(data.link)
      showSnackbar(vi ? 'Đã đổi tài khoản Google Drive cho khóa học' : 'Changed Google Drive account for course')
    } catch (err) {
      showSnackbar(errorText(err, vi ? 'Không đổi được tài khoản' : 'Could not change account'))
      setSelectedAccountId(link.account?.id ?? '')
    } finally {
      setChanging(false)
    }
  }

  function handleCopyId() {
    if (!link) return
    copyText(link.driveFileId)
      .then(() => {
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 2000)
        showSnackbar(vi ? 'Đã sao chép ID tệp Drive' : 'Copied Drive file ID')
      })
      .catch(() => undefined)
  }

  const ownerText = link.ownerName && link.ownerEmail
    ? `${link.ownerName} (${link.ownerEmail})`
    : link.ownerEmail || link.ownerName || (vi ? 'Không có thông tin' : 'Unknown')

    const isCourse = link.isCourse !== false

    return (
    <DummyModal
      open={Boolean(link)}
      onClose={onClose}
      title={vi ? (isCourse ? 'Chi tiết khóa học' : 'Chi tiết liên kết chia sẻ') : (isCourse ? 'Course details' : 'Shared link details')}
      description={vi ? (isCourse ? 'Thông tin quyền truy cập, tài khoản gắn và thông số khóa học.' : 'Thông tin quyền truy cập, tài khoản gắn và thông số tệp / thư mục.') : (isCourse ? 'Access permissions, connected account, and course metadata.' : 'Access permissions, connected account, and file / folder metadata.')}
    >
      <div className="space-y-4 text-xs">
        {/* Title Header */}
        <div className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-[#1e1f20]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#c2e7ff]/60 dark:bg-[#004a77]">
            {isCourse ? (
              <GraduationCap className="h-5 w-5 text-[#0b57d0] dark:text-[#a8c7fa]" />
            ) : (
              <Folder className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">{link.title}</h3>
            {link.teacher ? (
              <p className="mt-0.5 flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <UserRound className="h-3 w-3 text-slate-400" />
                {link.teacher}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {link.collection ? (
                <span className="inline-block rounded bg-[#c2e7ff]/60 px-2 py-0.5 text-[10px] font-medium text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff]">
                  {link.collection}
                </span>
              ) : null}
              <span className={cn(
                'inline-block rounded px-2 py-0.5 text-[10px] font-medium',
                isCourse
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
              )}>
                {vi ? (isCourse ? 'Khóa học' : 'Thư mục Drive') : (isCourse ? 'Course' : 'Drive folder')}
              </span>
            </div>
          </div>
        </div>

        {/* Account selection / attachment */}
        <div className="rounded-xl border border-blue-200/80 bg-blue-50/50 p-3.5 dark:border-blue-900/50 dark:bg-blue-950/20">
          <label className="block text-xs font-semibold text-blue-900 dark:text-blue-200">
            <span className="flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-[#0b57d0] dark:text-[#a8c7fa]" />
              {vi
                ? (isCourse ? 'Tài khoản Drive đang gắn (dùng để mở khóa học)' : 'Tài khoản Drive đang gắn (dùng để mở thư mục)')
                : (isCourse ? 'Attached Drive account (used to open course)' : 'Attached Drive account (used to open folder)')}
            </span>
            <div className="relative mt-2">
              <select
                disabled={changing || accounts.length === 0}
                value={selectedAccountId}
                onChange={(e) => handleSwitchAccount(e.target.value)}
                className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 dark:border-blue-800 dark:bg-[#131314] dark:text-slate-100 disabled:opacity-50"
              >
                <option value="">{vi ? 'Tự động (thử lần lượt các tài khoản)' : 'Auto (try all connected accounts)'}</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.email} {link.account?.id === acc.id ? (vi ? ' (đang dùng)' : ' (active)') : ''}
                  </option>
                ))}
              </select>
              {changing ? (
                <div className="absolute right-3 top-2.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0b57d0]" />
                </div>
              ) : null}
            </div>
          </label>
          <p className="mt-1.5 text-[11px] text-blue-700 dark:text-blue-300">
            {vi
              ? 'Nếu một số bài học chỉ xem được bằng email nhất định, hãy chọn đúng tài khoản Google đó.'
              : 'If some lessons can only be viewed by a specific email, pick that Google account.'}
          </p>
        </div>

        {/* Sharer & metadata grid */}
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {/* Sharer Email */}
          <div className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <UserCheck className="h-3.5 w-3.5" />
              {vi ? 'Người chia sẻ (Drive)' : 'Shared by (Drive owner)'}
            </span>
            <span className="font-medium text-slate-800 dark:text-slate-200 text-right truncate max-w-[200px]" title={ownerText}>
              {ownerText}
            </span>
          </div>

          {/* Drive File ID */}
          <div className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Info className="h-3.5 w-3.5" />
              {vi ? 'ID trên Google Drive' : 'Google Drive ID'}
            </span>
            <div className="flex items-center gap-1.5">
              <code className="font-mono text-[11px] text-slate-700 dark:text-slate-300 max-w-[140px] truncate" title={link.driveFileId}>
                {link.driveFileId}
              </code>
              <button
                type="button"
                onClick={handleCopyId}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 cursor-pointer"
                title={vi ? 'Sao chép ID' : 'Copy ID'}
              >
                {copiedId ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Original Drive Link */}
          <div className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Link2 className="h-3.5 w-3.5" />
              {vi ? 'Link gốc Google Drive' : 'Original Drive link'}
            </span>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]"
            >
              <span className="max-w-[160px] truncate">{vi ? 'Mở trên Google Drive' : 'Open in Drive'}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Completed Lessons */}
          {isCourse ? (
            <div className="flex items-center justify-between p-3">
              <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {vi ? 'Tiến độ học' : 'Progress'}
              </span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {vi ? `Đã hoàn thành ${link.completedCount} bài` : `${link.completedCount} lessons completed`}
              </span>
            </div>
          ) : null}

          {/* Last opened */}
          <div className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              {vi ? 'Lần mở gần nhất' : 'Last opened'}
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              {link.lastOpenedAt ? formatDriveDate(link.lastOpenedAt, vi ? 'vi' : 'en') : (vi ? 'Chưa mở' : 'Never')}
            </span>
          </div>

          {/* Created at */}
          <div className="flex items-center justify-between p-3">
            <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Calendar className="h-3.5 w-3.5" />
              {vi ? 'Ngày lưu vào thư viện' : 'Added to library'}
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              {formatDriveDate(link.createdAt, vi ? 'vi' : 'en')}
            </span>
          </div>
        </div>

        {/* Note if any */}
        {link.note ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#1a1b1d]">
            <p className="font-semibold text-slate-700 dark:text-slate-300">{vi ? 'Ghi chú' : 'Note'}:</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-400">{link.note}</p>
          </div>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            {vi ? 'Đóng' : 'Close'}
          </Button>
        </div>
      </div>
    </DummyModal>
  )
}

export function DriveCookieModal({
  linkId,
  accountId,
  accountEmail,
  hasCookie,
  vi,
  onClose,
  onSaved,
}: {
  linkId?: string
  accountId?: string
  accountEmail?: string
  hasCookie?: boolean
  vi: boolean
  onClose: () => void
  onSaved?: (hasCookie: boolean) => void
}) {
  const { showSnackbar } = useSnackbar()
  const [cookie, setCookie] = useState('')
  const [saving, setSaving] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault()
    setSaving(true)
    try {
      let resHasCookie = false
      if (linkId) {
        const res = await apiFetch<{ success: boolean; hasCookie: boolean }>(`/library/${linkId}/cookie`, {
          method: 'POST',
          body: JSON.stringify({ cookie: cookie.trim() }),
        })
        resHasCookie = res.hasCookie
      } else if (accountId) {
        const res = await apiFetch<{ status: string; hasCookie: boolean }>(`/connected-accounts/${accountId}/cookie`, {
          method: 'PATCH',
          body: JSON.stringify({ cookie: cookie.trim() }),
        })
        resHasCookie = res.hasCookie
      }

      showSnackbar(
        resHasCookie
          ? (vi ? 'Đã lưu Cookie Google Drive (đã mã hóa an toàn)' : 'Google Drive Cookie saved (securely encrypted)')
          : (vi ? 'Đã xóa Cookie' : 'Cookie removed')
      )
      onSaved?.(resHasCookie)
      onClose()
    } catch (err) {
      showSnackbar(errorText(err, vi ? 'Không lưu được cookie' : 'Failed to save cookie'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DummyModal
      open={true}
      title={
        <span className="flex items-center gap-2">
          <Cookie className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <span>{vi ? 'Cấu hình Cookie Google Drive' : 'Configure Google Drive Cookie'}</span>
        </span>
      }
      description={
        vi
          ? 'Sử dụng cookie tài khoản Google Drive để máy chủ HCDrive tải và stream trực tiếp các video bị khóa quyền tải hoặc bảo vệ quyền xem riêng tư.'
          : 'Use Google Drive session cookie to stream view-only protected files directly through HCDrive server buffer.'
      }
      onClose={onClose}
    >
      <form onSubmit={handleSave} className="space-y-4">
        {accountEmail && (
          <div className="flex items-center gap-2 rounded-lg bg-blue-50/70 p-2.5 text-xs text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            <Mail className="h-4 w-4 shrink-0 text-[#0b57d0] dark:text-[#a8c7fa]" />
            <span className="truncate">
              {vi ? 'Tài khoản Google liên kết:' : 'Linked Google account:'} <strong>{accountEmail}</strong>
            </span>
          </div>
        )}

        {hasCookie && (
          <div className="flex items-center justify-between rounded-lg bg-emerald-50/80 p-2.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span className="flex items-center gap-1.5 font-medium">
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              {vi ? 'Tài khoản này hiện đã có Cookie bảo mật trên server' : 'This account currently has a secure Cookie stored on server'}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setCookie('')
                handleSave()
              }}
              className="font-semibold text-red-600 hover:underline dark:text-red-400 cursor-pointer"
            >
              {vi ? 'Xóa Cookie' : 'Clear Cookie'}
            </button>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
            {vi ? 'Dán Cookie Google Drive' : 'Paste Google Drive Cookie'}
          </label>
          <textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            rows={4}
            placeholder="SID=...; HSID=...; SSID=...; OSID=... hoặc copy toàn bộ chuỗi header Cookie trong DevTools Network"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-[11px] text-slate-900 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 dark:border-slate-800 dark:bg-[#131314] dark:text-slate-100 placeholder:text-slate-400"
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {vi
              ? 'Cookie được mã hóa AES-256-GCM trước khi lưu và chỉ dùng để yêu cầu stream từ Google Drive.'
              : 'Cookie is AES-256-GCM encrypted before storage and used exclusively to request streams from Google Drive.'}
          </p>
        </div>

        {/* Instructions Toggle */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-[#1e1f20]/50">
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="flex w-full items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            <span className="flex items-center gap-1.5 text-[#0b57d0] dark:text-[#a8c7fa]">
              <Info className="h-3.5 w-3.5" />
              {vi ? 'Cách lấy Cookie từ trình duyệt của bạn (1 phút)' : 'How to get Cookie from browser (1 min)'}
            </span>
            <span className="text-[11px] text-slate-400">{showGuide ? (vi ? 'Thu gọn' : 'Hide') : (vi ? 'Xem hướng dẫn' : 'Show guide')}</span>
          </button>
          {showGuide && (
            <div className="mt-2.5 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-200/60 pt-2 dark:border-slate-800">
              <p>1. Mở <strong>drive.google.com</strong> trên trình duyệt bạn đã đăng nhập và xem được video/khóa học.</p>
              <p>2. Nhấn phím <strong>F12</strong> (hoặc Chuột phải chọn <em>Kiểm tra / Inspect</em>) rồi chuyển sang tab <strong>Network</strong> (Mạng).</p>
              <p>3. Tải lại trang (F5) hoặc bấm vào một tệp/thư mục bất kỳ.</p>
              <p>4. Chọn một yêu cầu bất kỳ gửi đến <code>drive.google.com</code>, trong bảng bên phải tìm mục <strong>Request Headers</strong>.</p>
              <p>5. Copy toàn bộ giá trị sau <code>cookie:</code> (hoặc copy cả dòng) và dán vào ô trên.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {vi ? 'Đóng' : 'Close'}
          </Button>
          <Button type="submit" size="sm" disabled={saving || (!cookie.trim() && !hasCookie)} className="gap-1.5 bg-[#0b57d0] hover:bg-[#0b57d0]/90 text-white">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            <span>{vi ? 'Lưu Cookie' : 'Save Cookie'}</span>
          </Button>
        </div>
      </form>
    </DummyModal>
  )
}


