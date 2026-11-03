import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2, Download, Lock, MessageSquare, RotateCcw, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { downloadWithAuth, fileKey, notifyFilesChanged, onDriveAction, type DriveAction } from '@/lib/drive-actions'
import type { FileItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

// Dialogs for the Google Drive features started from any file menu (see lib/drive-actions.ts).

const formatLabels: Record<string, string> = {
  'application/pdf': 'PDF (.pdf)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Microsoft Word (.docx)',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Microsoft Excel (.xlsx)',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Microsoft PowerPoint (.pptx)',
  'application/vnd.oasis.opendocument.text': 'OpenDocument (.odt)',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument (.ods)',
  'application/x-vnd.oasis.opendocument.spreadsheet': 'OpenDocument (.ods)',
  'application/vnd.oasis.opendocument.presentation': 'OpenDocument (.odp)',
  'application/rtf': 'Rich Text (.rtf)',
  'text/plain': 'Văn bản thuần (.txt)',
  'text/csv': 'CSV (.csv, trang tính đầu)',
  'text/tab-separated-values': 'TSV (.tsv, trang tính đầu)',
  'text/markdown': 'Markdown (.md)',
  'application/zip': 'Trang web (.html, nén zip)',
  'application/epub+zip': 'EPUB (.epub)',
  'image/png': 'Ảnh PNG (.png)',
  'image/jpeg': 'Ảnh JPEG (.jpg)',
  'image/svg+xml': 'Ảnh SVG (.svg)',
  'text/html': 'HTML (.html)',
}

type Revision = {
  id: string
  modifiedTime?: string
  keepForever?: boolean
  size?: string
  originalFilename?: string
  lastModifyingUser?: { displayName?: string; emailAddress?: string; photoLink?: string; me?: boolean }
  exportFormats?: Array<{ mimeType: string; extension: string }>
}
type CommentAuthor = { displayName?: string; photoLink?: string; me?: boolean }
type Reply = { id: string; content?: string; createdTime?: string; action?: string; deleted?: boolean; author?: CommentAuthor }
type Comment = { id: string; content?: string; createdTime?: string; resolved?: boolean; deleted?: boolean; quotedFileContent?: { value?: string }; author?: CommentAuthor; replies?: Reply[] }
type FolderOption = { id: string; name: string; parentId?: string | null }

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function Avatar({ author }: { author?: CommentAuthor }) {
  return author?.photoLink
    ? <img src={author.photoLink} alt="" referrerPolicy="no-referrer" className="h-7 w-7 shrink-0 rounded-full" />
    : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-xs font-bold text-blue-700 dark:text-blue-300">{(author?.displayName ?? '?').charAt(0).toUpperCase()}</span>
}

export function DriveFeatureHost() {
  const { lang } = useLanguage()
  const vi = lang === 'vi'
  const { showSnackbar } = useSnackbar()
  const location = useLocation()
  const [dialog, setDialog] = useState<{ action: Exclude<DriveAction, 'copy'>; file: FileItem } | null>(null)

  // The folder open in All files, for new Google Docs.
  const openFolderId = location.pathname.startsWith('/all-files') ? new URLSearchParams(location.search).get('folderId') : null

  useEffect(() => onDriveAction((detail) => {
    if (detail.action === 'new-google-doc') {
      createGoogleDoc(detail.kind).catch(() => undefined)
      return
    }
    if (detail.action === 'copy') {
      copyFile(detail.file).catch(() => undefined)
      return
    }
    setDialog({ action: detail.action, file: detail.file })
  }), [openFolderId, vi])

  async function copyFile(file: FileItem) {
    showSnackbar(vi ? `Đang tạo bản sao của "${file.name}"...` : `Copying "${file.name}"...`)
    try {
      const data = await apiFetch<{ file: { name: string } }>(`/files/${fileKey(file)}/copy`, { method: 'POST', body: JSON.stringify({}) })
      showSnackbar(vi ? `Đã tạo "${data.file.name}"` : `Created "${data.file.name}"`)
      notifyFilesChanged()
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không tạo được bản sao' : 'Could not copy'))
    }
  }

  async function createGoogleDoc(kind: 'document' | 'spreadsheet' | 'presentation' | 'form') {
    // Opened before the request, while the click still counts, or the browser blocks the pop-up.
    const tab = window.open('about:blank', '_blank')
    try {
      const data = await apiFetch<{ webViewLink: string | null; file: { name: string } }>('/files/google-doc', { method: 'POST', body: JSON.stringify({ kind, folderId: openFolderId }) })
      if (tab && data.webViewLink) tab.location.href = data.webViewLink
      else tab?.close()
      showSnackbar(vi ? `Đã tạo "${data.file.name}"` : `Created "${data.file.name}"`)
      notifyFilesChanged()
    } catch (error) {
      tab?.close()
      showSnackbar(errorText(error, vi ? 'Không tạo được tệp' : 'Could not create the file'))
    }
  }

  const close = () => setDialog(null)
  if (!dialog) return null
  const { file } = dialog
  const props = { file, vi, onClose: close, notify: showSnackbar }
  if (dialog.action === 'export') return <ExportDialog {...props} />
  if (dialog.action === 'shortcut') return <ShortcutDialog {...props} />
  if (dialog.action === 'versions') return <VersionsDialog {...props} />
  if (dialog.action === 'comments') return <CommentsDialog {...props} />
  return <LockDialog {...props} />
}

type DialogProps = { file: FileItem; vi: boolean; onClose: () => void; notify: (message: string) => void }

function ExportDialog({ file, vi, onClose, notify }: DialogProps) {
  const [formats, setFormats] = useState<Array<{ mimeType: string; extension: string }> | null>(null)
  const [busy, setBusy] = useState('')
  useEffect(() => {
    apiFetch<{ formats: Array<{ mimeType: string; extension: string }> }>(`/files/${fileKey(file)}/export-formats`)
      .then((data) => setFormats(data.formats))
      .catch((error) => { notify(errorText(error, 'Export formats failed')); setFormats([]) })
  }, [file])

  async function download(mimeType: string) {
    setBusy(mimeType)
    try {
      await downloadWithAuth(`/files/${fileKey(file)}/download?format=${encodeURIComponent(mimeType)}`, file.name)
      onClose()
    } catch (error) {
      notify(errorText(error, vi ? 'Tải xuống thất bại' : 'Download failed'))
    } finally {
      setBusy('')
    }
  }

  return (
    <DummyModal open title={vi ? 'Tải xuống dưới dạng' : 'Download as'} description={file.name} onClose={onClose}>
      {formats === null ? <p className="py-4 text-sm text-slate-400">{vi ? 'Đang tải...' : 'Loading...'}</p> : null}
      {formats && formats.length === 0 ? <p className="py-4 text-sm text-slate-500">{vi ? 'Tệp này tải xuống được ở dạng gốc, không cần chuyển đổi.' : 'This file downloads as it is; there is nothing to convert.'}</p> : null}
      <div className="grid gap-1">
        {(formats ?? []).map((format) => (
          <button
            key={format.mimeType}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => download(format.mimeType)}
            className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#282a2c] disabled:opacity-60 cursor-pointer"
          >
            <span>{formatLabels[format.mimeType] ?? `${format.mimeType}${format.extension ? ` (${format.extension})` : ''}`}</span>
            {busy === format.mimeType ? <span className="text-xs text-slate-400">{vi ? 'Đang tải...' : 'Downloading...'}</span> : <Download className="h-4 w-4 text-slate-400" />}
          </button>
        ))}
      </div>
    </DummyModal>
  )
}

function ShortcutDialog({ file, vi, onClose, notify }: DialogProps) {
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    apiFetch<{ folders: FolderOption[] }>('/folders?all=1').then((data) => setFolders(data.folders)).catch(() => setFolders([]))
  }, [])

  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const label = (folder: FolderOption) => {
    const names = [folder.name]
    let parent = folder.parentId ? byId.get(folder.parentId) : undefined
    for (let depth = 0; parent && depth < 20; depth += 1) {
      names.unshift(parent.name)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
    return names.join(' / ')
  }
  const options = folders.map((folder) => ({ id: folder.id, label: label(folder) })).sort((a, b) => a.label.localeCompare(b.label, 'vi'))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await apiFetch(`/files/${fileKey(file)}/shortcut`, { method: 'POST', body: JSON.stringify({ folderId: target || null }) })
      notify(vi ? 'Đã thêm lối tắt' : 'Shortcut added')
      notifyFilesChanged()
      onClose()
    } catch (error) {
      notify(errorText(error, vi ? 'Không thêm được lối tắt' : 'Could not add the shortcut'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DummyModal open title={vi ? 'Thêm lối tắt vào Drive' : 'Add shortcut to Drive'} description={file.name} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <select value={target} onChange={(event) => setTarget(event.target.value)} className="h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-2 text-sm text-slate-800 dark:text-slate-100">
          <option value="">{vi ? 'Drive của tôi' : 'My Drive'}</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400">{vi ? 'Lối tắt nằm trong cùng tài khoản Google với tệp gốc; mở lối tắt là mở tệp gốc.' : 'The shortcut lives in the same Google account as the file; opening it opens the file.'}</p>
        <div className="flex justify-end gap-2">
          <Button variant="text" type="button" onClick={onClose}>{vi ? 'Huỷ' : 'Cancel'}</Button>
          <Button variant="filled" type="submit" disabled={busy}>{busy ? (vi ? 'Đang thêm...' : 'Adding...') : (vi ? 'Thêm' : 'Add')}</Button>
        </div>
      </form>
    </DummyModal>
  )
}

function VersionsDialog({ file, vi, onClose, notify }: DialogProps) {
  const [data, setData] = useState<{ revisions: Revision[]; isGoogleDoc: boolean; canModify: boolean } | null>(null)
  const [busy, setBusy] = useState('')
  const base = `/files/${fileKey(file)}/revisions`

  function load() {
    apiFetch<{ revisions: Revision[]; isGoogleDoc: boolean; canModify: boolean }>(base)
      .then(setData)
      .catch((error) => { notify(errorText(error, 'Revisions failed')); onClose() })
  }
  useEffect(load, [file])

  async function run(key: string, task: () => Promise<unknown>, success: string) {
    setBusy(key)
    try {
      await task()
      notify(success)
      load()
    } catch (error) {
      notify(errorText(error, vi ? 'Thao tác thất bại' : 'Action failed'))
    } finally {
      setBusy('')
    }
  }

  const revisions = [...(data?.revisions ?? [])].reverse()
  const latestId = data?.revisions[data.revisions.length - 1]?.id

  return (
    <DummyModal open title={vi ? 'Quản lý phiên bản' : 'Manage versions'} description={file.name} onClose={onClose} className="sm:max-w-xl">
      {!data ? <p className="py-4 text-sm text-slate-400">{vi ? 'Đang tải...' : 'Loading...'}</p> : null}
      {data?.isGoogleDoc ? <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{vi ? 'Với Google Tài liệu/Trang tính/Trang trình bày, Google chỉ cho tải các phiên bản cũ về; khôi phục thì mở tệp trên Google → Lịch sử phiên bản.' : 'For Google Docs/Sheets/Slides, older versions can be downloaded; restore them in Google Drive → Version history.'}</p> : null}
      <ul className="max-h-[55vh] divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto">
        {revisions.map((revision) => {
          const isLatest = revision.id === latestId
          return (
            <li key={revision.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  {revision.modifiedTime ? formatDate(revision.modifiedTime) : revision.id}
                  {isLatest ? <span className="ml-2 rounded-full bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">{vi ? 'Hiện tại' : 'Current'}</span> : null}
                  {revision.keepForever ? <span className="ml-2 rounded-full bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">{vi ? 'Giữ mãi mãi' : 'Kept forever'}</span> : null}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {revision.lastModifyingUser?.displayName ?? ''}
                  {revision.size ? ` · ${formatBytes(revision.size)}` : ''}
                  {revision.originalFilename && revision.originalFilename !== file.name ? ` · ${revision.originalFilename}` : ''}
                </p>
              </div>
              <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => run(`dl-${revision.id}`, () => downloadWithAuth(`${base}/${revision.id}/download`, file.name), vi ? 'Đã tải xuống' : 'Downloaded')}>
                <Download className="h-4 w-4" />{vi ? 'Tải' : 'Download'}
              </Button>
              {!data?.isGoogleDoc && data?.canModify ? (
                <>
                  <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => run(`keep-${revision.id}`, () => apiFetch(`${base}/${revision.id}`, { method: 'PATCH', body: JSON.stringify({ keepForever: !revision.keepForever }) }), vi ? 'Đã cập nhật' : 'Updated')}>
                    {revision.keepForever ? (vi ? 'Bỏ giữ' : 'Unkeep') : (vi ? 'Giữ mãi' : 'Keep')}
                  </Button>
                  {!isLatest ? (
                    <>
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => run(`restore-${revision.id}`, () => apiFetch(`${base}/${revision.id}/restore`, { method: 'POST' }).then(notifyFilesChanged), vi ? 'Đã khôi phục thành phiên bản mới nhất' : 'Restored as the newest version')}>
                        <RotateCcw className="h-4 w-4" />{vi ? 'Khôi phục' : 'Restore'}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" disabled={Boolean(busy)} onClick={() => run(`del-${revision.id}`, () => apiFetch(`${base}/${revision.id}`, { method: 'DELETE' }), vi ? 'Đã xoá phiên bản' : 'Version deleted')}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                </>
              ) : null}
            </li>
          )
        })}
      </ul>
    </DummyModal>
  )
}

function CommentsDialog({ file, vi, onClose, notify }: DialogProps) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [showResolved, setShowResolved] = useState(false)
  const [busy, setBusy] = useState(false)
  const base = `/files/${fileKey(file)}/comments`

  function load() {
    apiFetch<{ comments: Comment[] }>(base).then((data) => setComments(data.comments.filter((comment) => !comment.deleted))).catch((error) => { notify(errorText(error, 'Comments failed')); setComments([]) })
  }
  useEffect(load, [file])

  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    try {
      await task()
      load()
    } catch (error) {
      notify(errorText(error, vi ? 'Thao tác thất bại' : 'Action failed'))
    } finally {
      setBusy(false)
    }
  }

  const visible = (comments ?? []).filter((comment) => showResolved || !comment.resolved)
  const resolvedCount = (comments ?? []).filter((comment) => comment.resolved).length

  return (
    <DummyModal open title={vi ? 'Bình luận' : 'Comments'} description={file.name} onClose={onClose} className="sm:max-w-xl">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          run(() => apiFetch(base, { method: 'POST', body: JSON.stringify({ content: draft.trim() }) }).then(() => setDraft('')))
        }}
        className="mb-3 grid gap-2"
      >
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder={vi ? 'Thêm bình luận (gõ +email để nhắc tên người khác)' : 'Add a comment (+email mentions someone)'} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] p-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none" />
        <div className="flex items-center justify-between">
          {resolvedCount > 0 ? (
            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />{vi ? `Hiện ${resolvedCount} bình luận đã giải quyết` : `Show ${resolvedCount} resolved`}</label>
          ) : <span />}
          <Button size="sm" variant="filled" type="submit" disabled={busy || !draft.trim()}><MessageSquare className="h-4 w-4" />{vi ? 'Bình luận' : 'Comment'}</Button>
        </div>
      </form>
      {comments === null ? <p className="py-4 text-sm text-slate-400">{vi ? 'Đang tải...' : 'Loading...'}</p> : null}
      {comments && visible.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">{vi ? 'Chưa có bình luận nào.' : 'No comments yet.'}</p> : null}
      <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
        {visible.map((comment) => (
          <li key={comment.id} className={cn('rounded-xl border p-3', comment.resolved ? 'border-slate-100 dark:border-slate-800 opacity-70' : 'border-slate-200 dark:border-slate-700')}>
            <div className="flex items-start gap-2">
              <Avatar author={comment.author} />
              <div className="min-w-0 flex-1">
                <p className="text-xs"><span className="font-semibold text-slate-800 dark:text-slate-100">{comment.author?.displayName}</span> <span className="text-slate-400">{comment.createdTime ? formatDate(comment.createdTime) : ''}</span></p>
                {comment.quotedFileContent?.value ? <p className="mt-1 border-l-2 border-amber-300 pl-2 text-xs italic text-slate-500">{comment.quotedFileContent.value}</p> : null}
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{comment.content}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" title={comment.resolved ? (vi ? 'Mở lại' : 'Reopen') : (vi ? 'Đánh dấu đã giải quyết' : 'Resolve')} disabled={busy} onClick={() => run(() => apiFetch(`${base}/${comment.id}/replies`, { method: 'POST', body: JSON.stringify({ action: comment.resolved ? 'reopen' : 'resolve' }) }))} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-[#282a2c] cursor-pointer">
                  {comment.resolved ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                </button>
                {comment.author?.me ? (
                  <button type="button" title={vi ? 'Xoá' : 'Delete'} disabled={busy} onClick={() => run(() => apiFetch(`${base}/${comment.id}`, { method: 'DELETE' }))} className="rounded-full p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            {(comment.replies ?? []).filter((reply) => !reply.deleted).map((reply) => (
              <div key={reply.id} className="ml-9 mt-2 flex items-start gap-2">
                <Avatar author={reply.author} />
                <div className="min-w-0">
                  <p className="text-xs"><span className="font-semibold text-slate-800 dark:text-slate-100">{reply.author?.displayName}</span> <span className="text-slate-400">{reply.createdTime ? formatDate(reply.createdTime) : ''}</span></p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{reply.action === 'resolve' ? (vi ? '✓ Đã đánh dấu là đã giải quyết' : '✓ Marked as resolved') : reply.action === 'reopen' ? (vi ? 'Đã mở lại' : 'Reopened') : reply.content}</p>
                </div>
              </div>
            ))}
            {!comment.resolved ? (
              <form
                className="ml-9 mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const content = (replyDrafts[comment.id] ?? '').trim()
                  if (!content) return
                  run(() => apiFetch(`${base}/${comment.id}/replies`, { method: 'POST', body: JSON.stringify({ content }) }).then(() => setReplyDrafts((prev) => ({ ...prev, [comment.id]: '' }))))
                }}
              >
                <input value={replyDrafts[comment.id] ?? ''} onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: event.target.value }))} placeholder={vi ? 'Trả lời' : 'Reply'} className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none" />
                <Button size="sm" variant="ghost" type="submit" disabled={busy}>{vi ? 'Gửi' : 'Send'}</Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </DummyModal>
  )
}

function LockDialog({ file, vi, onClose, notify }: DialogProps) {
  const [state, setState] = useState<{ locked: boolean; reason?: string; by?: string; canModify: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiFetch<{ details: { contentRestrictions?: Array<{ readOnly?: boolean; reason?: string; restrictingUser?: { displayName?: string } }>; capabilities?: { canModifyContentRestriction?: boolean } }; canModify: boolean }>(`/files/${fileKey(file)}/drive-details`)
      .then((data) => {
        const restriction = data.details.contentRestrictions?.find((item) => item.readOnly)
        setState({ locked: Boolean(restriction), reason: restriction?.reason, by: restriction?.restrictingUser?.displayName, canModify: data.canModify && data.details.capabilities?.canModifyContentRestriction !== false })
      })
      .catch((error) => { notify(errorText(error, 'Lock state failed')); onClose() })
  }, [file])

  async function toggle() {
    if (!state) return
    setBusy(true)
    try {
      await apiFetch(`/files/${fileKey(file)}/lock`, { method: 'POST', body: JSON.stringify({ locked: !state.locked, ...(reason.trim() ? { reason: reason.trim() } : {}) }) })
      notify(state.locked ? (vi ? 'Đã mở khoá tệp' : 'File unlocked') : (vi ? 'Đã khoá tệp' : 'File locked'))
      onClose()
    } catch (error) {
      notify(errorText(error, vi ? 'Không đổi được trạng thái khoá' : 'Could not change the lock'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DummyModal open title={vi ? 'Khoá tệp' : 'Lock file'} description={file.name} onClose={onClose}>
      {!state ? <p className="py-4 text-sm text-slate-400">{vi ? 'Đang tải...' : 'Loading...'}</p> : (
        <div className="grid gap-3 text-sm">
          <p className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
            {state.locked ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
            <span>
              {state.locked
                ? (vi ? `Tệp đang bị khoá${state.by ? ` bởi ${state.by}` : ''}: không ai sửa được nội dung cho tới khi mở khoá.` : `Locked${state.by ? ` by ${state.by}` : ''}: nobody can edit the content until it is unlocked.`)
                : (vi ? 'Khoá để không ai (kể cả người chỉnh sửa) sửa được nội dung, bình luận vẫn được. Ai có quyền chỉnh sửa đều mở khoá được.' : 'Locking stops everyone, editors included, from changing the content; comments still work. Any editor can unlock it.')}
              {state.locked && state.reason ? <span className="block text-xs text-slate-500">{vi ? 'Lý do: ' : 'Reason: '}{state.reason}</span> : null}
            </span>
          </p>
          {!state.locked ? <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={vi ? 'Lý do (tuỳ chọn)' : 'Reason (optional)'} className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-2 text-sm text-slate-900 dark:text-slate-100" /> : null}
          {!state.canModify ? <p className="text-xs text-amber-600 dark:text-amber-400">{vi ? 'Chỉ người tải tệp lên hoặc chủ tài khoản lưu trữ mới khoá/mở khoá được.' : 'Only the uploader or the storage account owner can change this.'}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="text" type="button" onClick={onClose}>{vi ? 'Đóng' : 'Close'}</Button>
            <Button variant="filled" type="button" disabled={busy || !state.canModify} onClick={toggle}>{state.locked ? (vi ? 'Mở khoá' : 'Unlock') : (vi ? 'Khoá tệp' : 'Lock')}</Button>
          </div>
        </div>
      )}
    </DummyModal>
  )
}

