import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Circle,
  ExternalLink,
  Folder,
  GraduationCap,
  Inbox,
  Link2,
  Loader2,
  Pencil,
  PlayCircle,
  Plus,
  SkipForward,
  Trash2,
} from 'lucide-react'
import { apiFetch, API_URL, formatBytes, formatDriveDate } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Library: Drive links other people shared with the user (a bought course, a lesson folder, a document),
// grouped into courses, with lessons played inside HCDrive and progress kept per lesson.
// Backend: modules/library/library.routes.ts.

type SavedLink = {
  id: string
  driveFileId: string
  title: string
  url: string
  mimeType: string
  isFolder: boolean
  ownerName: string | null
  ownerEmail: string | null
  collection: string
  note: string
  lastOpenedAt: string | null
  createdAt: string
  account: { id: string; email: string } | null
  completedCount: number
}

type Lesson = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  size: string | null
  durationSeconds: number | null
  canDownload: boolean
  resourceKey: string | null
  webViewLink: string | null
  previewUrl: string | null
  streamUrl: string | null
  completed: boolean
  positionSeconds: number
}

type SharedItem = { id: string; name: string; mimeType: string; ownerName: string; ownerEmail: string | null; accountId: string; accountEmail: string; isFolder: boolean }

type FolderStep = { id: string | null; name: string; rk: string | null }

const UNGROUPED = '\u0000'

function formatDuration(seconds: number | null) {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function LibraryPage() {
  const { lang } = useLanguage()
  const vi = lang === 'vi'
  const { showSnackbar } = useSnackbar()
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('link')

  const [links, setLinks] = useState<SavedLink[]>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; email: string }>>([])
  const [loading, setLoading] = useState(true)
  const [activeCollection, setActiveCollection] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editing, setEditing] = useState<SavedLink | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ links: SavedLink[]; accounts: Array<{ id: string; email: string }> }>('/library')
      setLinks(data.links)
      setAccounts(data.accounts)
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không tải được thư viện' : 'Could not load the library'))
    } finally {
      setLoading(false)
    }
  }, [showSnackbar, vi])

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  const collections = useMemo(() => {
    const names = new Map<string, number>()
    for (const link of links) names.set(link.collection, (names.get(link.collection) ?? 0) + 1)
    return [...names.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'vi', { numeric: true })))
  }, [links])

  const openLink = links.find((link) => link.id === openId) ?? null

  function open(link: SavedLink | null) {
    const next = new URLSearchParams(searchParams)
    if (link) next.set('link', link.id)
    else next.delete('link')
    setSearchParams(next)
    if (!link) load().catch(() => undefined)
  }

  async function remove(link: SavedLink) {
    if (!window.confirm(vi ? `Xoá "${link.title}" khỏi thư viện? Tệp trên Google Drive không bị ảnh hưởng.` : `Remove "${link.title}" from the library? The Drive files are not touched.`)) return
    try {
      await apiFetch(`/library/${link.id}`, { method: 'DELETE' })
      setLinks((current) => current.filter((item) => item.id !== link.id))
    } catch (error) {
      showSnackbar(errorText(error, vi ? 'Không xoá được' : 'Could not remove'))
    }
  }

  if (openId) {
    if (loading) return <CenteredSpinner />
    if (!openLink) {
      return (
        <div className="p-6 text-sm text-slate-600 dark:text-slate-300">
          {vi ? 'Không tìm thấy link này trong thư viện.' : 'This link is not in your library.'}{' '}
          <button type="button" className="text-[#0b57d0] dark:text-[#a8c7fa] hover:underline cursor-pointer" onClick={() => open(null)}>{vi ? 'Quay lại' : 'Back'}</button>
        </div>
      )
    }
    return <LessonView link={openLink} vi={vi} onBack={() => open(null)} onEdit={() => setEditing(openLink)} editing={editing} onEdited={(link) => { setLinks((current) => current.map((item) => (item.id === link.id ? link : item))); setEditing(null) }} onCloseEdit={() => setEditing(null)} collections={collections.map(([name]) => name)} />
  }

  const visible = activeCollection === null ? links : links.filter((link) => link.collection === (activeCollection === UNGROUPED ? '' : activeCollection))
  const groups = activeCollection === null
    ? collections.map(([name]) => [name, links.filter((link) => link.collection === name)] as const)
    : [[activeCollection === UNGROUPED ? '' : activeCollection, visible] as const]

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-4 pb-3 pt-3 dark:border-slate-800 sm:px-6">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[22px] font-normal text-slate-800 dark:text-slate-100">
            <GraduationCap className="h-6 w-6 text-[#0b57d0] dark:text-[#a8c7fa]" />
            {vi ? 'Khóa học' : 'Courses'}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {vi ? 'Link Google Drive người khác chia sẻ riêng cho email của bạn: khóa học đã mua, thư mục bài giảng, tài liệu.' : 'Google Drive links shared with your email: courses you bought, lesson folders, documents.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} disabled={accounts.length === 0}>
            <Inbox className="mr-1.5 h-4 w-4" />
            {vi ? 'Chọn từ "Được chia sẻ với tôi"' : 'Pick from "Shared with me"'}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={accounts.length === 0}>
            <Plus className="mr-1.5 h-4 w-4" />
            {vi ? 'Thêm link' : 'Add link'}
          </Button>
        </div>
      </div>

      {collections.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto px-4 py-2.5 sm:px-6">
          <CollectionChip active={activeCollection === null} onClick={() => setActiveCollection(null)} label={vi ? 'Tất cả' : 'All'} count={links.length} />
          {collections.map(([name, count]) => (
            <CollectionChip key={name || 'ungrouped'} active={activeCollection === (name || UNGROUPED)} onClick={() => setActiveCollection(name || UNGROUPED)} label={name || (vi ? 'Chưa xếp khóa' : 'Not grouped')} count={count} />
          ))}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
        {loading ? <CenteredSpinner /> : null}
        {!loading && accounts.length === 0 ? (
          <EmptyState
            title={vi ? 'Chưa có tài khoản Google nào' : 'No Google account yet'}
            body={vi ? 'HCDrive mở link được chia sẻ qua chính tài khoản Google nhận link. Kết nối tài khoản Google có email người bán khóa học đã chia sẻ cho.' : 'HCDrive opens shared links through the Google account they were shared with. Connect that account first.'}
            action={<a href="/accounts" className="text-sm font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">{vi ? 'Đến Tài khoản lưu trữ' : 'Go to storage accounts'}</a>}
          />
        ) : null}
        {!loading && accounts.length > 0 && links.length === 0 ? (
          <EmptyState
            title={vi ? 'Thêm khóa học đầu tiên' : 'Add your first course'}
            body={vi ? 'Dán link Google Drive mà người bán chia sẻ cho email của bạn, rồi xếp vào khóa học. Video phát ngay trong HCDrive và nhớ bạn đã học tới đâu.' : 'Paste the Drive link shared with your email and file it under a course. Videos play in HCDrive and your progress is kept.'}
            action={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" />{vi ? 'Thêm link' : 'Add link'}</Button>}
          />
        ) : null}

        {groups.map(([name, items]) => (
          <section key={name || 'ungrouped'} className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{name || (vi ? 'Chưa xếp khóa' : 'Not grouped')}</h2>
              <span className="text-xs text-slate-400">{items.length}</span>
              {name ? (
                <button type="button" onClick={() => setRenaming(name)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-[#282a2c] cursor-pointer" title={vi ? 'Đổi tên khóa' : 'Rename course'} aria-label={vi ? 'Đổi tên khóa' : 'Rename course'}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((link) => (
                <LinkCard key={link.id} link={link} vi={vi} onOpen={() => open(link)} onEdit={() => setEditing(link)} onRemove={() => remove(link)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <AddLinkModal open={addOpen} vi={vi} collections={collections.map(([name]) => name).filter(Boolean)} defaultCollection={activeCollection && activeCollection !== UNGROUPED ? activeCollection : ''} onClose={() => setAddOpen(false)} onAdded={(link) => { setLinks((current) => [...current.filter((item) => item.id !== link.id), link]); setAddOpen(false) }} />
      <SharedPickerModal open={pickerOpen} vi={vi} accounts={accounts} savedIds={new Set(links.map((link) => link.driveFileId))} collections={collections.map(([name]) => name).filter(Boolean)} onClose={() => setPickerOpen(false)} onDone={() => { setPickerOpen(false); load().catch(() => undefined) }} />
      <EditLinkModal link={editing} vi={vi} collections={collections.map(([name]) => name).filter(Boolean)} onClose={() => setEditing(null)} onSaved={(link) => { setLinks((current) => current.map((item) => (item.id === link.id ? link : item))); setEditing(null) }} />
      <RenameCollectionModal name={renaming} vi={vi} onClose={() => setRenaming(null)} onDone={(from, to) => { setLinks((current) => current.map((link) => (link.collection === from ? { ...link, collection: to } : link))); if (activeCollection === from) setActiveCollection(to || UNGROUPED); setRenaming(null) }} />
    </div>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <GraduationCap className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
      <h2 className="mt-3 text-base font-medium text-slate-800 dark:text-slate-100">{title}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{body}</p>
      <div className="mt-4">{action}</div>
    </div>
  )
}

function CollectionChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer',
        active
          ? 'border-transparent bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff]'
          : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#282a2c]',
      )}
    >
      {label} <span className="ml-1 opacity-60">{count}</span>
    </button>
  )
}

function LinkCard({ link, vi, onOpen, onEdit, onRemove }: { link: SavedLink; vi: boolean; onOpen: () => void; onEdit: () => void; onRemove: () => void }) {
  const visual = link.isFolder ? { icon: Folder, color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' } : getFileVisual(link.mimeType)
  const Icon = visual.icon
  return (
    <div className="group relative flex cursor-pointer flex-col rounded-2xl border border-slate-200/80 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-[#1e1f20] dark:hover:border-slate-700" onClick={onOpen}>
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', visual.bg)}>
          <Icon className={cn('h-5 w-5', visual.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-100" title={link.title}>{link.title}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {link.ownerName || link.ownerEmail ? `${vi ? 'Chia sẻ bởi' : 'Shared by'} ${link.ownerName || link.ownerEmail}` : link.isFolder ? (vi ? 'Thư mục' : 'Folder') : vi ? 'Tệp' : 'File'}
          </p>
        </div>
      </div>
      {link.note ? <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{link.note}</p> : null}
      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <CheckCircle2 className={cn('h-3.5 w-3.5', link.completedCount > 0 ? 'text-emerald-600' : 'text-slate-300 dark:text-slate-600')} />
          {vi ? `Đã học ${link.completedCount} bài` : `${link.completedCount} done`}
        </span>
        <span>{link.lastOpenedAt ? `${vi ? 'Mở' : 'Opened'} ${formatDriveDate(link.lastOpenedAt, vi ? 'vi' : 'en')}` : vi ? 'Chưa mở' : 'Not opened'}</span>
      </div>
      {!link.account ? <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{vi ? 'Tài khoản Google mở link này đã bị gỡ; HCDrive sẽ thử tài khoản khác khi mở.' : 'The Google account for this link was removed; another one is tried on open.'}</p> : null}
      <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
        <a href={link.url} target="_blank" rel="noreferrer" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-[#282a2c]" title={vi ? 'Mở trên Google Drive' : 'Open in Google Drive'} aria-label={vi ? 'Mở trên Google Drive' : 'Open in Google Drive'}>
          <ExternalLink className="h-4 w-4" />
        </a>
        <button type="button" onClick={onEdit} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-[#282a2c] cursor-pointer" title={vi ? 'Sửa' : 'Edit'} aria-label={vi ? 'Sửa' : 'Edit'}>
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" onClick={onRemove} className="rounded-full p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 cursor-pointer" title={vi ? 'Xoá khỏi thư viện' : 'Remove from library'} aria-label={vi ? 'Xoá khỏi thư viện' : 'Remove from library'}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 dark:border-slate-700 dark:bg-[#131314] dark:text-slate-100'

function CollectionInput({ value, onChange, collections, vi }: { value: string; onChange: (value: string) => void; collections: string[]; vi: boolean }) {
  return (
    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
      {vi ? 'Khóa học (nhóm)' : 'Course (group)'}
      <input list="library-collections" value={value} onChange={(event) => onChange(event.target.value)} maxLength={120} placeholder={vi ? 'Ví dụ: Khóa React nâng cao' : 'Advanced React course'} className={cn(inputClass, 'mt-1')} />
      <datalist id="library-collections">
        {collections.map((name) => <option key={name} value={name} />)}
      </datalist>
    </label>
  )
}

function AddLinkModal({ open, vi, collections, defaultCollection, onClose, onAdded }: { open: boolean; vi: boolean; collections: string[]; defaultCollection: string; onClose: () => void; onAdded: (link: SavedLink) => void }) {
  const { showSnackbar } = useSnackbar()
  const [url, setUrl] = useState('')
  const [collection, setCollection] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setTitle('')
    setError('')
    setCollection(defaultCollection)
  }, [open, defaultCollection])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!url.trim()) {
      setError(vi ? 'Dán link Google Drive trước.' : 'Paste a Google Drive link first.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const data = await apiFetch<{ link: SavedLink; existed: boolean }>('/library', { method: 'POST', body: JSON.stringify({ url: url.trim(), collection: collection.trim(), title: title.trim() || undefined }) })
      showSnackbar(data.existed ? (vi ? 'Link này đã có trong thư viện' : 'Already in your library') : (vi ? 'Đã thêm vào thư viện' : 'Added to your library'))
      onAdded(data.link)
    } catch (err) {
      setError(errorText(err, vi ? 'Không thêm được link' : 'Could not add the link'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DummyModal open={open} onClose={onClose} title={vi ? 'Thêm link được chia sẻ' : 'Add a shared link'} description={vi ? 'Link thư mục hoặc tệp Google Drive / Docs đã được chia sẻ cho email Google bạn đã kết nối.' : 'A Drive / Docs folder or file link shared with a Google account you connected.'}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          {vi ? 'Link Google Drive' : 'Google Drive link'}
          <input autoFocus value={url} onChange={(event) => { setUrl(event.target.value); setError('') }} placeholder="https://drive.google.com/drive/folders/…" className={cn(inputClass, 'mt-1')} />
        </label>
        <CollectionInput value={collection} onChange={setCollection} collections={collections} vi={vi} />
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          {vi ? 'Tên hiển thị (để trống = tên trên Drive)' : 'Display name (blank = the Drive name)'}
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} className={cn(inputClass, 'mt-1')} />
        </label>
        {error ? <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="text" onClick={onClose}>{vi ? 'Huỷ' : 'Cancel'}</Button>
          <Button type="submit" size="sm" disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}{vi ? 'Thêm' : 'Add'}</Button>
        </div>
      </form>
    </DummyModal>
  )
}

function SharedPickerModal({ open, vi, accounts, savedIds, collections, onClose, onDone }: { open: boolean; vi: boolean; accounts: Array<{ id: string; email: string }>; savedIds: Set<string>; collections: string[]; onClose: () => void; onDone: () => void }) {
  const { showSnackbar } = useSnackbar()
  const [items, setItems] = useState<SharedItem[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collection, setCollection] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setItems(null)
    setSelected(new Set())
    setQuery('')
    const own = new Set(accounts.map((account) => account.id))
    apiFetch<{ items: SharedItem[] }>('/files/shared-with-me')
      .then((data) => setItems(data.items.filter((item) => own.has(item.accountId))))
      .catch((error) => {
        setItems([])
        showSnackbar(errorText(error, vi ? 'Không tải được danh sách' : 'Could not load the list'))
      })
  }, [open, accounts, showSnackbar, vi])

  const shown = (items ?? []).filter((item) => !query || item.name.toLowerCase().includes(query.toLowerCase()) || (item.ownerEmail ?? '').toLowerCase().includes(query.toLowerCase()))

  async function importSelected() {
    const chosen = (items ?? []).filter((item) => selected.has(`${item.accountId}:${item.id}`))
    if (chosen.length === 0) return
    setSaving(true)
    let added = 0
    for (const item of chosen) {
      try {
        await apiFetch('/library', { method: 'POST', body: JSON.stringify({ fileId: item.id, accountId: item.accountId, collection: collection.trim() }) })
        added += 1
      } catch {
        // reported in the total below
      }
    }
    setSaving(false)
    showSnackbar(vi ? `Đã thêm ${added}/${chosen.length} mục vào thư viện` : `Added ${added} of ${chosen.length} to your library`)
    onDone()
  }

  return (
    <DummyModal open={open} onClose={onClose} className="max-w-2xl" title={vi ? 'Chọn từ "Được chia sẻ với tôi"' : 'Pick from "Shared with me"'} description={vi ? 'Những gì người khác đã chia sẻ cho các tài khoản Google bạn kết nối.' : 'What others shared with the Google accounts you connected.'}>
      <div className="space-y-3">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={vi ? 'Tìm theo tên hoặc email người chia sẻ' : 'Search by name or sharer'} className={inputClass} />
        <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
          {items === null ? <CenteredSpinner /> : null}
          {items !== null && shown.length === 0 ? <p className="p-4 text-sm text-slate-500">{vi ? 'Không có mục nào.' : 'Nothing here.'}</p> : null}
          {shown.map((item) => {
            const key = `${item.accountId}:${item.id}`
            const visual = item.isFolder ? { icon: Folder, color: 'text-slate-500' } : getFileVisual(item.mimeType)
            const Icon = visual.icon
            const saved = savedIds.has(item.id)
            return (
              <label key={key} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-[#282a2c]">
                <input type="checkbox" className="accent-[#0b57d0]" checked={selected.has(key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })} />
                <Icon className={cn('h-4 w-4 shrink-0', visual.color)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{item.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{item.ownerName}{item.ownerEmail ? ` · ${item.ownerEmail}` : ''} → {item.accountEmail}</span>
                </span>
                {saved ? <span className="text-[11px] text-emerald-600">{vi ? 'Đã có' : 'Saved'}</span> : null}
              </label>
            )
          })}
        </div>
        <CollectionInput value={collection} onChange={setCollection} collections={collections} vi={vi} />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="text" onClick={onClose}>{vi ? 'Huỷ' : 'Cancel'}</Button>
          <Button type="button" size="sm" disabled={saving || selected.size === 0} onClick={importSelected}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            {vi ? `Thêm ${selected.size} mục` : `Add ${selected.size}`}
          </Button>
        </div>
      </div>
    </DummyModal>
  )
}

function EditLinkModal({ link, vi, collections, onClose, onSaved }: { link: SavedLink | null; vi: boolean; collections: string[]; onClose: () => void; onSaved: (link: SavedLink) => void }) {
  const [title, setTitle] = useState('')
  const [collection, setCollection] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!link) return
    setTitle(link.title)
    setCollection(link.collection)
    setNote(link.note)
    setError('')
  }, [link])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!link) return
    if (!title.trim()) {
      setError(vi ? 'Nhập tên.' : 'Enter a name.')
      return
    }
    try {
      const data = await apiFetch<{ link: SavedLink }>(`/library/${link.id}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim(), collection: collection.trim(), note }) })
      onSaved(data.link)
    } catch (err) {
      setError(errorText(err, vi ? 'Không lưu được' : 'Could not save'))
    }
  }

  return (
    <DummyModal open={Boolean(link)} onClose={onClose} title={vi ? 'Sửa link' : 'Edit link'}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          {vi ? 'Tên' : 'Name'}
          <input value={title} onChange={(event) => { setTitle(event.target.value); setError('') }} maxLength={300} className={cn(inputClass, 'mt-1')} />
        </label>
        <CollectionInput value={collection} onChange={setCollection} collections={collections} vi={vi} />
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          {vi ? 'Ghi chú' : 'Note'}
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={5000} rows={4} placeholder={vi ? 'Mật khẩu nhóm, link nhóm hỗ trợ, hạn truy cập…' : 'Support group link, access expiry…'} className={cn(inputClass, 'mt-1 resize-y')} />
        </label>
        {error ? <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="text" onClick={onClose}>{vi ? 'Huỷ' : 'Cancel'}</Button>
          <Button type="submit" size="sm">{vi ? 'Lưu' : 'Save'}</Button>
        </div>
      </form>
    </DummyModal>
  )
}

function RenameCollectionModal({ name, vi, onClose, onDone }: { name: string | null; vi: boolean; onClose: () => void; onDone: (from: string, to: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setValue(name ?? '')
    setError('')
  }, [name])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (name === null) return
    try {
      await apiFetch('/library/collections/rename', { method: 'POST', body: JSON.stringify({ from: name, to: value.trim() }) })
      onDone(name, value.trim())
    } catch (err) {
      setError(errorText(err, vi ? 'Không đổi tên được' : 'Could not rename'))
    }
  }

  return (
    <DummyModal open={name !== null} onClose={onClose} title={vi ? 'Đổi tên khóa học' : 'Rename course'} description={vi ? 'Để trống để bỏ nhóm các link trong khóa này.' : 'Leave blank to ungroup its links.'}>
      <form onSubmit={submit} className="space-y-3">
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} maxLength={120} className={inputClass} />
        {error ? <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="text" onClick={onClose}>{vi ? 'Huỷ' : 'Cancel'}</Button>
          <Button type="submit" size="sm">{vi ? 'Lưu' : 'Save'}</Button>
        </div>
      </form>
    </DummyModal>
  )
}

// ---- Lessons of one saved link ----

function LessonView({ link, vi, onBack, onEdit, editing, onEdited, onCloseEdit, collections }: { link: SavedLink; vi: boolean; onBack: () => void; onEdit: () => void; editing: SavedLink | null; onEdited: (link: SavedLink) => void; onCloseEdit: () => void; collections: string[] }) {
  const { showSnackbar } = useSnackbar()
  const [path, setPath] = useState<FolderStep[]>([{ id: null, name: link.title, rk: null }])
  const [items, setItems] = useState<Lesson[] | null>(null)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null)
  const [current, setCurrent] = useState<Lesson | null>(null)
  const folder = path[path.length - 1]

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError('')
    const params = new URLSearchParams()
    if (folder.id) params.set('folderId', folder.id)
    if (folder.rk) params.set('rk', folder.rk)
    apiFetch<{ items: Lesson[]; account: { id: string; email: string } }>(`/library/${link.id}/items${params.toString() ? `?${params}` : ''}`)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setAccount(data.account)
        // A single shared file opens straight away.
        if (!link.isFolder && data.items[0]) setCurrent(data.items[0])
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, vi ? 'Không mở được link' : 'Could not open the link'))
      })
    return () => {
      cancelled = true
    }
  }, [link.id, link.isFolder, folder.id, folder.rk, vi])

  const lessons = (items ?? []).filter((item) => !item.isFolder)
  const doneHere = lessons.filter((item) => item.completed).length
  const nextLesson = current ? lessons[lessons.findIndex((item) => item.id === current.id) + 1] ?? null : null

  const saveProgress = useCallback(async (fileId: string, patch: { completed?: boolean; positionSeconds?: number }) => {
    setItems((list) => list?.map((item) => (item.id === fileId ? { ...item, ...(patch.completed !== undefined ? { completed: patch.completed } : {}), ...(patch.positionSeconds !== undefined ? { positionSeconds: patch.positionSeconds } : {}) } : item)) ?? null)
    try {
      await apiFetch(`/library/${link.id}/progress`, { method: 'PUT', body: JSON.stringify({ fileId, ...patch }) })
    } catch (err) {
      if (patch.completed !== undefined) showSnackbar(errorText(err, vi ? 'Không lưu được tiến độ' : 'Could not save progress'))
    }
  }, [link.id, showSnackbar, vi])

  function openItem(item: Lesson) {
    if (item.isFolder) {
      setCurrent(null)
      setPath((steps) => [...steps, { id: item.id, name: item.name, rk: item.resourceKey }])
      return
    }
    setCurrent(item)
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 px-4 py-2.5 dark:border-slate-800 sm:px-6">
        <Button size="icon" variant="ghost" className="rounded-full" onClick={onBack} aria-label={vi ? 'Về thư viện' : 'Back to library'} title={vi ? 'Về thư viện' : 'Back to library'}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {path.map((step, index) => (
            <span key={`${step.id ?? 'root'}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /> : null}
              <button
                type="button"
                disabled={index === path.length - 1}
                onClick={() => { setCurrent(null); setPath((steps) => steps.slice(0, index + 1)) }}
                className={cn('truncate rounded px-1.5 py-0.5', index === path.length - 1 ? 'font-medium text-slate-800 dark:text-slate-100' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-[#282a2c] cursor-pointer')}
              >
                {step.name}
              </button>
            </span>
          ))}
        </nav>
        {link.collection ? <span className="rounded-md bg-[#c2e7ff]/60 px-2 py-0.5 text-[11px] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff]">{link.collection}</span> : null}
        <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="mr-1.5 h-4 w-4" />{vi ? 'Sửa' : 'Edit'}</Button>
        <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-full px-3 text-xs text-[#0b57d0] hover:bg-[#0b57d0]/10 dark:text-[#a8c7fa]">
          <ExternalLink className="mr-1.5 h-4 w-4" />Google Drive
        </a>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:px-6 xl:flex-row xl:overflow-hidden">
        {current ? (
          <div className="min-w-0 xl:flex-1 xl:overflow-y-auto">
            <LessonPlayer key={current.id} lesson={current} vi={vi} accountEmail={account?.email ?? null} onPosition={(seconds) => saveProgress(current.id, { positionSeconds: seconds })} onEnded={() => saveProgress(current.id, { completed: true })} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-base font-medium text-slate-800 dark:text-slate-100" title={current.name}>{current.name}</h2>
              <Button size="sm" variant={items?.find((item) => item.id === current.id)?.completed ? 'tonal' : 'outline'} onClick={() => saveProgress(current.id, { completed: !items?.find((item) => item.id === current.id)?.completed })}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                {items?.find((item) => item.id === current.id)?.completed ? (vi ? 'Đã học' : 'Done') : vi ? 'Đánh dấu đã học' : 'Mark as done'}
              </Button>
              {nextLesson ? (
                <Button size="sm" onClick={() => setCurrent(nextLesson)}>
                  <SkipForward className="mr-1.5 h-4 w-4" />{vi ? 'Bài tiếp' : 'Next'}
                </Button>
              ) : null}
            </div>
            {link.note && path.length === 1 ? <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-[#1e1f20] dark:text-slate-300">{link.note}</p> : null}
          </div>
        ) : null}

        <div className={cn('min-w-0', current ? 'xl:w-[380px] xl:shrink-0 xl:overflow-y-auto' : 'flex-1')}>
          {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
          {!error && items === null ? <CenteredSpinner /> : null}
          {items !== null ? (
            <>
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{lessons.length > 0 ? (vi ? `${doneHere}/${lessons.length} bài đã học trong mục này` : `${doneHere} of ${lessons.length} done here`) : ''}</span>
                {account ? <span title={vi ? 'Tài khoản Google dùng để mở' : 'Google account used'}>{account.email}</span> : null}
              </div>
              {lessons.length > 0 ? (
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneHere / lessons.length) * 100}%` }} />
                </div>
              ) : null}
              {!current && link.note && path.length === 1 ? <p className="mb-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-[#1e1f20] dark:text-slate-300">{link.note}</p> : null}
              {items.length === 0 ? <p className="p-4 text-sm text-slate-500">{vi ? 'Thư mục trống.' : 'This folder is empty.'}</p> : null}
              <ol className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-[#1e1f20]">
                {items.map((item) => {
                  const visual = item.isFolder ? { icon: Folder, color: 'text-slate-500' } : getFileVisual(item.mimeType)
                  const Icon = item.mimeType.startsWith('video/') ? PlayCircle : visual.icon
                  const active = current?.id === item.id
                  return (
                    <li key={item.id} className={cn('flex items-center gap-2 px-2 py-1.5', active && 'bg-[#c2e7ff]/40 dark:bg-[#004a77]/40')}>
                      {item.isFolder ? (
                        <span className="w-7" />
                      ) : (
                        <button type="button" onClick={() => saveProgress(item.id, { completed: !item.completed })} className="rounded-full p-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-[#282a2c]" title={item.completed ? (vi ? 'Bỏ đánh dấu' : 'Mark as not done') : vi ? 'Đánh dấu đã học' : 'Mark as done'} aria-label={item.completed ? (vi ? 'Bỏ đánh dấu' : 'Mark as not done') : vi ? 'Đánh dấu đã học' : 'Mark as done'}>
                          {item.completed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300 dark:text-slate-600" />}
                        </button>
                      )}
                      <button type="button" onClick={() => openItem(item)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left cursor-pointer">
                        <Icon className={cn('h-4 w-4 shrink-0', item.mimeType.startsWith('video/') ? 'text-red-500' : visual.color)} />
                        <span className={cn('min-w-0 flex-1 truncate text-sm', item.completed ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100')} title={item.name}>{item.name}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {item.isFolder ? <ChevronRight className="h-4 w-4" /> : item.durationSeconds ? formatDuration(item.durationSeconds) : item.size ? formatBytes(item.size) : ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          ) : null}
        </div>
      </div>
      <EditLinkModal link={editing} vi={vi} collections={collections.filter(Boolean)} onClose={onCloseEdit} onSaved={onEdited} />
    </div>
  )
}

function LessonPlayer({ lesson, vi, accountEmail, onPosition, onEnded }: { lesson: Lesson; vi: boolean; accountEmail: string | null; onPosition: (seconds: number) => void; onEnded: () => void }) {
  const lastSaved = useRef(lesson.positionSeconds)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const onPositionRef = useRef(onPosition)
  onPositionRef.current = onPosition
  const src = lesson.streamUrl ? `${API_URL}${lesson.streamUrl}` : null

  // Leaving the lesson keeps where it stopped (the component is keyed by lesson, so this runs on switch).
  useEffect(() => () => {
    const time = Math.floor(mediaRef.current?.currentTime ?? 0)
    if (time > 0 && Math.abs(time - lastSaved.current) >= 2) onPositionRef.current(time)
  }, [])

  const mediaProps = {
    controls: true,
    autoPlay: true,
    src: src ?? undefined,
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const media = event.currentTarget
      if (lesson.positionSeconds > 5 && lesson.positionSeconds < media.duration - 10) media.currentTime = lesson.positionSeconds
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => {
      const time = Math.floor(event.currentTarget.currentTime)
      if (Math.abs(time - lastSaved.current) >= 15) {
        lastSaved.current = time
        onPosition(time)
      }
    },
    onPause: (event: SyntheticEvent<HTMLMediaElement>) => {
      const time = Math.floor(event.currentTarget.currentTime)
      lastSaved.current = time
      onPosition(time)
    },
    onEnded: () => {
      lastSaved.current = 0
      onPosition(0)
      onEnded()
    },
  }

  if (src && lesson.mimeType.startsWith('video/')) {
    return <video ref={(node) => { mediaRef.current = node }} {...mediaProps} className="aspect-video w-full rounded-xl bg-black" />
  }
  if (src && lesson.mimeType.startsWith('audio/')) {
    return <audio ref={(node) => { mediaRef.current = node }} {...mediaProps} className="w-full" />
  }
  if (src && lesson.mimeType.startsWith('image/')) {
    return <img src={src} alt={lesson.name} className="max-h-[70vh] w-full rounded-xl bg-slate-100 object-contain dark:bg-black" />
  }
  if (src && lesson.mimeType === 'application/pdf') {
    return <iframe src={src} title={lesson.name} className="h-[75vh] w-full rounded-xl border border-slate-200 dark:border-slate-800" />
  }
  if (src && !lesson.mimeType.startsWith('application/vnd.google-apps.') && !lesson.mimeType.startsWith('text/')) {
    return (
      <div className="rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <p>{vi ? 'Trình duyệt không xem trực tiếp được loại tệp này.' : 'This file type cannot be shown in the browser.'}</p>
        <a href={src} target="_blank" rel="noreferrer" className="mt-2 inline-block font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">{vi ? 'Mở / tải tệp' : 'Open / download'}</a>
      </div>
    )
  }
  // Google Docs, and files whose owner blocked downloads: Google's own viewer, signed in as the account the link was shared with.
  return (
    <div>
      {!lesson.canDownload ? (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {vi
            ? `Người chia sẻ đã chặn tải xuống nên tệp chỉ xem được bằng trình xem của Google Drive. Trình duyệt cần đang đăng nhập Google bằng ${accountEmail ?? 'tài khoản được chia sẻ'}.`
            : `The owner blocked downloads, so this opens in Google Drive's viewer. Your browser must be signed in to Google as ${accountEmail ?? 'the account it was shared with'}.`}
        </p>
      ) : null}
      {lesson.previewUrl ? <iframe src={lesson.previewUrl} title={lesson.name} allow="autoplay; fullscreen" allowFullScreen className="aspect-video w-full rounded-xl border border-slate-200 bg-black dark:border-slate-800" /> : null}
      {lesson.webViewLink ? (
        <a href={lesson.webViewLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">
          <ExternalLink className="h-3.5 w-3.5" />{vi ? 'Mở trong tab mới' : 'Open in a new tab'}
        </a>
      ) : null}
    </div>
  )
}
