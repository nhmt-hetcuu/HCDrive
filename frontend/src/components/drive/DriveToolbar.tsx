import { useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight,
  ChevronDown,
  Info,
  LayoutGrid,
  List,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  Upload,
  FolderUp,
  FileText
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FolderItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

export type SortField = 'name' | 'updatedAt' | 'size'
export type SortDirection = 'asc' | 'desc'

export function DriveToolbar({
  title,
  activeFolder,
  breadcrumbs = [],
  onOpenFolder,
  onFolderMenu,
  onRootClick,
  onNewFolder,
  onUploadFile,
  onUploadFolder,
  viewMode,
  onViewModeChange,
  detailsOpen,
  detailOpen,
  onToggleDetails,
  onToggleDetail,
  syncing = false,
  onSync,
  sortField = 'name',
  sortDirection = 'asc',
  onSortChange,
  lang,
}: {
  title?: string
  activeFolder?: FolderItem
  breadcrumbs?: FolderItem[]
  onOpenFolder?: (folderId: string) => void
  onFolderMenu?: (event: MouseEvent<HTMLElement>, folder: FolderItem) => void
  onRootClick?: () => void
  onNewFolder?: () => void
  onUploadFile?: () => void
  onUploadFolder?: () => void
  viewMode: 'grid' | 'list'
  onViewModeChange: (mode: 'grid' | 'list') => void
  detailsOpen?: boolean
  detailOpen?: boolean
  onToggleDetails?: () => void
  onToggleDetail?: () => void
  syncing?: boolean
  onSync?: () => void
  sortField?: SortField
  sortDirection?: SortDirection
  onSortChange?: (field: SortField) => void
  lang: 'vi' | 'en'
}) {
  const vi = lang === 'vi'
  const isDetailsOpen = detailsOpen ?? detailOpen ?? false
  const handleToggleDetails = onToggleDetails || onToggleDetail

  const [rootMenuOpen, setRootMenuOpen] = useState(false)
  const [rootMenuCoords, setRootMenuCoords] = useState<{ top: number; left: number } | null>(null)
  const rootBtnRef = useRef<HTMLButtonElement>(null)

  function handleRootClick() {
    if (activeFolder) {
      onRootClick?.()
    } else {
      if (rootMenuOpen) {
        setRootMenuOpen(false)
        setRootMenuCoords(null)
      } else if (rootBtnRef.current) {
        const rect = rootBtnRef.current.getBoundingClientRect()
        let left = rect.left
        const menuWidth = 240
        if (left + menuWidth > window.innerWidth - 12) {
          left = Math.max(12, window.innerWidth - menuWidth - 12)
        }
        setRootMenuCoords({ top: rect.bottom + 6, left })
        setRootMenuOpen(true)
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-1 px-4 sm:px-6">
      {/* Breadcrumbs or Page Title */}
      <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
        {title ? (
          <h1 className="text-xl sm:text-2xl font-normal text-slate-800 dark:text-slate-100 py-1">
            {title}
          </h1>
        ) : (
          <>
            <button
              ref={rootBtnRef}
              type="button"
              onClick={handleRootClick}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-lg sm:text-xl font-semibold transition-colors cursor-pointer',
                !activeFolder
                  ? 'text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              <span>{vi ? 'Drive của tôi' : 'My Drive'}</span>
              {!activeFolder && <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform duration-150', rootMenuOpen && 'rotate-180')} />}
            </button>

            {breadcrumbs.map((folder, index) => {
              const isLast = index === breadcrumbs.length - 1
              return (
                <div key={folder.id || index} className="flex items-center gap-1.5">
                  <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                  {isLast ? (
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-lg sm:text-xl text-slate-900 dark:text-slate-100 truncate max-w-[200px] sm:max-w-[320px]">
                        {folder.name}
                      </span>
                      {onFolderMenu && (
                        <button
                          type="button"
                          onClick={(e) => onFolderMenu(e, folder)}
                          className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                          title={vi ? 'Tuỳ chọn thư mục' : 'Folder options'}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => folder.id && onOpenFolder && onOpenFolder(folder.id)}
                      className="px-2 py-1 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium truncate max-w-[160px]"
                    >
                      {folder.name}
                    </button>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* View Switcher, Sort & Details toggle buttons */}
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
        {/* Sort button */}
        {onSortChange && (
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => onSortChange(sortField)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title={vi ? 'Đổi chiều sắp xếp' : 'Change sort direction'}
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-500" />
              <span>
                {sortField === 'name' ? (vi ? 'Tên' : 'Name') : sortField === 'updatedAt' ? (vi ? 'Lần sửa đổi' : 'Last modified') : (vi ? 'Kích thước' : 'Size')}
              </span>
              {sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </button>
          </div>
        )}

        {/* Sync Button */}
        {onSync && (
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={onSync}
            className="h-9 px-3 rounded-full border-slate-200 dark:border-slate-700"
            title={vi ? 'Đồng bộ từ Google Drive' : 'Sync from Google Drive'}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin text-blue-600')} />
            <span className="hidden md:inline ml-1 text-xs font-semibold">
              {syncing ? (vi ? 'Đang đồng bộ...' : 'Syncing...') : (vi ? 'Làm mới' : 'Refresh')}
            </span>
          </Button>
        )}

        {/* Segmented View Switcher [☰ | ⊞] */}
        <div className="flex items-center p-0.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/60">
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            className={cn(
              'p-1.5 rounded-full transition-all',
              viewMode === 'list'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            )}
            title={vi ? 'Chế độ xem danh sách' : 'List view'}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            className={cn(
              'p-1.5 rounded-full transition-all',
              viewMode === 'grid'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            )}
            title={vi ? 'Chế độ xem lưới' : 'Grid view'}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        {/* Info Toggle Button (i) */}
        {handleToggleDetails && (
          <button
            type="button"
            onClick={handleToggleDetails}
            className={cn(
              'p-2 rounded-full border transition-all',
              isDetailsOpen
                ? 'bg-[#c2e7ff] dark:bg-[#004a77] text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-600'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
            title={vi ? 'Chi tiết' : 'Details'}
            aria-label="Toggle details panel"
          >
            <Info className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Root "Drive của tôi" Dropdown Menu */}
      {rootMenuOpen && rootMenuCoords && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998] bg-transparent cursor-default"
            onClick={() => {
              setRootMenuOpen(false)
              setRootMenuCoords(null)
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: `${rootMenuCoords.top}px`,
              left: `${rootMenuCoords.left}px`,
              zIndex: 9999,
              width: '240px',
            }}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1f20] p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 text-xs select-none"
          >
            {onNewFolder && (
              <button
                type="button"
                onClick={() => {
                  setRootMenuOpen(false)
                  setRootMenuCoords(null)
                  onNewFolder()
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition cursor-pointer"
              >
                <FolderPlus className="h-4 w-4 text-slate-500" />
                <span>{vi ? 'Thư mục mới' : 'New folder'}</span>
              </button>
            )}

            {(onUploadFile || onUploadFolder) && (
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            )}

            {onUploadFile && (
              <button
                type="button"
                onClick={() => {
                  setRootMenuOpen(false)
                  setRootMenuCoords(null)
                  onUploadFile()
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition cursor-pointer"
              >
                <Upload className="h-4 w-4 text-slate-500" />
                <span>{vi ? 'Tải tệp lên' : 'File upload'}</span>
              </button>
            )}

            {onUploadFolder && (
              <button
                type="button"
                onClick={() => {
                  setRootMenuOpen(false)
                  setRootMenuCoords(null)
                  onUploadFolder()
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition cursor-pointer"
              >
                <FolderUp className="h-4 w-4 text-slate-500" />
                <span>{vi ? 'Tải thư mục lên' : 'Folder upload'}</span>
              </button>
            )}

            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

            <a
              href="https://docs.google.com/document/create"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setRootMenuOpen(false)
                setRootMenuCoords(null)
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition cursor-pointer"
            >
              <FileText className="h-4 w-4 text-blue-600" />
              <span>Google Docs</span>
            </a>

            <a
              href="https://docs.google.com/spreadsheets/create"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setRootMenuOpen(false)
                setRootMenuCoords(null)
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition cursor-pointer"
            >
              <FileText className="h-4 w-4 text-emerald-600" />
              <span>Google Sheets</span>
            </a>

            <a
              href="https://docs.google.com/presentation/create"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setRootMenuOpen(false)
                setRootMenuCoords(null)
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-[#282a2c] font-medium text-slate-700 dark:text-slate-200 text-left transition cursor-pointer"
            >
              <FileText className="h-4 w-4 text-amber-500" />
              <span>Google Slides</span>
            </a>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
