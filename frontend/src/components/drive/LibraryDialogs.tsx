import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, HardDriveDownload, Link2, Loader2 } from 'lucide-react'
import { API_URL, apiFetch } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { useSnackbar } from '@/context/SnackbarContext'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'

// Dialogs of the Courses page (pages/LibraryPage.tsx): the internal share link, and copying a course
// into the user's own Drive.

/**
 * Downloads the course (or one chapter) as a ZIP. The server hands out a signed URL, so the browser saves
 * the file as it streams instead of holding gigabytes of video in memory first.
 */
export async function startCourseDownload(linkId: string, chapter?: { folderId?: string; rk?: string; name?: string }) {
  const data = await apiFetch<{ path: string }>(`/library/${linkId}/download-link`, { method: 'POST', body: JSON.stringify(chapter ?? {}) })
  const anchor = document.createElement('a')
  anchor.href = `${API_URL}${data.path}`
  anchor.rel = 'noopener'
  // Keeps the page in place; the server's Content-Disposition names the file.
  anchor.download = ''
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** One lesson as a file: the signed stream URL, asked to download instead of play. */
export function lessonDownloadUrl(streamUrl: string, name: string) {
  return `${API_URL}${streamUrl}${streamUrl.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`
}

type CourseRef = { id: string; title: string; teacher: string; shared: boolean; isFolder: boolean }

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function ShareCourseModal({ link, vi, onClose, onChanged }: { link: CourseRef | null; vi: boolean; onClose: () => void; onChanged: (id: string, shared: boolean) => void }) {
  const { showSnackbar } = useSnackbar()
  const [path, setPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const url = path ? `${window.location.origin}${path}` : ''

  useEffect(() => {
    setPath(null)
    if (!link?.shared) return
    apiFetch<{ path: string | null }>(`/library/${link.id}/share`).then((data) => setPath(data.path)).catch(() => undefined)
  }, [link?.id, link?.shared])

  async function create() {
    if (!link) return
    setBusy(true)
    try {
      const data = await apiFetch<{ path: string }>(`/library/${link.id}/share`, { method: 'POST' })
      setPath(data.path)
      onChanged(link.id, true)
      await copyText(`${window.location.origin}${data.path}`).then(() => showSnackbar(vi ? 'Đã tạo và sao chép link' : 'Link created and copied')).catch(() => undefined)
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không tạo được link' : 'Could not create the link'))
    } finally {
      setBusy(false)
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
    <DummyModal open={Boolean(link)} onClose={onClose} title={vi ? `Chia sẻ "${link?.title ?? ''}"` : `Share "${link?.title ?? ''}"`} description={vi ? 'Link HCDrive cho người dùng trong hệ thống HCDrive này.' : 'An HCDrive link for users of this HCDrive.'}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {vi
            ? 'Người nhận đăng nhập HCDrive, mở link và thêm khóa học (tên, giảng viên, nhóm) vào mục Khóa học của họ. Họ xem bằng tài khoản Google của chính họ, nên người bán / giảng viên vẫn phải chia sẻ khóa cho email của họ. Ghi chú riêng của bạn không được gửi kèm.'
            : 'Recipients sign in to HCDrive, open the link and add the course (name, teacher, group) to their own Courses. They watch with their own Google account, so the course owner still has to share it with their email. Your private note is not included.'}
        </p>
        {path ? (
          <div className="flex gap-2">
            <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-[#131314] dark:text-slate-200" />
            <Button size="sm" variant="tonal" onClick={() => copyText(url).then(() => showSnackbar(vi ? 'Đã sao chép link' : 'Link copied')).catch(() => showSnackbar(vi ? 'Không sao chép được' : 'Could not copy'))}>
              <Copy className="mr-1.5 h-4 w-4" />{vi ? 'Sao chép' : 'Copy'}
            </Button>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          {path ? <Button size="sm" variant="danger" onClick={revoke} disabled={busy}>{vi ? 'Tắt link' : 'Turn off link'}</Button> : null}
          {!path ? (
            <Button size="sm" onClick={create} disabled={busy || !link}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
              {vi ? 'Tạo link chia sẻ' : 'Create share link'}
            </Button>
          ) : (
            <Button size="sm" variant="text" onClick={onClose}>{vi ? 'Xong' : 'Done'}</Button>
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

export function SaveToDriveModal({ link, vi, onClose }: { link: CourseRef | null; vi: boolean; onClose: () => void }) {
  const { showSnackbar } = useSnackbar()
  const [job, setJob] = useState<CopyJob | null>(null)
  const [starting, setStarting] = useState(false)
  const linkId = link?.id

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
      const data = await apiFetch<{ job: CopyJob }>(`/library/${linkId}/save-to-drive`, { method: 'POST' })
      setJob(data.job)
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không bắt đầu được' : 'Could not start'))
    } finally {
      setStarting(false)
    }
  }

  const name = link ? (link.teacher ? `${link.title} - ${link.teacher}` : link.title) : ''

  return (
    <DummyModal open={Boolean(link)} onClose={onClose} title={vi ? 'Lưu khóa học vào Drive' : 'Save the course to Drive'} description={vi ? 'Chép thật toàn bộ tệp vào Drive của bạn (không phải lối tắt), để vẫn còn khi người chia sẻ xoá hoặc thu hồi.' : 'Real copies of every file in your Drive (not shortcuts), kept even if the owner deletes or unshares them.'}>
      <div className="space-y-3 text-sm">
        {!job ? (
          <>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {vi
                ? `HCDrive tạo ${link?.isFolder ? 'thư mục' : 'tệp'} "${name}" ở thư mục gốc Drive của tài khoản Google đang mở khóa này, giữ nguyên các chương bên trong. Bản sao chiếm dung lượng của tài khoản đó. Tệp người bán chặn sao chép sẽ được bỏ qua.`
                : `HCDrive creates ${link?.isFolder ? 'the folder' : 'the file'} "${name}" in the Drive root of the Google account that opens this course, keeping its chapters. The copies use that account's storage. Files the owner blocked from copying are skipped.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="text" onClick={onClose}>{vi ? 'Huỷ' : 'Cancel'}</Button>
              <Button size="sm" onClick={start} disabled={starting}>
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
              {job.skipped ? <p className="mt-1 text-amber-700 dark:text-amber-300">{vi ? `${job.skipped} tệp bị người bán chặn sao chép, đã bỏ qua.` : `${job.skipped} files the owner blocked from copying were skipped.`}</p> : null}
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
