import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cookie,
  Download,
  Circle,
  ExternalLink,
  Eye,
  Folder,
  FolderSync,
  GraduationCap,
  HardDriveDownload,
  Inbox,
  Info,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  Mail,
  MoreVertical,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Share2,
  SkipForward,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { apiFetch, API_URL, formatBytes, formatDriveDate } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { useDownload } from '@/context/DownloadContext'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { DummyModal } from '@/components/drive/DummyModal'
import { StreamProgressBar } from '@/components/StreamProgressBar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CourseDetailsModal, DriveCookieModal, SaveToDriveModal, ShareCourseModal, lessonDownloadUrl, startCourseDownload } from '@/components/drive/LibraryDialogs'
import { useMenuPosition } from '@/hooks/useMenuPosition'

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
  teacher: string
  note: string
  isCourse?: boolean
  shared: boolean
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
  const { startDownload } = useDownload()
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
  const [sharing, setSharing] = useState<SavedLink | null>(null)
  const [savingToDrive, setSavingToDrive] = useState<SavedLink | null>(null)
  const [detailsLink, setDetailsLink] = useState<SavedLink | null>(null)

  function cardAction(link: SavedLink, action: CardAction) {
    if (action === 'open') open(link)
    else if (action === 'info') setDetailsLink(link)
    else if (action === 'download') startCourseDownload(link.id, undefined, startDownload).catch((error) => showSnackbar(errorText(error, vi ? 'Không tải được' : 'Could not download')))
    else if (action === 'save') setSavingToDrive(link)
    else if (action === 'share') setSharing(link)
    else if (action === 'edit') setEditing(link)
    else if (action === 'drive') window.open(link.url, '_blank', 'noopener')
    else if (action === 'remove') remove(link).catch(() => undefined)
  }

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
    return <LessonView link={openLink} vi={vi} onBack={() => open(null)} onEdit={() => setEditing(openLink)} editing={editing} onEdited={(link) => { setLinks((current) => current.map((item) => (item.id === link.id ? link : item))); setEditing(null) }} onCloseEdit={() => setEditing(null)} collections={collections.map(([name]) => name)} accounts={accounts} />
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
            <FolderSync className="h-6 w-6 text-[#0b57d0] dark:text-[#a8c7fa]" />
            {vi ? 'Quản lý Share' : 'Share Management'}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {vi ? 'Quản lý các link Google Drive được chia sẻ: khóa học, thư mục bài giảng, tài liệu học tập hoặc thư mục Drive chia sẻ thông thường.' : 'Manage shared Google Drive links: courses, lesson folders, documents, or standard shared Drive folders.'}
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
            body={vi ? 'HCDrive mở link được chia sẻ qua chính tài khoản Google nhận link. Kết nối tài khoản Google có email người chia sẻ đã cấp quyền.' : 'HCDrive opens shared links through the Google account they were shared with. Connect that account first.'}
            action={<a href="/accounts" className="text-sm font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">{vi ? 'Đến Tài khoản lưu trữ' : 'Go to storage accounts'}</a>}
          />
        ) : null}
        {!loading && accounts.length > 0 && links.length === 0 ? (
          <EmptyState
            title={vi ? 'Thêm liên kết chia sẻ đầu tiên' : 'Add your first shared link'}
            body={vi ? 'Dán link Google Drive được chia sẻ cho email của bạn. Nếu là khóa học sẽ có trình phát bài học và lưu tiến độ, nếu là thư mục thông thường sẽ xem như Drive.' : 'Paste the Drive link shared with your email. Course links feature video lesson playback and progress tracking, while normal folders browse like standard Drive.'}
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
                <LinkCard key={link.id} link={link} vi={vi} onAction={(action) => cardAction(link, action)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <AddLinkModal open={addOpen} vi={vi} accounts={accounts} collections={collections.map(([name]) => name).filter(Boolean)} defaultCollection={activeCollection && activeCollection !== UNGROUPED ? activeCollection : ''} onClose={() => setAddOpen(false)} onAdded={(link) => { setLinks((current) => [...current.filter((item) => item.id !== link.id), link]); setAddOpen(false) }} />
      <SharedPickerModal open={pickerOpen} vi={vi} accounts={accounts} savedIds={new Set(links.map((link) => link.driveFileId))} collections={collections.map(([name]) => name).filter(Boolean)} onClose={() => setPickerOpen(false)} onDone={() => { setPickerOpen(false); load().catch(() => undefined) }} />
      <EditLinkModal link={editing} vi={vi} accounts={accounts} collections={collections.map(([name]) => name).filter(Boolean)} onClose={() => setEditing(null)} onSaved={(link) => { setLinks((current) => current.map((item) => (item.id === link.id ? link : item))); setEditing(null) }} />
      <ShareCourseModal link={sharing} vi={vi} onClose={() => setSharing(null)} onChanged={(id, shared) => setLinks((current) => current.map((item) => (item.id === id ? { ...item, shared } : item)))} />
      <SaveToDriveModal link={savingToDrive} accounts={accounts} vi={vi} onClose={() => setSavingToDrive(null)} />
      <RenameCollectionModal name={renaming} vi={vi} onClose={() => setRenaming(null)} onDone={(from, to) => { setLinks((current) => current.map((link) => (link.collection === from ? { ...link, collection: to } : link))); if (activeCollection === from) setActiveCollection(to || UNGROUPED); setRenaming(null) }} />
      <CourseDetailsModal link={detailsLink} accounts={accounts} vi={vi} onClose={() => setDetailsLink(null)} onAccountChanged={(updated) => { setLinks((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))); setDetailsLink((prev) => prev && prev.id === updated.id ? { ...prev, ...updated } : null) }} />
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

type CardAction = 'open' | 'info' | 'download' | 'save' | 'share' | 'edit' | 'drive' | 'remove'

function LinkCard({ link, vi, onAction }: { link: SavedLink; vi: boolean; onAction: (action: CardAction) => void }) {
  const isCourse = link.isCourse !== false
  const visual = link.isFolder ? { icon: Folder, color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' } : getFileVisual(link.mimeType)
  const Icon = visual.icon
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const owner = link.ownerName || link.ownerEmail

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onAction('open')}
      onKeyDown={(event) => { if (event.key === 'Enter') onAction('open') }}
      onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }) }}
      className="group flex cursor-pointer flex-col rounded-2xl border border-slate-200/80 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-[#0b57d0] dark:border-slate-800 dark:bg-[#1e1f20] dark:hover:border-slate-700"
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', visual.bg)}>
          <Icon className={cn('h-5 w-5', visual.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-5 text-slate-800 dark:text-slate-100" title={link.title}>{link.title}</p>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <span className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
              isCourse
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
            )}>
              {isCourse ? <GraduationCap className="h-3 w-3" /> : <Folder className="h-3 w-3" />}
              {vi ? (isCourse ? 'Khóa học' : 'Thư mục Drive') : (isCourse ? 'Course' : 'Drive folder')}
            </span>
            {link.collection ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {link.collection}
              </span>
            ) : null}
          </div>
          {link.teacher ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{link.teacher}</span>
            </p>
          ) : null}
          {owner ? <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{vi ? 'Chia sẻ bởi' : 'Shared by'} {owner}</p> : null}
          {link.account ? (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <Mail className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="truncate">{vi ? 'Mở bằng:' : 'Account:'} {link.account.email}</span>
            </p>
          ) : null}
        </div>
        {/* Actions live in a menu, so they never cover the course name. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu({ x: rect.right - 224, y: rect.bottom + 4 })
          }}
          className="-mr-1.5 -mt-1 shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-[#282a2c] cursor-pointer"
          title={vi ? 'Tuỳ chọn' : 'Options'}
          aria-label={vi ? 'Tuỳ chọn' : 'Options'}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
      {link.note ? <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{link.note}</p> : null}
      {!link.account ? <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{vi ? 'Tài khoản Google mở link này đã bị gỡ; HCDrive sẽ thử tài khoản khác khi mở.' : 'The Google account for this link was removed; another one is tried on open.'}</p> : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] text-slate-500 dark:text-slate-400">
        {isCourse ? (
          <span className="flex items-center gap-1">
            <CheckCircle2 className={cn('h-3.5 w-3.5', link.completedCount > 0 ? 'text-emerald-600' : 'text-slate-300 dark:text-slate-600')} />
            {vi ? `Đã học ${link.completedCount} bài` : `${link.completedCount} done`}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <Folder className="h-3.5 w-3.5 text-amber-500" />
            {vi ? 'Thư mục chia sẻ' : 'Shared folder'}
          </span>
        )}
        <span className="flex items-center gap-2">
          {link.shared ? <span className="flex items-center gap-0.5 text-[#0b57d0] dark:text-[#a8c7fa]" title={vi ? 'Đang có link chia sẻ' : 'Has a share link'}><Share2 className="h-3 w-3" />{vi ? 'Đã chia sẻ' : 'Shared'}</span> : null}
          <span>{link.lastOpenedAt ? `${vi ? 'Mở' : 'Opened'} ${formatDriveDate(link.lastOpenedAt, vi ? 'vi' : 'en')}` : vi ? 'Chưa mở' : 'Not opened'}</span>
        </span>
      </div>
      {menu ? <CardMenu at={menu} vi={vi} isFolder={link.isFolder} isCourse={isCourse} onClose={() => setMenu(null)} onPick={(action) => { setMenu(null); onAction(action) }} /> : null}
    </div>
  )
}

function CardMenu({ at, vi, isFolder, isCourse = true, onClose, onPick }: { at: { x: number; y: number }; vi: boolean; isFolder: boolean; isCourse?: boolean; onClose: () => void; onPick: (action: CardAction) => void }) {
  const { menuRef, style } = useMenuPosition({ x: at.x, y: at.y, onClose })
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuRef, onClose])

  const items: Array<{ action: CardAction; icon: typeof Folder; label: string; danger?: boolean; dividerBefore?: boolean }> = [
    { action: 'open', icon: isCourse ? PlayCircle : Folder, label: vi ? (isCourse ? 'Mở khóa học' : 'Mở thư mục') : (isCourse ? 'Open course' : 'Open folder') },
    { action: 'download', icon: Download, label: isFolder ? (vi ? 'Tải xuống (ZIP)' : 'Download (ZIP)') : vi ? 'Tải xuống' : 'Download', dividerBefore: true },
    { action: 'save', icon: HardDriveDownload, label: vi ? 'Lưu vào Drive của tôi' : 'Save to my Drive' },
    { action: 'share', icon: Share2, label: vi ? 'Chia sẻ trong HCDrive' : 'Share in HCDrive' },
    { action: 'info', icon: Info, label: vi ? (isCourse ? 'Chi tiết khóa học' : 'Chi tiết thư mục') : (isCourse ? 'Course details' : 'Folder details'), dividerBefore: true },
    { action: 'edit', icon: Pencil, label: vi ? 'Sửa tên, khóa, giảng viên' : 'Edit name, course, teacher' },
    { action: 'drive', icon: ExternalLink, label: vi ? 'Mở trên Google Drive' : 'Open in Google Drive' },
    { action: 'remove', icon: Trash2, label: vi ? 'Xoá khỏi thư viện' : 'Remove from library', danger: true, dividerBefore: true },
  ]

  return createPortal(
    <div ref={menuRef} style={{ ...style, zIndex: 9999 }} role="menu" onClick={(event) => event.stopPropagation()} className="w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-[#2d2e30]">
      {items.map((item) => (
        <div key={item.action}>
          {item.dividerBefore ? <div className="my-1 h-px bg-slate-200 dark:bg-slate-700" /> : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick(item.action)}
            className={cn('flex w-full items-center gap-3 px-4 py-2 text-left text-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-[#3c3d3f]', item.danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200')}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 dark:border-slate-700 dark:bg-[#131314] dark:text-slate-100'

function CollectionInput({ value, onChange, collections, vi }: { value: string; onChange: (value: string) => void; collections: string[]; vi: boolean }) {
  return (
    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
      {vi ? 'Nhóm / Khóa học' : 'Group / Course'}
      <input list="library-collections" value={value} onChange={(event) => onChange(event.target.value)} maxLength={120} placeholder={vi ? 'Ví dụ: Khóa React nâng cao' : 'Advanced React course'} className={cn(inputClass, 'mt-1')} />
      <datalist id="library-collections">
        {collections.map((name) => <option key={name} value={name} />)}
      </datalist>
    </label>
  )
}

function TeacherInput({ value, onChange, vi }: { value: string; onChange: (value: string) => void; vi: boolean }) {
  return (
    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
      {vi ? 'Giáo viên / giảng viên' : 'Teacher / lecturer'}
      <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={200} placeholder={vi ? 'Ví dụ: ThS. Nguyễn Văn A' : 'Dr. Jane Doe'} className={cn(inputClass, 'mt-1')} />
    </label>
  )
}

function AddLinkModal({ open, vi, accounts, collections, defaultCollection, onClose, onAdded }: { open: boolean; vi: boolean; accounts: Array<{ id: string; email: string }>; collections: string[]; defaultCollection: string; onClose: () => void; onAdded: (link: SavedLink) => void }) {
  const { showSnackbar } = useSnackbar()
  const [url, setUrl] = useState('')
  const [collection, setCollection] = useState('')
  const [title, setTitle] = useState('')
  const [teacher, setTeacher] = useState('')
  const [accountId, setAccountId] = useState('')
  const [isCourse, setIsCourse] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setTitle('')
    setTeacher('')
    setAccountId('')
    setIsCourse(true)
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
      const data = await apiFetch<{ link: SavedLink; existed: boolean }>('/library', {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          collection: collection.trim(),
          title: title.trim() || undefined,
          teacher: teacher.trim() || undefined,
          accountId: accountId || undefined,
          isCourse,
        }),
      })
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
        {accounts.length > 0 ? (
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              {vi ? 'Tài khoản Google mở link' : 'Google Drive account'}
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={cn(inputClass, 'mt-1')}
            >
              <option value="">{vi ? 'Tự động phát hiện (thử tất cả tài khoản)' : 'Auto detect (try all connected accounts)'}</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.email}</option>
              ))}
            </select>
          </label>
        ) : null}
        <CollectionInput value={collection} onChange={setCollection} collections={collections} vi={vi} />
        <TeacherInput value={teacher} onChange={setTeacher} vi={vi} />
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          {vi ? 'Tên hiển thị (để trống = tên trên Drive)' : 'Display name (blank = the Drive name)'}
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} className={cn(inputClass, 'mt-1')} />
        </label>

        {/* Course vs. Standard Drive Folder Checkbox */}
        <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-[#1e1f20] dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={isCourse}
            onChange={(e) => setIsCourse(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0b57d0] focus:ring-[#0b57d0] cursor-pointer"
          />
          <div className="flex-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {vi ? 'Đây là khóa học' : 'This is a course'}
            </span>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {vi
                ? 'Giữ bố cục trình phát video bài học và theo dõi tiến độ (bỏ chọn để duyệt như thư mục Drive chia sẻ thông thường).'
                : 'Keep video lesson player layout and progress tracking (uncheck to browse as standard shared Drive folder).'}
            </p>
          </div>
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
  const [isCourse, setIsCourse] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setItems(null)
    setSelected(new Set())
    setQuery('')
    setIsCourse(true)
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
        await apiFetch('/library', { method: 'POST', body: JSON.stringify({ fileId: item.id, accountId: item.accountId, collection: collection.trim(), isCourse }) })
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

        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={isCourse}
            onChange={(e) => setIsCourse(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#0b57d0] focus:ring-[#0b57d0] cursor-pointer"
          />
          <span>{vi ? 'Lưu dưới dạng khóa học (có trình phát bài học và theo dõi tiến độ)' : 'Save as course (with lesson player and progress tracking)'}</span>
        </label>

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

function EditLinkModal({ link, vi, accounts, collections, onClose, onSaved }: { link: SavedLink | null; vi: boolean; accounts: Array<{ id: string; email: string }>; collections: string[]; onClose: () => void; onSaved: (link: SavedLink) => void }) {
  const [title, setTitle] = useState('')
  const [collection, setCollection] = useState('')
  const [teacher, setTeacher] = useState('')
  const [note, setNote] = useState('')
  const [accountId, setAccountId] = useState('')
  const [isCourse, setIsCourse] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!link) return
    setTitle(link.title)
    setCollection(link.collection)
    setTeacher(link.teacher)
    setNote(link.note)
    setAccountId(link.account?.id ?? '')
    setIsCourse(link.isCourse !== false)
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
      const data = await apiFetch<{ link: SavedLink }>(`/library/${link.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          collection: collection.trim(),
          teacher: teacher.trim(),
          note,
          accountId: accountId ? accountId : null,
          isCourse,
        }),
      })
      onSaved(data.link)
    } catch (err) {
      setError(errorText(err, vi ? 'Không lưu được' : 'Could not save'))
    }
  }

  return (
    <DummyModal open={Boolean(link)} onClose={onClose} title={vi ? 'Sửa liên kết' : 'Edit link'}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          {vi ? 'Tên' : 'Name'}
          <input value={title} onChange={(event) => { setTitle(event.target.value); setError('') }} maxLength={300} className={cn(inputClass, 'mt-1')} />
        </label>
        {accounts.length > 0 ? (
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              {vi ? 'Tài khoản Google mở link' : 'Google Drive account'}
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={cn(inputClass, 'mt-1')}
            >
              <option value="">{vi ? 'Tự động phát hiện (thử tất cả tài khoản)' : 'Auto detect (try all connected accounts)'}</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.email}</option>
              ))}
            </select>
          </label>
        ) : null}
        <CollectionInput value={collection} onChange={setCollection} collections={collections} vi={vi} />
        <TeacherInput value={teacher} onChange={setTeacher} vi={vi} />

        {/* Course vs. Standard Drive Folder Checkbox */}
        <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-[#1e1f20] dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={isCourse}
            onChange={(e) => setIsCourse(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0b57d0] focus:ring-[#0b57d0] cursor-pointer"
          />
          <div className="flex-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {vi ? 'Đây là khóa học' : 'This is a course'}
            </span>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {vi
                ? 'Giữ bố cục trình phát video bài học và theo dõi tiến độ (bỏ chọn để duyệt như thư mục Drive chia sẻ thông thường).'
                : 'Keep video lesson player layout and progress tracking (uncheck to browse as standard shared Drive folder).'}
            </p>
          </div>
        </label>

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

function LessonView({ link, vi, onBack, onEdit, editing, onEdited, onCloseEdit, collections, accounts }: { link: SavedLink; vi: boolean; onBack: () => void; onEdit: () => void; editing: SavedLink | null; onEdited: (link: SavedLink) => void; onCloseEdit: () => void; collections: string[]; accounts: Array<{ id: string; email: string }> }) {
  const { showSnackbar } = useSnackbar()
  const { startDownload } = useDownload()
  const isCourse = link.isCourse !== false
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [previewItem, setPreviewItem] = useState<Lesson | null>(null)
  const [path, setPath] = useState<FolderStep[]>([{ id: null, name: link.title, rk: null }])
  const [items, setItems] = useState<Lesson[] | null>(null)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null)
  const [hasCookie, setHasCookie] = useState(false)
  const [cookieOpen, setCookieOpen] = useState(false)
  const [current, setCurrent] = useState<Lesson | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [shared, setShared] = useState(link.shared)
  const folder = path[path.length - 1]

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError('')
    const params = new URLSearchParams()
    if (folder.id) params.set('folderId', folder.id)
    if (folder.rk) params.set('rk', folder.rk)
    apiFetch<{ items: Lesson[]; account: { id: string; email: string }; hasCookie?: boolean }>(`/library/${link.id}/items${params.toString() ? `?${params}` : ''}`)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setAccount(data.account)
        if (data.hasCookie !== undefined) setHasCookie(Boolean(data.hasCookie))
        // A single shared file opens straight away if in course mode.
        if (isCourse && !link.isFolder && data.items[0]) setCurrent(data.items[0])
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, vi ? 'Không mở được link' : 'Could not open the link'))
      })
    return () => {
      cancelled = true
    }
  }, [link.id, link.account?.id, link.isFolder, folder.id, folder.rk, isCourse, vi])

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

  function downloadHere() {
    const target = path.length > 1 ? { folderId: folder.id ?? undefined, rk: folder.rk ?? undefined, name: folder.name } : undefined
    startCourseDownload(link.id, target, startDownload)
      .then(() => showSnackbar(vi ? 'Đang tải xuống… (file ZIP lớn có thể mất một lúc mới bắt đầu)' : 'Downloading… (a large ZIP can take a moment to start)'))
      .catch((err) => showSnackbar(errorText(err, vi ? 'Không tải được' : 'Could not download')))
  }

  function openItem(item: Lesson) {
    if (item.isFolder) {
      setCurrent(null)
      setPath((steps) => [...steps, { id: item.id, name: item.name, rk: item.resourceKey }])
      return
    }
    if (isCourse) {
      setCurrent(item)
    } else {
      setPreviewItem(item)
    }
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
        {link.teacher ? <span className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300"><UserRound className="h-3.5 w-3.5 text-slate-400" />{link.teacher}</span> : null}
        {account ? (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
            title={vi ? 'Nhấn để xem chi tiết / đổi tài khoản Google' : 'Click to view details / change account'}
          >
            <Mail className="h-3 w-3 text-slate-400" />
            <span className="max-w-[150px] truncate">{account.email}</span>
          </button>
        ) : null}
        {!isCourse ? (
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full"
            onClick={() => setViewMode((v) => (v === 'grid' ? 'list' : 'grid'))}
            title={viewMode === 'grid' ? (vi ? 'Chế độ danh sách' : 'List view') : vi ? 'Chế độ lưới' : 'Grid view'}
          >
            {viewMode === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setDetailsOpen(true)} title={isCourse ? (vi ? 'Xem thông tin chi tiết khóa học' : 'Course details') : (vi ? 'Xem thông tin chi tiết thư mục' : 'Folder details')}>
          <Info className="mr-1.5 h-4 w-4" />{vi ? 'Chi tiết' : 'Details'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="mr-1.5 h-4 w-4" />{vi ? 'Sửa' : 'Edit'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)} className={cn(shared && 'text-[#0b57d0] dark:text-[#a8c7fa]')}><Share2 className="mr-1.5 h-4 w-4" />{vi ? 'Chia sẻ' : 'Share'}</Button>
        <Button size="sm" variant="ghost" onClick={downloadHere} title={isCourse ? (path.length > 1 ? (vi ? 'Tải chương đang mở thành file ZIP' : 'Download this chapter as a ZIP') : vi ? 'Tải cả khóa học thành file ZIP' : 'Download the whole course as a ZIP') : (path.length > 1 ? (vi ? 'Tải thư mục đang mở thành file ZIP' : 'Download this folder as a ZIP') : vi ? 'Tải tất cả thành file ZIP' : 'Download all as a ZIP')}>
          <Download className="mr-1.5 h-4 w-4" />{isCourse ? (path.length > 1 ? (vi ? 'Tải chương này' : 'Download chapter') : vi ? 'Tải khóa học' : 'Download course') : (path.length > 1 ? (vi ? 'Tải thư mục này' : 'Download folder') : vi ? 'Tải tất cả (ZIP)' : 'Download all (ZIP)')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSaveOpen(true)}><HardDriveDownload className="mr-1.5 h-4 w-4" />{vi ? 'Lưu vào Drive' : 'Save to Drive'}</Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCookieOpen(true)}
          className={cn(hasCookie && 'text-emerald-700 dark:text-emerald-400 font-medium')}
          title={vi ? 'Cấu hình Cookie Google Drive cho video bảo vệ quyền riêng tư' : 'Configure Google Drive Cookie for protected videos'}
        >
          <Cookie className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">{vi ? 'Cookie Drive' : 'Drive Cookie'}</span>
          {hasCookie && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        </Button>
        <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-full px-3 text-xs text-[#0b57d0] hover:bg-[#0b57d0]/10 dark:text-[#a8c7fa]">
          <ExternalLink className="mr-1.5 h-4 w-4" />Google Drive
        </a>
      </div>

      {isCourse ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:px-6 xl:flex-row xl:overflow-hidden">
          {current ? (
            <div className="min-w-0 xl:flex-1 xl:overflow-y-auto">
              <LessonPlayer
                key={current.id}
                lesson={current}
                vi={vi}
                accountEmail={account?.email}
                hasCookie={hasCookie}
                onConfigureCookie={() => setCookieOpen(true)}
                onPosition={(seconds) => saveProgress(current.id, { positionSeconds: seconds })}
                onEnded={() => saveProgress(current.id, { completed: true })}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-base font-medium text-slate-800 dark:text-slate-100" title={current.name}>{current.name}</h2>
                <Button size="sm" variant={items?.find((item) => item.id === current.id)?.completed ? 'tonal' : 'outline'} onClick={() => saveProgress(current.id, { completed: !items?.find((item) => item.id === current.id)?.completed })}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  {items?.find((item) => item.id === current.id)?.completed ? (vi ? 'Đã học' : 'Done') : vi ? 'Đánh dấu đã học' : 'Mark as done'}
                </Button>
                {current.canDownload && current.streamUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      startDownload(lessonDownloadUrl(current.streamUrl!, current.name), current.name, { auth: false })
                    }}
                    className="inline-flex h-8 items-center rounded-full border border-[#747775]/60 px-3.5 text-xs text-slate-800 hover:bg-[#f0f4f9] dark:border-[#8e918f]/60 dark:text-slate-100 dark:hover:bg-[#282a2c] cursor-pointer"
                  >
                    <Download className="mr-1.5 h-4 w-4" />{vi ? 'Tải bài này' : 'Download'}
                  </button>
                ) : null}
                <a
                  href={current.webViewLink ? (account?.email ? `${current.webViewLink}${current.webViewLink.includes('?') ? '&' : '?'}authuser=${encodeURIComponent(account.email)}` : current.webViewLink) : `https://drive.google.com/file/d/${current.id}/view${account?.email ? `?authuser=${encodeURIComponent(account.email)}` : ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-full border border-[#747775]/60 px-3.5 text-xs font-medium text-[#0b57d0] hover:bg-[#0b57d0]/10 dark:border-[#8e918f]/60 dark:text-[#a8c7fa] cursor-pointer"
                  title={vi ? 'Mở bài học này trong tab mới trên Google Drive' : 'Open this lesson in a new tab on Google Drive'}
                >
                  <ExternalLink className="mr-1.5 h-4 w-4" />{vi ? 'Xem trên Google Drive' : 'Drive'}
                </a>
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
      ) : (
        /* Standard Drive Folder Explorer View */
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:px-6">
          {error ? <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
          {!error && items === null ? <CenteredSpinner /> : null}
          {items !== null ? (
            <>
              {link.note && path.length === 1 ? (
                <p className="mb-4 whitespace-pre-wrap rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-[#1e1f20] dark:text-slate-300">
                  {link.note}
                </p>
              ) : null}
              {items.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-slate-400">
                  <Folder className="h-16 w-16 stroke-1 text-slate-300 dark:text-slate-700" />
                  <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">
                    {vi ? 'Thư mục này trống.' : 'This folder is empty.'}
                  </p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="space-y-6">
                  {/* Folders */}
                  {items.filter((i) => i.isFolder).length > 0 && (
                    <div>
                      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {vi ? 'Thư mục' : 'Folders'} ({items.filter((i) => i.isFolder).length})
                      </h3>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {items.filter((i) => i.isFolder).map((folderItem) => (
                          <div
                            key={folderItem.id}
                            onClick={() => openItem(folderItem)}
                            className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#1e1f20] dark:hover:bg-[#282a2c] cursor-pointer transition shadow-xs"
                          >
                            <Folder className="h-5 w-5 shrink-0 text-slate-500 group-hover:text-[#0b57d0] dark:group-hover:text-[#a8c7fa] transition-colors" />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 dark:text-slate-200" title={folderItem.name}>
                              {folderItem.name}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Files */}
                  {items.filter((i) => !i.isFolder).length > 0 && (
                    <div>
                      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {vi ? 'Tệp' : 'Files'} ({items.filter((i) => !i.isFolder).length})
                      </h3>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {items.filter((i) => !i.isFolder).map((fileItem) => {
                          const visual = getFileVisual(fileItem.mimeType)
                          const Icon = visual.icon
                          const isImg = fileItem.mimeType.startsWith('image/')
                          return (
                            <div
                              key={fileItem.id}
                              onClick={() => setPreviewItem(fileItem)}
                              className="group flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60 dark:border-slate-800 dark:bg-[#1e1f20] dark:hover:bg-[#282a2c] cursor-pointer transition shadow-xs"
                            >
                              <div className="relative flex h-28 items-center justify-center bg-slate-50/80 dark:bg-[#131314] overflow-hidden p-2">
                                {isImg && fileItem.streamUrl ? (
                                  <img
                                    src={`${API_URL}${fileItem.streamUrl}`}
                                    alt={fileItem.name}
                                    className="h-full w-full object-cover rounded-md"
                                    loading="lazy"
                                  />
                                ) : (
                                  <Icon className={cn('h-10 w-10', visual.color)} />
                                )}
                                {fileItem.streamUrl ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      startDownload(lessonDownloadUrl(fileItem.streamUrl!, fileItem.name), fileItem.name, { auth: false })
                                    }}
                                    className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-slate-600 shadow-sm opacity-0 group-hover:opacity-100 hover:bg-white hover:text-[#0b57d0] dark:bg-[#1e1f20]/90 dark:text-slate-300 dark:hover:bg-[#282a2c] transition cursor-pointer"
                                    title={vi ? 'Tải tệp này' : 'Download file'}
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2 border-t border-slate-100 p-2.5 dark:border-slate-800/80">
                                <Icon className={cn('h-4 w-4 shrink-0', visual.color)} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200" title={fileItem.name}>
                                    {fileItem.name}
                                  </p>
                                  <p className="mt-0.5 text-[10px] text-slate-400">
                                    {fileItem.size ? formatBytes(fileItem.size) : fileItem.durationSeconds ? formatDuration(fileItem.durationSeconds) : '--'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* List View */
                <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#1e1f20]">
                  <table className="w-full min-w-[650px] text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-200/80 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="py-3 pl-4 min-w-[250px]">{vi ? 'Tên' : 'Name'}</th>
                        <th className="py-3">{vi ? 'Loại' : 'Type'}</th>
                        <th className="py-3">{vi ? 'Kích thước' : 'Size'}</th>
                        <th className="py-3 pr-4 text-right w-28">{vi ? 'Thao tác' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {items.map((item) => {
                        const visual = item.isFolder ? { icon: Folder, color: 'text-slate-500' } : getFileVisual(item.mimeType)
                        const Icon = visual.icon
                        return (
                          <tr
                            key={item.id}
                            onClick={() => (item.isFolder ? openItem(item) : setPreviewItem(item))}
                            className="group h-11 cursor-pointer transition hover:bg-slate-50 dark:hover:bg-[#282a2c]/60"
                          >
                            <td className="py-2 pl-4 pr-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Icon className={cn('h-4 w-4 shrink-0', visual.color)} />
                                <span className="truncate font-medium text-xs text-slate-800 dark:text-slate-200" title={item.name}>
                                  {item.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-2 text-xs text-slate-500 dark:text-slate-400">
                              {item.isFolder ? (vi ? 'Thư mục' : 'Folder') : (item.mimeType.split('/')[1] || item.mimeType)}
                            </td>
                            <td className="py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {item.isFolder ? '--' : item.size ? formatBytes(item.size) : item.durationSeconds ? formatDuration(item.durationSeconds) : '--'}
                            </td>
                            <td className="py-2 pr-4 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {item.isFolder ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); openItem(item) }}
                                    className="p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#282a2c]"
                                    title={vi ? 'Mở thư mục' : 'Open folder'}
                                  >
                                    <ChevronRight className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setPreviewItem(item) }}
                                      className="p-1 rounded-full text-slate-400 hover:text-[#0b57d0] hover:bg-slate-100 dark:hover:bg-[#282a2c]"
                                      title={vi ? 'Xem trước' : 'Preview'}
                                    >
                                      <Eye className="h-4 w-4" />
                                    </button>
                                    {item.streamUrl ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          startDownload(lessonDownloadUrl(item.streamUrl!, item.name), item.name, { auth: false })
                                        }}
                                        className="p-1 rounded-full text-slate-400 hover:text-[#0b57d0] hover:bg-slate-100 dark:hover:bg-[#282a2c] cursor-pointer"
                                        title={vi ? 'Tải tệp' : 'Download'}
                                      >
                                        <Download className="h-4 w-4" />
                                      </button>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      <EditLinkModal link={editing} vi={vi} accounts={accounts} collections={collections.filter(Boolean)} onClose={onCloseEdit} onSaved={onEdited} />
      <ShareCourseModal link={shareOpen ? { ...link, shared } : null} vi={vi} onClose={() => setShareOpen(false)} onChanged={(_id, value) => setShared(value)} />
      <SaveToDriveModal link={saveOpen ? link : null} accounts={accounts} vi={vi} onClose={() => setSaveOpen(false)} />
      <CourseDetailsModal
        link={detailsOpen ? link : null}
        accounts={accounts}
        vi={vi}
        onClose={() => setDetailsOpen(false)}
        onAccountChanged={(updated) => {
          onEdited(updated as SavedLink)
          setAccount(updated.account)
        }}
      />
      {cookieOpen && (
        <DriveCookieModal
          linkId={link.id}
          accountId={account?.id}
          accountEmail={account?.email}
          hasCookie={hasCookie}
          vi={vi}
          onClose={() => setCookieOpen(false)}
          onSaved={(newHasCookie) => {
            setHasCookie(newHasCookie)
            if (current) {
              const c = current
              setCurrent(null)
              setTimeout(() => setCurrent(c), 50)
            }
          }}
        />
      )}
      <FolderFilePreviewModal
        file={previewItem}
        files={items ? items.filter((i) => !i.isFolder) : []}
        vi={vi}
        onClose={() => setPreviewItem(null)}
        onNavigate={(next) => setPreviewItem(next)}
      />
    </div>
  )
}

export function FolderFilePreviewModal({
  file,
  files,
  vi,
  allowDownload = true,
  onClose,
  onNavigate,
}: {
  file: Lesson | null
  files: Lesson[]
  vi: boolean
  allowDownload?: boolean
  onClose: () => void
  onNavigate: (file: Lesson) => void
}) {
  if (!file) return null
  const { startDownload } = useDownload()
  const [useGooglePreview, setUseGooglePreview] = useState(false)
  useEffect(() => {
    setUseGooglePreview(false)
  }, [file.id])

  const currentIndex = files.findIndex((f) => f.id === file.id)
  const prevFile = currentIndex > 0 ? files[currentIndex - 1] : null
  const nextFile = currentIndex >= 0 && currentIndex < files.length - 1 ? files[currentIndex + 1] : null
  const visual = getFileVisual(file.mimeType)
  const Icon = visual.icon
  const src = file.streamUrl ? `${API_URL}${file.streamUrl}` : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative flex h-full max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-[#1e1f20] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon className={cn('h-5 w-5 shrink-0', visual.color)} />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={file.name}>
                {file.name}
              </h2>
              <p className="text-[11px] text-slate-400">
                {file.size ? formatBytes(file.size) : file.durationSeconds ? formatDuration(file.durationSeconds) : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {file.previewUrl && file.mimeType.startsWith('video/') && (
              <button
                type="button"
                onClick={() => setUseGooglePreview(!useGooglePreview)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                title={useGooglePreview ? (vi ? 'Chuyển sang Trình phát HCDrive' : 'Switch to HCDrive Player') : (vi ? 'Chuyển sang Trình phát Google Drive' : 'Switch to Google Drive Player')}
              >
                <RefreshCw className="h-3.5 w-3.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
                <span className="hidden sm:inline">{useGooglePreview ? 'HCDrive Player' : 'Google Player'}</span>
              </button>
            )}
            {allowDownload && file.streamUrl ? (
              <button
                type="button"
                onClick={() => startDownload(lessonDownloadUrl(file.streamUrl!, file.name), file.name, { auth: false })}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
                <span className="hidden sm:inline">{vi ? 'Tải xuống' : 'Download'}</span>
              </button>
            ) : null}
            {file.webViewLink ? (
              <a
                href={file.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                title={vi ? 'Mở trong tab mới' : 'Open in new tab'}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
              aria-label={vi ? 'Đóng' : 'Close'}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Viewer */}
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 bg-slate-950/5 dark:bg-black/40 overflow-hidden relative">
          {prevFile ? (
            <button
              type="button"
              onClick={() => onNavigate(prevFile)}
              className="absolute left-3 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/70 backdrop-blur-xs transition cursor-pointer"
              title={vi ? 'Tệp trước' : 'Previous file'}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {nextFile ? (
            <button
              type="button"
              onClick={() => onNavigate(nextFile)}
              className="absolute right-3 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/70 backdrop-blur-xs transition cursor-pointer"
              title={vi ? 'Tệp tiếp theo' : 'Next file'}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}

          <div className="flex h-full w-full items-center justify-center overflow-auto">
            {src && file.mimeType.startsWith('video/') && !useGooglePreview ? (
              <div className="flex flex-col items-center w-full max-h-[75vh]">
                <StreamProgressBar streamUrl={file.streamUrl || src} className="w-full mb-2" />
                <video
                  controls
                  autoPlay
                  src={src}
                  onError={() => {
                    if (file.previewUrl) setUseGooglePreview(true)
                  }}
                  className="max-h-[70vh] w-full rounded-xl bg-black shadow-md"
                />
              </div>
            ) : file.mimeType.startsWith('video/') && file.previewUrl ? (
              <iframe
                src={file.previewUrl}
                title={file.name}
                allow="autoplay; fullscreen"
                allowFullScreen
                className="h-full w-full rounded-xl border border-slate-200 bg-black shadow-md dark:border-slate-800"
              />
            ) : src && file.mimeType.startsWith('audio/') ? (
              <audio controls autoPlay src={src} className="w-full max-w-xl" />
            ) : src && file.mimeType.startsWith('image/') ? (
              <img src={src} alt={file.name} className="max-h-[75vh] max-w-full object-contain rounded-xl" />
            ) : src && file.mimeType === 'application/pdf' ? (
              <iframe src={src} title={file.name} className="h-full w-full rounded-xl border border-slate-200 dark:border-slate-800" />
            ) : file.previewUrl ? (
              <iframe src={file.previewUrl} title={file.name} allow="autoplay; fullscreen" allowFullScreen className="h-full w-full rounded-xl border border-slate-200 bg-black dark:border-slate-800" />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-[#1e1f20] dark:text-slate-300">
                <Icon className={cn('mx-auto h-12 w-12 mb-3', visual.color)} />
                <p>{vi ? 'Trình duyệt không xem trực tiếp được loại tệp này.' : 'This file type cannot be previewed directly.'}</p>
                {allowDownload && src ? (
                  <button
                    type="button"
                    onClick={() => startDownload(lessonDownloadUrl(src, file.name), file.name, { auth: false })}
                    className="mt-3 inline-block font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa] cursor-pointer"
                  >
                    {vi ? 'Tải tệp xuống' : 'Download file'}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LessonPlayer({
  lesson,
  vi,
  accountEmail,
  hasCookie,
  onConfigureCookie,
  onPosition,
  onEnded,
}: {
  lesson: Lesson
  vi: boolean
  accountEmail?: string
  hasCookie?: boolean
  onConfigureCookie?: () => void
  onPosition: (seconds: number) => void
  onEnded: () => void
}) {
  const [playerMode, setPlayerMode] = useState<'hcdrive' | 'google'>('hcdrive')
  const [videoError, setVideoError] = useState(false)
  const lastSaved = useRef(lesson.positionSeconds)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const onPositionRef = useRef(onPosition)
  onPositionRef.current = onPosition
  const src = lesson.streamUrl ? `${API_URL}${lesson.streamUrl}` : null

  const authedViewUrl = useMemo(() => {
    const base = lesson.webViewLink || `https://drive.google.com/file/d/${lesson.id}/view`
    if (!accountEmail) return base
    try {
      const url = new URL(base)
      url.searchParams.set('authuser', accountEmail)
      return url.toString()
    } catch {
      return `${base}${base.includes('?') ? '&' : '?'}authuser=${encodeURIComponent(accountEmail)}`
    }
  }, [lesson.webViewLink, lesson.id, accountEmail])

  const authedPreviewUrl = useMemo(() => {
    const base = lesson.previewUrl || `https://drive.google.com/file/d/${lesson.id}/preview`
    if (!accountEmail) return base
    try {
      const url = new URL(base)
      url.searchParams.set('authuser', accountEmail)
      return url.toString()
    } catch {
      return `${base}${base.includes('?') ? '&' : '?'}authuser=${encodeURIComponent(accountEmail)}`
    }
  }, [lesson.previewUrl, lesson.id, accountEmail])

  // Leaving the lesson keeps where it stopped (the component is keyed by lesson, so this runs on switch).
  useEffect(() => () => {
    const time = Math.floor(mediaRef.current?.currentTime ?? 0)
    if (time > 0 && Math.abs(time - lastSaved.current) >= 2) onPositionRef.current(time)
  }, [])

  useEffect(() => {
    setPlayerMode('hcdrive')
    setVideoError(false)
  }, [lesson.id])

  const [isBuffering, setIsBuffering] = useState(false)

  const mediaProps = {
    controls: true,
    autoPlay: true,
    src: src ?? undefined,
    onWaiting: () => setIsBuffering(true),
    onPlaying: () => setIsBuffering(false),
    onLoadedData: () => setIsBuffering(false),
    onError: () => {
      setIsBuffering(false)
      setVideoError(true)
    },
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

  if (lesson.mimeType.startsWith('video/')) {
    if (playerMode === 'google' || (!src && lesson.previewUrl)) {
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              {vi ? 'Khung nhúng Google Drive' : 'Google Drive Embedded Player'}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={authedViewUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-[#0b57d0] hover:bg-blue-50 dark:text-[#a8c7fa] dark:hover:bg-blue-950/40 transition cursor-pointer"
                title={vi ? 'Mở trong tab mới nếu khung nhúng bị chặn quyền hoặc yêu cầu đăng nhập' : 'Open in new tab if embed is blocked or asks to sign in'}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {vi ? 'Mở tab mới trên Google Drive' : 'Open in new tab on Drive'}
              </a>
              {src && (
                <button
                  type="button"
                  onClick={() => { setVideoError(false); setPlayerMode('hcdrive') }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  {vi ? 'Dùng Trình phát HCDrive' : 'Use HCDrive Player'}
                </button>
              )}
            </div>
          </div>
          <iframe
            src={authedPreviewUrl || undefined}
            title={lesson.name}
            allow="autoplay; fullscreen"
            allowFullScreen
            className="aspect-video w-full rounded-xl border border-slate-200 bg-black shadow-md dark:border-slate-800"
          />
        </div>
      )
    }

    if (src && !videoError) {
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              {vi ? 'Trình phát HCDrive' : 'HCDrive Player'}
              {isBuffering && (
                <span className="text-[11px] text-amber-500 animate-pulse">
                  ({vi ? 'Đang chuẩn bị stream...' : 'Buffering stream...'})
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {onConfigureCookie && (
                <button
                  type="button"
                  onClick={onConfigureCookie}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition cursor-pointer',
                    hasCookie
                      ? 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  )}
                  title={vi ? 'Cấu hình Cookie Google Drive cho video bảo vệ riêng tư' : 'Configure Google Drive Cookie for protected videos'}
                >
                  <Cookie className="h-3 w-3" />
                  <span>{vi ? 'Cookie' : 'Cookie'}</span>
                  {hasCookie && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </button>
              )}
              <a
                href={authedViewUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[#0b57d0] hover:bg-blue-50 dark:text-[#a8c7fa] dark:hover:bg-blue-950/40 transition cursor-pointer"
                title={vi ? 'Mở trực tiếp trên Google Drive' : 'Open directly on Google Drive'}
              >
                <ExternalLink className="h-3 w-3" />
                {vi ? 'Xem trên Google Drive' : 'Watch on Google Drive'}
              </a>
              <button
                type="button"
                onClick={() => setPlayerMode('google')}
                className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition cursor-pointer"
                title={vi ? 'Chuyển sang Google Player nếu bạn đã đăng nhập đúng email Google được share' : 'Switch to Google Player if signed into authorized Google account'}
              >
                <RefreshCw className="h-3 w-3" />
                {vi ? 'Đổi sang Trình phát Google' : 'Switch to Google Player'}
              </button>
            </div>
          </div>
          <video ref={(node) => { mediaRef.current = node }} {...mediaProps} className="aspect-video w-full rounded-xl bg-black shadow-md" />
          <StreamProgressBar streamUrl={lesson.streamUrl} isBuffering={isBuffering} vi={vi} />
        </div>
      )
    }

    // Video error with fallback
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 text-center text-sm text-slate-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-slate-200">
        <StreamProgressBar streamUrl={lesson.streamUrl} isBuffering={false} vi={vi} className="mb-4" />
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
          <ExternalLink className="h-6 w-6" />
        </div>
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          {vi ? 'Video được bảo vệ quyền xem riêng tư trên Google Drive' : 'Video Protected with View-only Rights on Google Drive'}
        </p>
        <p className="mt-1.5 max-w-lg mx-auto text-xs text-slate-600 dark:text-slate-300">
          {vi
            ? 'Chủ sở hữu khóa học đã khóa quyền tải xuống & sao chép đối với người xem. Trình duyệt cũng chặn cookie đăng nhập Google trong khung nhúng (iframe) nên không thể phát video trực tiếp tại đây.'
            : 'The course owner has disabled download and copy permissions. Web browsers also block Google authentication cookies in embedded iframes.'}
        </p>
        <p className="mt-1 text-xs font-medium text-[#0b57d0] dark:text-[#a8c7fa]">
          {accountEmail
            ? (vi ? `Tài khoản Google có quyền xem: ${accountEmail}` : `Authorized Google account: ${accountEmail}`)
            : (vi ? 'Vui lòng mở bằng tài khoản Google đã được cấp quyền truy cập.' : 'Please open with the authorized Google account.')}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {onConfigureCookie && (
            <button
              type="button"
              onClick={onConfigureCookie}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0b57d0] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0b57d0]/90 transition cursor-pointer"
            >
              <Cookie className="h-4 w-4" />
              <span>
                {hasCookie
                  ? (vi ? 'Cập nhật Cookie Google Drive' : 'Update Google Drive Cookie')
                  : (vi ? 'Cấu hình Cookie Google Drive để phát trực tiếp' : 'Configure Google Drive Cookie for Direct Stream')}
              </span>
            </button>
          )}

          <a
            href={authedViewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1e1f20] dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <ExternalLink className="h-4 w-4" />
            {vi ? 'Mở xem trực tiếp trên Google Drive' : 'Open & Watch on Google Drive'}
          </a>

          <button
            type="button"
            onClick={() => { setVideoError(false); setPlayerMode('google') }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1e1f20] dark:text-slate-300 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {vi ? 'Xem thử trong khung nhúng (iFrame)' : 'Try embedded Google iFrame'}
          </button>

          <button
            type="button"
            onClick={() => {
              setVideoError(false)
              setPlayerMode('hcdrive')
              if (mediaRef.current) mediaRef.current.load()
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1e1f20] dark:text-slate-300 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {vi ? 'Thử lại phát HCDrive' : 'Retry HCDrive Stream'}
          </button>
        </div>
      </div>
    )
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
  // Google Docs viewer, signed in as the account the link was shared with.
  return (
    <div>
      {lesson.previewUrl ? <iframe src={lesson.previewUrl} title={lesson.name} allow="autoplay; fullscreen" allowFullScreen className="aspect-video w-full rounded-xl border border-slate-200 bg-black dark:border-slate-800" /> : null}
      {lesson.webViewLink ? (
        <a href={lesson.webViewLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">
          <ExternalLink className="h-3.5 w-3.5" />{vi ? 'Mở trong tab mới' : 'Open in a new tab'}
        </a>
      ) : null}
    </div>
  )
}
