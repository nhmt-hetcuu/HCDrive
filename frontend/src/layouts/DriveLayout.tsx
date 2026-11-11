import { type FormEvent, type ReactNode, useEffect, useRef, useState, useTransition } from 'react'
import { Outlet, useOutletContext, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Home,
  HardDrive,
  Layers,
  Share2,
  Clock,
  Star,
  Trash2,
  Cloud,
  Search,
  SlidersHorizontal,
  Moon,
  Sun,
  Laptop,
  Menu,
  X,
  Upload,
  FolderPlus,
  FolderUp,
  FileText,
  CheckCircle,
  ChevronDown,
  FileIcon,
  FolderIcon,
  FolderSync,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { Tooltip } from '@/components/ui/tooltip'
import { HeaderMenus } from '@/components/drive/HeaderMenus'
import { NotificationBell } from '@/components/drive/NotificationBell'
import { startDriveAction } from '@/lib/drive-actions'
import { UserAccountMenu } from '@/components/drive/UserAccountMenu'
import { apiFetch, formatBytes, formatAvatarUrl } from '@/lib/api'
import { useUpload } from '@/context/UploadContext'
import { useLanguage } from '@/context/LanguageContext'
import { clearAuthSession, getStoredUser, updateStoredUser, type AuthUser } from '@/lib/auth'
import { getGravatarUrl } from '@/lib/gravatar'
import { cn } from '@/lib/utils'
import { getInitialTheme, saveTheme, type Theme } from '@/lib/theme'

type MenuItem = {
  key: string
  label: string
  icon: any
  href: string
  adminOnly?: boolean
  dividerBefore?: boolean
}

// Google Drive 2024 Sidebar Structure (Section 2.2 of SPEC-GOOGLE-DRIVE-TOAN-BO-TRANG.md)
const driveMenu: MenuItem[] = [
  { key: 'menu.home', label: 'Trang chủ', icon: Home, href: '/home' },
  { key: 'menu.all_files', label: 'Drive của tôi', icon: HardDrive, href: '/all-files' },
  { key: 'menu.accounts', label: 'Tài khoản lưu trữ', icon: Layers, href: '/accounts' },
  { key: 'menu.shared_with_me', label: 'Được chia sẻ với tôi', icon: Share2, href: '/shared', dividerBefore: true },
  { key: 'menu.library', label: 'Quản lý Share', icon: FolderSync, href: '/library' },
  { key: 'menu.recent', label: 'Gần đây', icon: Clock, href: '/recent' },
  { key: 'menu.starred', label: 'Có gắn dấu sao', icon: Star, href: '/starred' },
  { key: 'menu.trash', label: 'Thùng rác', icon: Trash2, href: '/trash', dividerBefore: true },
  { key: 'menu.storage', label: 'Bộ nhớ', icon: Cloud, href: '/storage' },
]

type StorageSummary = {
  totalBytes: string
  usedBytes: string
  availableBytes: string
}

type ConnectedAccount = {
  id: string
  email: string
  provider: string
  status?: string
  lastError?: string | null
  hasCookie?: boolean
  connectedVia?: string | null
}

type SearchSuggestion = {
  id: string
  name: string
  mimeType?: string
  isFolder?: boolean
}

function isoToDateInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function NewActionButton({ onAction }: { onAction?: (action: 'upload' | 'folder' | 'upload-folder') => void }) {
  const [open, setOpen] = useState(false)
  const { lang } = useLanguage()
  const vi = lang === 'vi'
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <div ref={menuRef} className="relative mb-3 px-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 h-14 px-5 rounded-2xl bg-white dark:bg-[#37393b] text-slate-800 dark:text-slate-100 shadow-[0_1px_3px_0_rgba(60,64,67,0.3),0_4px_8px_3px_rgba(60,64,67,0.15)] hover:shadow-[0_2px_6px_2px_rgba(60,64,67,0.3),0_8px_16px_4px_rgba(60,64,67,0.15)] border border-slate-200/50 dark:border-slate-700/60 font-medium text-sm transition-all cursor-pointer group"
      >
        <svg className="h-6 w-6 shrink-0" viewBox="0 0 36 36">
          <path fill="#4285F4" d="M16 16v14h4V16h14v-4H20V-2h-4v14H2v4h14z" />
          <path fill="#34A853" d="M30 16H20l-4-4h14v4z" />
          <path fill="#FBBC05" d="M6 16h14v4H6z" />
          <path fill="#EA4335" d="M20 16v14h-4V16z" />
        </svg>
        <span className="font-medium text-sm text-slate-800 dark:text-slate-100 pr-1">{vi ? 'Mới' : 'New'}</span>
      </button>

      {open && (
        <div className="absolute left-1 top-16 z-50 w-60 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1f20] p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 text-xs">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onAction?.('folder')
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition"
          >
            <FolderPlus className="h-4 w-4 text-slate-500" />
            <span>{vi ? 'Thư mục mới' : 'New folder'}</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onAction?.('upload')
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition"
          >
            <Upload className="h-4 w-4 text-slate-500" />
            <span>{vi ? 'Tải tệp lên' : 'File upload'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onAction?.('upload-folder')
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition"
          >
            <FolderUp className="h-4 w-4 text-slate-500" />
            <span>{vi ? 'Tải thư mục lên' : 'Folder upload'}</span>
          </button>

          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

          {/* Created in an HCDrive storage account (the open folder's, if any), then opened in Google's editor. */}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              startDriveAction({ action: 'new-google-doc', kind: 'document' })
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition"
          >
            <FileText className="h-4 w-4 text-blue-600" />
            <span>{vi ? 'Google Tài liệu' : 'Google Docs'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              startDriveAction({ action: 'new-google-doc', kind: 'spreadsheet' })
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition"
          >
            <FileText className="h-4 w-4 text-emerald-600" />
            <span>{vi ? 'Google Trang tính' : 'Google Sheets'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              startDriveAction({ action: 'new-google-doc', kind: 'presentation' })
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition"
          >
            <FileText className="h-4 w-4 text-amber-500" />
            <span>{vi ? 'Google Trang trình bày' : 'Google Slides'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              startDriveAction({ action: 'new-google-doc', kind: 'form' })
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition"
          >
            <FileText className="h-4 w-4 text-purple-600" />
            <span>{vi ? 'Google Biểu mẫu' : 'Google Forms'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function SidebarContent({
  user,
  storage,
  onNavigate,
  onNewAction,
  onManageStorage,
}: {
  user: AuthUser | null
  storage: StorageSummary | null
  onNavigate?: () => void
  onNewAction?: (action: 'upload' | 'folder' | 'upload-folder') => void
  onManageStorage?: () => void
}) {
  const { t, lang } = useLanguage()
  const location = useLocation()
  const vi = lang === 'vi'
  const used = Number(storage?.usedBytes ?? 0)
  const total = Number(storage?.totalBytes ?? 0)
  const progress = total > 0 ? Math.min(100, (used / total) * 100) : 0

  return (
    <aside className="flex h-full w-64 flex-col bg-gd-page py-3 px-3 select-none">
      {/* Google Drive "+ Mới" (+ New) Button */}
      <NewActionButton onAction={onNewAction} />

      {/* Navigation Links */}
      <nav className="grid gap-0.5 overflow-y-auto pr-1">
        {driveMenu
          .filter((item) => !item.adminOnly || user?.isAdmin)
          .map((item) => (
            <div key={item.key}>
              {item.dividerBefore ? (
                <div className="my-2 border-t border-slate-200/70 dark:border-slate-800" />
              ) : null}
              <NavLink
                to={item.href}
                onClick={() => {
                  onNavigate?.()
                  if (location.pathname === item.href && !location.search) {
                    window.dispatchEvent(new Event('hcdrive:refresh-files'))
                    window.dispatchEvent(new Event('9drive:refresh-files'))
                  }
                }}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 items-center gap-3.5 rounded-full px-4 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff] font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#282a2c]'
                  )
                }
              >
                <item.icon className="h-5 w-5 shrink-0 opacity-80" />
                <span className="truncate">{t(item.key, item.label)}</span>
              </NavLink>
            </div>
          ))}
      </nav>

      {/* Storage Area (Google Drive Style) */}
      <div className="mt-auto pt-3 px-2 text-xs">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 mb-2 font-medium">
          <Cloud className="h-4 w-4 text-slate-500" />
          <span>{vi ? 'Bộ nhớ' : 'Storage'}</span>
        </div>

        {/* 4px Progress Bar */}
        <div className="h-1 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mb-2">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              progress > 90 ? 'bg-red-500' : progress > 75 ? 'bg-amber-500' : 'bg-[#0b57d0] dark:bg-[#a8c7fa]'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {vi
            ? `Đã dùng ${formatBytes(storage?.usedBytes)} trong tổng số ${formatBytes(storage?.totalBytes)}`
            : `${formatBytes(storage?.usedBytes)} of ${formatBytes(storage?.totalBytes)} used`}
        </p>

        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center h-8 rounded-full border-slate-300 dark:border-slate-700 text-xs font-medium text-[#0b57d0] dark:text-[#a8c7fa] hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => {
              onNavigate?.()
              onManageStorage?.()
            }}
          >
            {vi ? 'Quản lý bộ nhớ' : 'Manage storage'}
          </Button>
        </div>
      </div>
    </aside>
  )
}

export type DriveLayoutContext = {
  setHeaderActions: (actions: ReactNode) => void
}

export function useDriveLayoutActions() {
  return useOutletContext<DriveLayoutContext>()
}

export function DriveLayout() {
  const { t, lang } = useLanguage()
  const vi = lang === 'vi'
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchValue, setSearchValue] = useState(searchParams.get('q') ?? '')
  const [user, setUser] = useState<AuthUser | null>(getStoredUser())
  const [storage, setStorage] = useState<StorageSummary | null>(null)
  const [headerActions, setHeaderActions] = useState<ReactNode>(null)
  const { uploadProgress, setUploadProgress, retryFailedUpload } = useUpload()
  const [uploadProgressCollapsed, setUploadProgressCollapsed] = useState(false)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // Modals & Menus
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const [avatarError, setAvatarError] = useState(false)

  // Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [, startTransition] = useTransition()
  const searchBoxRef = useRef<HTMLDivElement>(null)

  // Advanced search filters
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterKind, setFilterKind] = useState(searchParams.get('kind') ?? '')
  const [filterAccountId, setFilterAccountId] = useState(searchParams.get('accountId') ?? '')
  const [filterMinSize, setFilterMinSize] = useState(() => {
    const min = searchParams.get('minSize')
    return min ? String(Math.round(Number(min) / (1024 * 1024))) : ''
  })
  const [filterMaxSize, setFilterMaxSize] = useState(() => {
    const max = searchParams.get('maxSize')
    return max ? String(Math.round(Number(max) / (1024 * 1024))) : ''
  })
  const [filterStartDate, setFilterStartDate] = useState(() => isoToDateInput(searchParams.get('startDate')))
  const [filterEndDate, setFilterEndDate] = useState(() => isoToDateInput(searchParams.get('endDate')))

  // Clear header actions and sync search on navigation
  useEffect(() => {
    setHeaderActions(null)
  }, [location.pathname])

  useEffect(() => {
    setSearchValue(searchParams.get('q') ?? '')
  }, [searchParams])

  // Sync Theme 3-state cycle (light -> dark -> system)
  function cycleTheme() {
    const nextTheme: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    saveTheme(nextTheme)
    setTheme(nextTheme)
  }

  // Load user, storage, connected accounts
  async function loadData() {
    try {
      const meData = await apiFetch<{ user: AuthUser }>('/auth/me').catch(() => null)
      if (meData?.user) {
        setUser(meData.user)
        updateStoredUser(meData.user)
      }
      const storageData = await apiFetch<StorageSummary>('/storage/summary').catch(() => null)
      if (storageData) setStorage(storageData)
      const accData = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts').catch(() => null)
      if (accData?.accounts) setAccounts(accData.accounts)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadData()

    // Periodically poll connected accounts status every 30s so dead cookies alert immediately
    const pollTimer = setInterval(() => {
      loadData()
    }, 30_000)

    function onStorageChanged() {
      loadData()
    }
    function onUserUpdated(e: Event) {
      const updatedUser = (e as CustomEvent<AuthUser>).detail || getStoredUser()
      if (updatedUser) {
        setUser(updatedUser)
      }
    }
    window.addEventListener('9drive:storage-changed', onStorageChanged)
    window.addEventListener('hcdrive:storage-changed', onStorageChanged)
    window.addEventListener('9drive:user-updated', onUserUpdated)
    window.addEventListener('hcdrive:user-updated', onUserUpdated)
    return () => {
      clearInterval(pollTimer)
      window.removeEventListener('9drive:storage-changed', onStorageChanged)
      window.removeEventListener('hcdrive:storage-changed', onStorageChanged)
      window.removeEventListener('9drive:user-updated', onUserUpdated)
      window.removeEventListener('hcdrive:user-updated', onUserUpdated)
    }
  }, [])

  // Update avatar URL
  useEffect(() => {
    setAvatarError(false)
    if (user?.avatarUrl) {
      setProfileImageUrl(formatAvatarUrl(user.avatarUrl))
    } else {
      getGravatarUrl(user?.email, 64)
        .then(setProfileImageUrl)
        .catch(() => setProfileImageUrl(''))
    }
  }, [user?.email, user?.avatarUrl])

  // Update search states on URL params changed
  useEffect(() => {
    setSearchValue(searchParams.get('q') ?? '')
    setFilterKind(searchParams.get('kind') ?? '')
    setFilterAccountId(searchParams.get('accountId') ?? '')
    setFilterMinSize(() => {
      const min = searchParams.get('minSize')
      return min ? String(Math.round(Number(min) / (1024 * 1024))) : ''
    })
    setFilterMaxSize(() => {
      const max = searchParams.get('maxSize')
      return max ? String(Math.round(Number(max) / (1024 * 1024))) : ''
    })
    setFilterStartDate(isoToDateInput(searchParams.get('startDate')))
    setFilterEndDate(isoToDateInput(searchParams.get('endDate')))
  }, [searchParams])

  // Debounce autocomplete search (5 matches)
  useEffect(() => {
    const query = searchValue.trim()
    if (!query || query.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    const timer = setTimeout(() => {
      apiFetch<{ files: any[] }>(`/files?q=${encodeURIComponent(query)}`)
        .then((res) => {
          startTransition(() => {
            const list: SearchSuggestion[] = (res.files || []).slice(0, 5).map((f) => ({
              id: f.id,
              name: f.name,
              mimeType: f.mimeType,
              isFolder: false,
            }))
            setSuggestions(list)
            setShowSuggestions(list.length > 0)
          })
        })
        .catch(() => {
          setSuggestions([])
        })
    }, 250)

    return () => clearTimeout(timer)
  }, [searchValue])

  // Dismiss dropdowns on external click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
        setFiltersOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
    clearAuthSession()
    navigate('/login')
  }

  function applyFilters() {
    const nextParams = new URLSearchParams()
    const activeFolderId = searchParams.get('folderId')
    if (activeFolderId && location.pathname === '/all-files') {
      nextParams.set('folderId', activeFolderId)
    }

    const q = searchValue.trim()
    if (q) nextParams.set('q', q)

    if (filterKind) nextParams.set('kind', filterKind)
    if (filterAccountId) nextParams.set('accountId', filterAccountId)

    if (filterMinSize) {
      const bytes = Number(filterMinSize) * 1024 * 1024
      if (!isNaN(bytes)) nextParams.set('minSize', String(bytes))
    }
    if (filterMaxSize) {
      const bytes = Number(filterMaxSize) * 1024 * 1024
      if (!isNaN(bytes)) nextParams.set('maxSize', String(bytes))
    }

    if (filterStartDate) {
      nextParams.set('startDate', new Date(`${filterStartDate}T00:00:00`).toISOString())
    }
    if (filterEndDate) {
      nextParams.set('endDate', new Date(`${filterEndDate}T23:59:59.999`).toISOString())
    }

    setShowSuggestions(false)
    setFiltersOpen(false)
    navigate({ pathname: '/all-files', search: nextParams.toString() })
  }

  function clearFilters() {
    setFilterKind('')
    setFilterAccountId('')
    setFilterMinSize('')
    setFilterMaxSize('')
    setFilterStartDate('')
    setFilterEndDate('')
    setFiltersOpen(false)

    const nextParams = new URLSearchParams()
    const activeFolderId = searchParams.get('folderId')
    if (activeFolderId && location.pathname === '/all-files') {
      nextParams.set('folderId', activeFolderId)
    }
    const q = searchValue.trim()
    if (q) nextParams.set('q', q)

    navigate({ pathname: '/all-files', search: nextParams.toString() })
  }

  function searchFiles(event: FormEvent) {
    event.preventDefault()
    applyFilters()
  }

  function handleNewAction(action: 'upload' | 'folder' | 'upload-folder') {
    if (location.pathname !== '/all-files') {
      navigate('/all-files')
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('hcdrive:new', { detail: action }))
        window.dispatchEvent(new CustomEvent('9drive:new', { detail: action }))
      }, 150)
    } else {
      window.dispatchEvent(new CustomEvent('hcdrive:new', { detail: action }))
      window.dispatchEvent(new CustomEvent('9drive:new', { detail: action }))
    }
  }

  const userInitial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase()

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-gd-page text-gd-text">
      {/* TOP HEADER: Google Drive 2024 Design (Section 2 of SPEC-GOOGLE-DRIVE-TOAN-BO-TRANG.md) */}
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between px-4 bg-gd-page border-b border-transparent">
        {/* Left: Brand Identity aligned with sidebar */}
        <div className="flex items-center gap-3 w-60 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-10 w-10 rounded-full"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => navigate('/home')}
          >
            <BrandLogo className="h-9 w-9 shrink-0" />
            <span className="font-brand text-[22px] font-normal tracking-tight text-slate-800 dark:text-slate-100">
              HCDrive
            </span>
          </div>
        </div>

        {/* Center: Google Pill Search Bar (max 720px) with autocomplete and filters */}
        <div
          ref={searchBoxRef}
          className="relative flex-1 max-w-[720px] mx-4 hidden sm:block"
        >
          <form onSubmit={searchFiles} className="relative w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true)
              }}
              placeholder={vi ? 'Tìm kiếm trong Drive' : 'Search in Drive'}
              className="w-full h-12 pl-12 pr-12 rounded-full bg-gd-search text-gd-text placeholder-slate-500 focus:bg-white dark:focus:bg-[#282a2c] focus:shadow-md focus:outline-none transition-all text-sm font-normal border border-transparent focus:border-slate-300 dark:focus:border-slate-700"
            />
            <Tooltip content={vi ? 'Tùy chọn tìm kiếm' : 'Search options'}>
              <button
                type="button"
                onClick={() => {
                  setFiltersOpen(!filtersOpen)
                  setShowSuggestions(false)
                }}
                className={cn(
                  'absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition',
                  filtersOpen && 'text-[#0b57d0] dark:text-[#a8c7fa] bg-slate-200/60 dark:bg-slate-700/60'
                )}
                aria-label="Filter"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </Tooltip>
          </form>

          {/* Autocomplete Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-14 z-50 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1f20] p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSearchValue(item.name)
                    setShowSuggestions(false)
                    navigate(`/all-files?q=${encodeURIComponent(item.name)}`)
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] text-left text-xs transition"
                >
                  {item.isFolder ? (
                    <FolderIcon className="h-4 w-4 text-blue-500 shrink-0" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-slate-400 shrink-0" />
                  )}
                  <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                    {item.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Advanced Search Filter Dialog */}
          {filtersOpen && (
            <div className="absolute left-0 right-0 top-14 z-50 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1f20] p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t('search.filters', 'Bộ lọc tìm kiếm')}
                </span>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium text-[#0b57d0] dark:text-[#a8c7fa] hover:underline"
                >
                  {t('search.clear', 'Xoá tất cả')}
                </button>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    {t('search.file_type', 'Loại tệp')}
                  </label>
                  <select
                    value={filterKind}
                    onChange={(e) => setFilterKind(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#282a2c] px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="">{t('search.all_types', 'Tất cả loại')}</option>
                    <option value="image">{t('search.image', 'Hình ảnh')}</option>
                    <option value="video">{t('search.video', 'Video')}</option>
                    <option value="pdf">{t('search.pdf', 'PDF')}</option>
                    <option value="doc">{t('search.doc', 'Tài liệu')}</option>
                    <option value="archive">{t('search.archive', 'Tệp nén')}</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    {vi ? 'Tài khoản lưu trữ' : 'Connected Account'}
                  </label>
                  <select
                    value={filterAccountId}
                    onChange={(e) => setFilterAccountId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#282a2c] px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="">{vi ? 'Tất cả tài khoản' : 'All Accounts'}</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.email} ({acc.provider})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    {vi ? 'Dung lượng (MB)' : 'Size Range (MB)'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      placeholder={vi ? 'Từ' : 'Min'}
                      value={filterMinSize}
                      onChange={(e) => setFilterMinSize(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#282a2c] px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                    />
                    <span className="text-slate-400 text-xs">-</span>
                    <input
                      type="number"
                      min="0"
                      placeholder={vi ? 'Đến' : 'Max'}
                      value={filterMaxSize}
                      onChange={(e) => setFilterMaxSize(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#282a2c] px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    {t('search.date_range', 'Khoảng thời gian')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#282a2c] px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                    />
                    <span className="text-slate-400 text-xs">-</span>
                    <input
                      type="date"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#282a2c] px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                <Button
                  variant="text"
                  size="sm"
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                >
                  {t('search.cancel', 'Huỷ')}
                </Button>
                <Button
                  variant="filled"
                  size="sm"
                  type="button"
                  onClick={applyFilters}
                >
                  {t('search.apply', 'Tìm kiếm')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Actions and User Avatar (Section 2.2 of SPEC-GOOGLE-DRIVE-TOAN-BO-TRANG.md) */}
        <div className="flex items-center gap-1 shrink-0">
          {headerActions ? (
            <div className="flex items-center gap-1 mr-2">{headerActions}</div>
          ) : null}

          <HeaderMenus lang={lang} />

          {/* System & Error Notification Bell */}
          <NotificationBell
            accounts={accounts}
            onRefresh={loadData}
            lang={lang}
          />

          <Tooltip
            content={
              theme === 'light'
                ? vi ? 'Giao diện: Sáng' : 'Theme: Light'
                : theme === 'dark'
                ? vi ? 'Giao diện: Tối' : 'Theme: Dark'
                : vi ? 'Giao diện: Theo hệ thống' : 'Theme: System'
            }
          >
            <button
              type="button"
              onClick={cycleTheme}
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-[#282a2c] transition cursor-pointer"
              aria-label="Theme toggle"
            >
              {theme === 'light' ? (
                <Sun className="h-5 w-5" />
              ) : theme === 'dark' ? (
                <Moon className="h-5 w-5" />
              ) : (
                <Laptop className="h-5 w-5" />
              )}
            </button>
          </Tooltip>

          {/* User Avatar Button (32px) */}
          <div className="relative ml-2">
            <Tooltip content={`${user?.name || user?.email}\n${user?.email}`}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300/80 dark:border-slate-700 hover:ring-2 hover:ring-slate-300 dark:hover:ring-slate-600 transition cursor-pointer overflow-hidden"
                aria-label="Account menu"
              >
                {!profileImageUrl || avatarError ? (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">
                    {userInitial}
                  </div>
                ) : (
                  <img
                    src={profileImageUrl}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                    onError={() => setAvatarError(true)}
                  />
                )}
              </button>
            </Tooltip>

            {/* Google-Style User Account Dropdown */}
            <UserAccountMenu
              open={accountMenuOpen}
              onClose={() => setAccountMenuOpen(false)}
              user={user}
              profileImageUrl={profileImageUrl}
              avatarError={avatarError}
              setAvatarError={setAvatarError}
              onLogout={logout}
              lang={lang}
              onOpenProfile={() => navigate('/settings')}
            />
          </div>
        </div>
      </header>

      {/* MAIN BODY: Sidebar + Content Card (Section 1.1 of SPEC-GOOGLE-DRIVE-TOAN-BO-TRANG.md) */}
      <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden lg:block h-full shrink-0">
          <SidebarContent
            user={user}
            storage={storage}
            onNewAction={handleNewAction}
            onManageStorage={() => navigate('/storage')}
          />
        </div>

        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-950/40 transition-opacity lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-50 transform bg-gd-page shadow-2xl transition-transform duration-300 ease-out lg:hidden w-64',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="absolute right-3 top-3 z-10">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <SidebarContent
            user={user}
            storage={storage}
            onNavigate={() => setSidebarOpen(false)}
            onNewAction={handleNewAction}
            onManageStorage={() => navigate('/storage')}
          />
        </div>

        {/* Content Area: Rounded 16px Card (Section 1.1) */}
        <section className="flex-1 min-w-0 pr-4 pb-4 pl-4 lg:pl-0 h-full overflow-hidden flex flex-col">
          <div className="flex-1 min-w-0 rounded-2xl bg-gd-surface border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm overflow-hidden flex flex-col min-h-0">
            <Outlet key={location.pathname + location.search} context={{ setHeaderActions } satisfies DriveLayoutContext} />
          </div>
        </section>
      </div>

      {/* Upload Progress Drawer */}
      {uploadProgress.open ? (
        <div className="fixed inset-x-3 bottom-3 z-[70] max-h-[70dvh] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1f20] shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[min(420px,calc(100vw-2.5rem))]">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
              {uploadProgress.status === 'done' ? (
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              ) : uploadProgress.status === 'partial' || uploadProgress.status === 'error' ? (
                <X className="h-5 w-5 text-red-500" />
              ) : (
                <Upload className="h-5 w-5 text-[#0b57d0] dark:text-[#a8c7fa]" />
              )}
              {uploadProgress.status === 'done'
                ? t('upload.complete', 'Tải lên hoàn tất')
                : uploadProgress.status === 'partial'
                ? t('upload.partial', 'Hoàn tất với một số lỗi')
                : uploadProgress.status === 'error'
                ? t('upload.failed', 'Tải lên thất bại')
                : uploadProgress.percent >= 99
                ? t('upload.processing', 'Đang xử lý trên máy chủ')
                : t('upload.uploading', 'Đang tải tệp lên')}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={uploadProgressCollapsed ? 'Expand' : 'Collapse'}
                onClick={() => setUploadProgressCollapsed(!uploadProgressCollapsed)}
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform',
                    uploadProgressCollapsed && 'rotate-180'
                  )}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Close"
                onClick={() => setUploadProgress((current) => ({ ...current, open: false }))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {!uploadProgressCollapsed && (
            <div className="p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="truncate font-medium">{uploadProgress.fileName}</p>
                <span className="text-slate-500 text-xs">{uploadProgress.percent}%</span>
              </div>
              <div className="mt-2.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={
                    uploadProgress.status === 'error' || uploadProgress.status === 'partial'
                      ? 'h-full rounded-full bg-red-500'
                      : uploadProgress.status === 'done'
                      ? 'h-full rounded-full bg-emerald-500'
                      : 'h-full rounded-full bg-[#0b57d0] dark:bg-[#a8c7fa]'
                  }
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
              {uploadProgress.files.length > 0 ? (
                <div className="mt-4 grid max-h-64 gap-2.5 overflow-y-auto pr-1 text-xs">
                  {uploadProgress.files.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="grid gap-1 rounded-xl bg-slate-50 dark:bg-[#282a2c] p-2.5"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate font-medium" title={file.name}>
                          {file.name}
                        </p>
                        <span className="shrink-0 text-slate-500">{file.percent}%</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <span>{formatBytes(file.size)}</span>
                        <div className="flex items-center gap-2">
                          {file.status === 'error' && (
                            <Button
                              variant="filled"
                              className="h-5 px-2 text-[10px]"
                              onClick={() => retryFailedUpload(file.name)}
                            >
                              {vi ? 'Thử lại' : 'Retry'}
                            </Button>
                          )}
                          <span
                            className={
                              file.status === 'error'
                                ? 'font-medium text-red-600'
                                : file.status === 'done'
                                ? 'font-medium text-emerald-600'
                                : 'font-medium text-[#0b57d0] dark:text-[#a8c7fa]'
                            }
                          >
                            {file.status === 'error'
                              ? vi ? 'Lỗi' : 'Failed'
                              : file.status === 'done'
                              ? vi ? 'Xong' : 'Done'
                              : file.percent >= 99
                              ? vi ? 'Đang xử lý' : 'Processing'
                              : vi ? 'Đang tải' : 'Uploading'}
                          </span>
                        </div>
                      </div>
                      <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700">
                        <div
                          className={
                            file.status === 'error'
                              ? 'h-full rounded-full bg-red-500'
                              : file.status === 'done'
                              ? 'h-full rounded-full bg-emerald-500'
                              : 'h-full rounded-full bg-[#0b57d0] dark:bg-[#a8c7fa]'
                          }
                          style={{ width: `${file.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* Help Modal */}

    </main>
  )
}
