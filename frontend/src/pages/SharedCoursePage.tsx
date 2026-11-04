import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  Folder,
  GraduationCap,
  Grid,
  HardDriveDownload,
  List,
  Loader2,
  LogIn,
  PlayCircle,
  Plus,
  SkipForward,
  UserRound,
} from 'lucide-react'
import { apiFetch, API_URL, formatBytes } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { lessonDownloadUrl, startSharedCourseDownload } from '@/components/drive/LibraryDialogs'
import { FolderFilePreviewModal } from '@/pages/LibraryPage'

type SharedCourseInfo = {
  course: {
    id: string
    title: string
    teacher: string
    collection: string
    mimeType: string
    isFolder: boolean
    url: string
    ownerName: string | null
    ownerEmail: string | null
    sharedBy: string
    allowDownload: boolean
    isCourse?: boolean
  }
  savedLinkId: string | null
  isLoggedIn: boolean
  access: { ok: boolean; accountEmail: string | null }
  accountEmails: string[]
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

type FolderStep = { id: string | null; name: string; rk: string | null }

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

export function SharedCoursePage() {
  const { token = '' } = useParams()
  const { lang } = useLanguage()
  const vi = lang === 'vi'
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()

  const [data, setData] = useState<SharedCourseInfo | null>(null)
  const [error, setError] = useState('')
  const [path, setPath] = useState<FolderStep[]>([{ id: null, name: '', rk: null }])
  const [items, setItems] = useState<Lesson[] | null>(null)
  const [itemsError, setItemsError] = useState('')
  const [current, setCurrent] = useState<Lesson | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [collection, setCollection] = useState('')
  const [saving, setSaving] = useState(false)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [previewItem, setPreviewItem] = useState<Lesson | null>(null)

  const folder = path[path.length - 1]

  // Fetch course metadata
  useEffect(() => {
    let cancelled = false
    apiFetch<SharedCourseInfo>(`/library/shared/${encodeURIComponent(token)}`)
      .then((result) => {
        if (cancelled) return
        setData(result)
        setCollection(result.course.collection || '')
        setPath([{ id: null, name: result.course.title, rk: null }])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : vi ? 'Không mở được link chia sẻ' : 'Could not open share link')
      })
    return () => {
      cancelled = true
    }
  }, [token, vi])

  // Fetch items for the active folder
  useEffect(() => {
    if (!data) return
    let cancelled = false
    setItems(null)
    setItemsError('')
    const params = new URLSearchParams()
    if (folder.id) params.set('folderId', folder.id)
    if (folder.rk) params.set('rk', folder.rk)

    apiFetch<{ items: Lesson[]; allowDownload: boolean }>(`/library/shared/${encodeURIComponent(token)}/items${params.toString() ? `?${params}` : ''}`)
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        // If it's a course single file, auto-select it
        if (data.course.isCourse !== false && !data.course.isFolder && res.items[0]) {
          setCurrent(res.items[0])
        }
      })
      .catch((err) => {
        if (!cancelled) setItemsError(errorText(err, vi ? 'Không tải được danh sách bài học' : 'Could not load lessons'))
      })

    return () => {
      cancelled = true
    }
  }, [data, token, folder.id, folder.rk, vi])

  const lessons = (items ?? []).filter((item) => !item.isFolder)
  const nextLesson = current ? lessons[lessons.findIndex((item) => item.id === current.id) + 1] ?? null : null

  function openItem(item: Lesson) {
    if (item.isFolder) {
      setCurrent(null)
      setPath((steps) => [...steps, { id: item.id, name: item.name, rk: item.resourceKey }])
      return
    }
    if (data?.course.isCourse === false) {
      setPreviewItem(item)
    } else {
      setCurrent(item)
    }
  }

  function downloadZip() {
    if (!data?.course.allowDownload) return
    setDownloadingZip(true)
    const target = path.length > 1 ? { folderId: folder.id ?? undefined, rk: folder.rk ?? undefined, name: folder.name } : undefined
    startSharedCourseDownload(token, target)
      .then(() => showSnackbar(vi ? 'Đang chuẩn bị tải xuống file ZIP…' : 'Preparing ZIP download…'))
      .catch((err) => showSnackbar(errorText(err, vi ? 'Không tải được file ZIP' : 'Could not download ZIP')))
      .finally(() => setDownloadingZip(false))
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    if (!data?.isLoggedIn) {
      navigate(`/login?returnTo=/library/s/${encodeURIComponent(token)}`)
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch<{ link: { id: string }; existed: boolean }>(`/library/shared/${encodeURIComponent(token)}/save`, {
        method: 'POST',
        body: JSON.stringify({ collection: collection.trim() }),
      })
      setData((prev) => (prev ? { ...prev, savedLinkId: res.link.id } : null))
      setSaveOpen(false)
      showSnackbar(res.existed ? (vi ? 'Đã có trong danh sách của bạn' : 'Already in your list') : (vi ? 'Đã lưu thành công' : 'Saved successfully'))
    } catch (err) {
      showSnackbar(errorText(err, vi ? 'Không lưu được' : 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/40 dark:bg-red-950/20">
          <h2 className="text-base font-semibold text-red-800 dark:text-red-300">{vi ? 'Không thể mở liên kết chia sẻ' : 'Cannot open share link'}</h2>
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/')}>
            {vi ? 'Về trang chủ' : 'Go home'}
          </Button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#0b57d0]" />
      </div>
    )
  }

  const { course } = data
  const isCourse = course.isCourse !== false

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900 dark:bg-[#131314] dark:text-slate-100">
      {/* Top Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#c2e7ff]/60 dark:bg-[#004a77]">
            {isCourse ? (
              <GraduationCap className="h-4.5 w-4.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
            ) : (
              <Folder className="h-4.5 w-4.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{course.title}</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                  isCourse
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
                )}
              >
                {isCourse ? (vi ? 'Khóa học' : 'Course') : (vi ? 'Thư mục Drive' : 'Drive folder')}
              </span>
              {course.collection ? (
                <span className="hidden rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:inline">
                  {course.collection}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              {course.teacher ? (
                <span className="flex items-center gap-1">
                  <UserRound className="h-3 w-3 text-slate-400" />
                  {course.teacher}
                </span>
              ) : null}
              <span>{vi ? `Chia sẻ bởi: ${course.sharedBy}` : `Shared by: ${course.sharedBy}`}</span>
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          {course.allowDownload ? (
            <Button
              size="sm"
              variant="outline"
              disabled={downloadingZip}
              onClick={downloadZip}
              title={
                path.length > 1
                  ? vi
                    ? 'Tải thư mục đang mở thành ZIP'
                    : 'Download folder as ZIP'
                  : isCourse
                    ? vi
                      ? 'Tải toàn bộ khóa học (ZIP)'
                      : 'Download whole course (ZIP)'
                    : vi
                      ? 'Tải toàn bộ thư mục (ZIP)'
                      : 'Download whole folder (ZIP)'
              }
              className="gap-1.5 text-xs"
            >
              {downloadingZip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-[#0b57d0] dark:text-[#a8c7fa]" />}
              <span className="hidden sm:inline">
                {path.length > 1
                  ? vi
                    ? 'Tải mục này (ZIP)'
                    : 'Folder ZIP'
                  : isCourse
                    ? vi
                      ? 'Tải khóa học (ZIP)'
                      : 'Course ZIP'
                    : vi
                      ? 'Tải ZIP'
                      : 'Download ZIP'}
              </span>
            </Button>
          ) : null}

          {data.savedLinkId ? (
            <Button size="sm" variant="tonal" onClick={() => navigate(`/library?link=${data.savedLinkId}`)} className="gap-1.5 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span className="hidden sm:inline">{vi ? 'Đã lưu trong Quản lý Share' : 'Saved in Share Management'}</span>
            </Button>
          ) : (
            <Button size="sm" onClick={() => setSaveOpen(true)} className="gap-1.5 text-xs">
              {data.isLoggedIn ? <Plus className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
              <span>{data.isLoggedIn ? (isCourse ? (vi ? 'Lưu khóa học' : 'Save course') : (vi ? 'Lưu vào Drive' : 'Save to Drive')) : vi ? 'Đăng nhập để lưu' : 'Log in to save'}</span>
            </Button>
          )}

          <a
            href={course.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title={vi ? 'Mở trên Google Drive' : 'Open in Google Drive'}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* Main Content */}
      {isCourse ? (
        /* Course Layout: Player (left) & Curriculum (right) */
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row overflow-hidden">
          {/* Left: Player / Lesson Viewer */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
            {current ? (
              <div className="mx-auto w-full max-w-4xl space-y-4">
                <SharedLessonPlayer key={current.id} lesson={current} vi={vi} />

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-800">
                  <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{current.name}</h1>
                    <p className="mt-1 text-xs text-slate-500">
                      {current.durationSeconds ? `${vi ? 'Thời lượng' : 'Duration'}: ${formatDuration(current.durationSeconds)}` : ''}
                      {current.durationSeconds && current.size ? ' • ' : ''}
                      {current.size ? formatBytes(current.size) : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {course.allowDownload && current.streamUrl ? (
                      <a
                        href={lessonDownloadUrl(current.streamUrl, current.name)}
                        className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Download className="h-3.5 w-3.5 text-[#0b57d0] dark:text-[#a8c7fa]" />
                        <span>{vi ? 'Tải bài này' : 'Download lesson'}</span>
                      </a>
                    ) : null}

                    {nextLesson ? (
                      <Button size="sm" onClick={() => setCurrent(nextLesson)} className="gap-1.5">
                        <span>{vi ? 'Bài tiếp theo' : 'Next lesson'}</span>
                        <SkipForward className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#c2e7ff]/40 dark:bg-[#004a77]/40">
                  <GraduationCap className="h-8 w-8 text-[#0b57d0] dark:text-[#a8c7fa]" />
                </div>
                <h2 className="mt-4 text-xl font-semibold text-slate-900 dark:text-slate-100">{course.title}</h2>
                {course.teacher ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{vi ? 'Giảng viên' : 'Teacher'}: {course.teacher}</p> : null}
                <p className="mt-2 text-xs text-slate-500 max-w-md">
                  {vi
                    ? 'Chọn một bài học từ danh sách bài giảng bên phải để bắt đầu xem trực tuyến.'
                    : 'Select a lesson from the list on the right to start watching.'}
                </p>
                {lessons.length > 0 ? (
                  <Button className="mt-6 gap-2" onClick={() => setCurrent(lessons[0])}>
                    <PlayCircle className="h-4 w-4" />
                    {vi ? 'Bắt đầu học bài đầu tiên' : 'Start first lesson'}
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          {/* Right: Chapter & Lesson List */}
          <aside className="flex flex-col border-t border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-[#1a1b1d] xl:w-[380px] xl:border-t-0 xl:border-l shrink-0">
            {/* Breadcrumb path navigation */}
            <div className="flex items-center gap-1 border-b border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
              {path.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(null)
                    setPath((steps) => steps.slice(0, steps.length - 1))
                  }}
                  className="mr-1 rounded-md p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  title={vi ? 'Lên một cấp' : 'Up one level'}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
                {path.map((step, idx) => (
                  <span key={`${step.id ?? 'root'}-${idx}`} className="flex shrink-0 items-center gap-1">
                    {idx > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : null}
                    <button
                      type="button"
                      disabled={idx === path.length - 1}
                      onClick={() => {
                        setCurrent(null)
                        setPath((steps) => steps.slice(0, idx + 1))
                      }}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs truncate max-w-[140px]',
                        idx === path.length - 1
                          ? 'font-semibold text-slate-900 dark:text-slate-100'
                          : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer',
                      )}
                    >
                      {step.name}
                    </button>
                  </span>
                ))}
              </nav>
              <span className="shrink-0 text-[11px] text-slate-400">{items ? `${lessons.length} ${vi ? 'bài' : 'lessons'}` : ''}</span>
            </div>

            {/* Lessons list */}
            <div className="flex-1 overflow-y-auto p-2">
              {itemsError ? <p className="p-4 text-xs text-red-600 dark:text-red-400">{itemsError}</p> : null}
              {!items && !itemsError ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : null}
              {items && items.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">{vi ? 'Thư mục trống.' : 'This folder is empty.'}</p>
              ) : null}

              {items ? (
                <div className="space-y-1">
                  {items.map((item) => {
                    const visual = item.isFolder ? { icon: Folder, color: 'text-slate-500' } : getFileVisual(item.mimeType)
                    const isVideo = item.mimeType.startsWith('video/')
                    const Icon = isVideo ? PlayCircle : visual.icon
                    const active = current?.id === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openItem(item)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition cursor-pointer',
                          active
                            ? 'bg-[#c2e7ff]/70 text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff]'
                            : 'hover:bg-slate-100 dark:hover:bg-[#282a2c] text-slate-700 dark:text-slate-200',
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', isVideo ? 'text-red-500' : visual.color)} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.name}>
                          {item.name}
                        </span>
                        <span className="shrink-0 text-[11px] opacity-70">
                          {item.isFolder ? <ChevronRight className="h-3.5 w-3.5" /> : item.durationSeconds ? formatDuration(item.durationSeconds) : item.size ? formatBytes(item.size) : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : (
        /* Standard Google Drive Folder Explorer View */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Sub-header toolbar with breadcrumbs and view mode toggle */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/50 px-4 py-2.5 dark:border-slate-800 dark:bg-[#1a1b1d]/50 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none">
              {path.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setPath((steps) => steps.slice(0, steps.length - 1))}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                  title={vi ? 'Lên một cấp' : 'Up one level'}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              ) : null}
              <nav className="flex items-center gap-1 text-xs">
                {path.map((step, idx) => (
                  <span key={`${step.id ?? 'root'}-${idx}`} className="flex shrink-0 items-center gap-1">
                    {idx > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : null}
                    <button
                      type="button"
                      disabled={idx === path.length - 1}
                      onClick={() => setPath((steps) => steps.slice(0, idx + 1))}
                      className={cn(
                        'rounded px-1.5 py-0.5 max-w-[160px] truncate',
                        idx === path.length - 1
                          ? 'font-semibold text-slate-900 dark:text-slate-100'
                          : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer',
                      )}
                    >
                      {step.name}
                    </button>
                  </span>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-xs text-slate-400">
                {items ? `${items.length} ${vi ? 'mục' : 'items'}` : ''}
              </span>
              <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-[#1e1f20]">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'rounded p-1 cursor-pointer transition',
                    viewMode === 'grid'
                      ? 'bg-slate-100 text-[#0b57d0] dark:bg-slate-800 dark:text-[#a8c7fa]'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
                  )}
                  title={vi ? 'Chế độ lưới' : 'Grid view'}
                >
                  <Grid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'rounded p-1 cursor-pointer transition',
                    viewMode === 'list'
                      ? 'bg-slate-100 text-[#0b57d0] dark:bg-slate-800 dark:text-[#a8c7fa]'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
                  )}
                  title={vi ? 'Chế độ danh sách' : 'List view'}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Folder Content Explorer */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:px-6">
            {itemsError ? (
              <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{itemsError}</p>
            ) : null}
            {!items && !itemsError ? (
              <div className="flex flex-1 items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[#0b57d0]" />
              </div>
            ) : null}

            {items && items.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-slate-400">
                <Folder className="h-16 w-16 stroke-1 text-slate-300 dark:text-slate-700" />
                <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">
                  {vi ? 'Thư mục này trống.' : 'This folder is empty.'}
                </p>
              </div>
            ) : null}

            {items && items.length > 0 && viewMode === 'grid' ? (
              <div className="space-y-6">
                {/* Folders Section */}
                {items.filter((i) => i.isFolder).length > 0 && (
                  <div>
                    <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {vi ? 'Thư mục' : 'Folders'} ({items.filter((i) => i.isFolder).length})
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                      {items
                        .filter((i) => i.isFolder)
                        .map((folderItem) => (
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

                {/* Files Section */}
                {items.filter((i) => !i.isFolder).length > 0 && (
                  <div>
                    <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {vi ? 'Tệp' : 'Files'} ({items.filter((i) => !i.isFolder).length})
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                      {items
                        .filter((i) => !i.isFolder)
                        .map((fileItem) => {
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
                                {course.allowDownload && fileItem.streamUrl ? (
                                  <a
                                    href={lessonDownloadUrl(fileItem.streamUrl, fileItem.name)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-slate-600 shadow-sm opacity-0 group-hover:opacity-100 hover:bg-white hover:text-[#0b57d0] dark:bg-[#1e1f20]/90 dark:text-slate-300 dark:hover:bg-[#282a2c] transition"
                                    title={vi ? 'Tải tệp này' : 'Download file'}
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </a>
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
            ) : null}

            {items && items.length > 0 && viewMode === 'list' ? (
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
                            {item.isFolder ? (vi ? 'Thư mục' : 'Folder') : item.mimeType.split('/')[1] || item.mimeType}
                          </td>
                          <td className="py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {item.isFolder ? '--' : item.size ? formatBytes(item.size) : item.durationSeconds ? formatDuration(item.durationSeconds) : '--'}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {item.isFolder ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openItem(item)
                                  }}
                                  className="p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#282a2c]"
                                  title={vi ? 'Mở thư mục' : 'Open folder'}
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setPreviewItem(item)
                                    }}
                                    className="p-1 rounded-full text-slate-400 hover:text-[#0b57d0] hover:bg-slate-100 dark:hover:bg-[#282a2c]"
                                    title={vi ? 'Xem trước' : 'Preview'}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </button>
                                  {course.allowDownload && item.streamUrl ? (
                                    <a
                                      href={lessonDownloadUrl(item.streamUrl, item.name)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="p-1 rounded-full text-slate-400 hover:text-[#0b57d0] hover:bg-slate-100 dark:hover:bg-[#282a2c]"
                                      title={vi ? 'Tải tệp' : 'Download'}
                                    >
                                      <Download className="h-4 w-4" />
                                    </a>
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
            ) : null}
          </div>

          <FolderFilePreviewModal
            file={previewItem}
            files={items ? items.filter((i) => !i.isFolder) : []}
            vi={vi}
            allowDownload={course.allowDownload}
            onClose={() => setPreviewItem(null)}
            onNavigate={(next) => setPreviewItem(next)}
          />
        </div>
      )}

      {/* Save to Library Modal */}
      <DummyModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={
          data.isLoggedIn
            ? isCourse
              ? vi
                ? 'Lưu vào Khóa học của tôi'
                : 'Save to my Courses'
              : vi
                ? 'Lưu vào Quản lý Share'
                : 'Save to Share Management'
            : vi
              ? 'Đăng nhập vào HCDrive'
              : 'Log in to HCDrive'
        }
        description={
          data.isLoggedIn
            ? isCourse
              ? vi
                ? 'Khóa học sẽ được thêm vào thư viện HCDrive của bạn để bạn theo dõi tiến độ học tập.'
                : 'The course will be added to your library so you can track your learning progress.'
              : vi
                ? 'Thư mục sẽ được lưu vào danh sách Quản lý Share của bạn để truy cập nhanh bất kỳ lúc nào.'
                : 'The folder will be saved into your Share Management list for quick access anytime.'
            : vi
              ? 'Bạn cần đăng nhập tài khoản HCDrive để lưu vào thư viện cá nhân.'
              : 'Sign in to save this into your personal library.'
        }
      >
        {data.isLoggedIn ? (
          <form onSubmit={handleSave} className="space-y-4">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              {vi ? 'Xếp vào nhóm' : 'Collection / group'}
              <input
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                maxLength={120}
                placeholder={isCourse ? (vi ? 'Ví dụ: Khóa học Frontend' : 'E.g., Frontend Course') : (vi ? 'Ví dụ: Tài liệu dự án' : 'E.g., Project Docs')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 dark:border-slate-700 dark:bg-[#131314] dark:text-slate-100"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" size="sm" variant="text" onClick={() => setSaveOpen(false)}>
                {vi ? 'Huỷ' : 'Cancel'}
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <HardDriveDownload className="mr-1.5 h-4 w-4" />}
                {isCourse ? (vi ? 'Lưu khóa học' : 'Save course') : (vi ? 'Lưu vào Drive' : 'Save to Drive')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {vi
                ? 'Đăng nhập tài khoản HCDrive để lưu liên kết này và truy cập trên mọi thiết bị.'
                : 'Log in to save this link and access it across all devices.'}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" size="sm" variant="text" onClick={() => setSaveOpen(false)}>
                {vi ? 'Để sau' : 'Later'}
              </Button>
              <Button
                size="sm"
                onClick={() => navigate(`/login?returnTo=/library/s/${encodeURIComponent(token)}`)}
                className="gap-1.5"
              >
                <LogIn className="h-4 w-4" />
                {vi ? 'Đăng nhập ngay' : 'Log in now'}
              </Button>
            </div>
          </div>
        )}
      </DummyModal>
    </div>
  )
}

function SharedLessonPlayer({ lesson, vi }: { lesson: Lesson; vi: boolean }) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const src = lesson.streamUrl ? `${API_URL}${lesson.streamUrl}` : null

  const mediaProps = {
    controls: true,
    autoPlay: true,
    src: src ?? undefined,
  }

  if (src && lesson.mimeType.startsWith('video/')) {
    return <video ref={(node) => { mediaRef.current = node }} {...mediaProps} className="aspect-video w-full rounded-2xl bg-black shadow-md" />
  }
  if (src && lesson.mimeType.startsWith('audio/')) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-[#1a1b1d]">
        <audio ref={(node) => { mediaRef.current = node }} {...mediaProps} className="w-full" />
      </div>
    )
  }
  if (src && lesson.mimeType.startsWith('image/')) {
    return <img src={src} alt={lesson.name} className="max-h-[70vh] w-full rounded-2xl bg-slate-100 object-contain dark:bg-black" />
  }
  if (src && lesson.mimeType === 'application/pdf') {
    return <iframe src={src} title={lesson.name} className="h-[75vh] w-full rounded-2xl border border-slate-200 dark:border-slate-800" />
  }
  if (src && !lesson.mimeType.startsWith('application/vnd.google-apps.') && !lesson.mimeType.startsWith('text/')) {
    return (
      <div className="rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <p>{vi ? 'Trình duyệt không xem trực tiếp được loại tệp này.' : 'This file type cannot be shown directly in the browser.'}</p>
        <a href={src} target="_blank" rel="noreferrer" className="mt-3 inline-block font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">
          {vi ? 'Mở / tải tệp' : 'Open / download'}
        </a>
      </div>
    )
  }

  // Google Docs fallback
  return (
    <div>
      {lesson.previewUrl ? (
        <iframe src={lesson.previewUrl} title={lesson.name} allow="autoplay; fullscreen" allowFullScreen className="aspect-video w-full rounded-2xl border border-slate-200 bg-black dark:border-slate-800" />
      ) : null}
      {lesson.webViewLink ? (
        <a href={lesson.webViewLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">
          <ExternalLink className="h-3.5 w-3.5" />
          {vi ? 'Mở trong tab mới' : 'Open in a new tab'}
        </a>
      ) : null}
    </div>
  )
}
