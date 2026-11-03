import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X, Check, Calendar, HardDrive, FileType, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type DriveFilters,
  hasActiveFilters,
  getDatePresetRange,
} from '@/lib/driveFilters'

export type FilterParams = DriveFilters
export type FilterValues = DriveFilters

export type ConnectedAccount = {
  id: string
  email: string
  provider?: string
}

export function FilterChips({
  filters,
  accounts,
  onFilterChange,
  onClearFilters,
  lang,
}: {
  filters: FilterParams
  accounts: ConnectedAccount[]
  onFilterChange: (next: Partial<FilterParams>) => void
  onClearFilters: () => void
  lang: 'vi' | 'en'
}) {
  const vi = lang === 'vi'
  const [openChip, setOpenChip] = useState<'kind' | 'account' | 'date' | 'size' | null>(null)
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null)
  const [customStart, setCustomStart] = useState(filters.startDate?.split('T')[0] ?? '')
  const [customEnd, setCustomEnd] = useState(filters.endDate?.split('T')[0] ?? '')

  const kindBtnRef = useRef<HTMLButtonElement>(null)
  const accountBtnRef = useRef<HTMLButtonElement>(null)
  const dateBtnRef = useRef<HTMLButtonElement>(null)
  const sizeBtnRef = useRef<HTMLButtonElement>(null)

  const hasAnyFilter = hasActiveFilters(filters)

  // Sync custom start/end with external filters
  useEffect(() => {
    setCustomStart(filters.startDate?.split('T')[0] ?? '')
    setCustomEnd(filters.endDate?.split('T')[0] ?? '')
  }, [filters.startDate, filters.endDate])

  // Close dropdown on scroll or window resize
  useEffect(() => {
    if (!openChip) return
    function handleScrollOrResize() {
      setOpenChip(null)
      setMenuCoords(null)
    }
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [openChip])

  // Close on Escape key
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenChip(null)
        setMenuCoords(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function toggleChip(chip: 'kind' | 'account' | 'date' | 'size', buttonEl: HTMLElement) {
    if (openChip === chip) {
      setOpenChip(null)
      setMenuCoords(null)
    } else {
      const rect = buttonEl.getBoundingClientRect()
      const menuWidth = chip === 'account' ? 288 : chip === 'date' ? 260 : 224
      let left = rect.left
      if (left + menuWidth > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - menuWidth - 12)
      }
      setMenuCoords({
        top: rect.bottom + 6,
        left,
      })
      setOpenChip(chip)
    }
  }

  const kindOptions = [
    { value: 'folder', label: vi ? 'Thư mục' : 'Folders' },
    { value: 'doc', label: vi ? 'Tài liệu (Docs/Word)' : 'Documents' },
    { value: 'sheet', label: vi ? 'Bảng tính (Sheets/Excel)' : 'Spreadsheets' },
    { value: 'slide', label: vi ? 'Bản trình bày (Slides)' : 'Presentations' },
    { value: 'pdf', label: 'PDF' },
    { value: 'image', label: vi ? 'Hình ảnh' : 'Images' },
    { value: 'video', label: 'Video' },
    { value: 'archive', label: vi ? 'Tệp nén (ZIP/RAR)' : 'Archives' },
  ]

  const sizeOptions = [
    { label: vi ? 'Dưới 1 MB' : 'Under 1 MB', min: undefined, max: String(1024 * 1024) },
    { label: '1 MB – 100 MB', min: String(1024 * 1024), max: String(100 * 1024 * 1024) },
    { label: '100 MB – 1 GB', min: String(100 * 1024 * 1024), max: String(1024 * 1024 * 1024) },
    { label: vi ? 'Trên 1 GB' : 'Over 1 GB', min: String(1024 * 1024 * 1024), max: undefined },
  ]

  function applyDatePreset(preset: 'today' | '7d' | '30d' | 'this_year') {
    const range = getDatePresetRange(preset)
    if (!range) return
    onFilterChange({
      startDate: range.startDate,
      endDate: range.endDate,
      datePreset: preset,
      dateRange: undefined,
    })
    setOpenChip(null)
    setMenuCoords(null)
  }

  function applyCustomDate() {
    if (!customStart && !customEnd) return
    const startIso = customStart ? new Date(`${customStart}T00:00:00`).toISOString() : undefined
    const endIso = customEnd ? new Date(`${customEnd}T23:59:59`).toISOString() : undefined
    onFilterChange({ startDate: startIso, endDate: endIso, datePreset: undefined, dateRange: undefined })
    setOpenChip(null)
    setMenuCoords(null)
  }

  const activeKindLabel = kindOptions.find((o) => o.value === filters.kind)?.label
  const activeAccount = accounts.find((a) => a.id === filters.accountId)
  const isCustomSizeActive = Boolean(filters.minSize || filters.maxSize)
  const isDateActive = Boolean(filters.startDate || filters.endDate || filters.datePreset || filters.dateRange)

  const datePresetLabels: Record<string, string> = {
    today: vi ? 'Hôm nay' : 'Today',
    '7d': vi ? '7 ngày qua' : 'Last 7 days',
    '30d': vi ? '30 ngày qua' : 'Last 30 days',
    this_year: vi ? 'Năm nay' : 'This year',
  }
  const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(vi ? 'vi-VN' : 'en-US') : '…')
  const activeDateLabel = filters.datePreset && datePresetLabels[filters.datePreset]
    ? datePresetLabels[filters.datePreset]
    : `${shortDate(filters.startDate)} – ${shortDate(filters.endDate)}`
  const activeSizeLabel = sizeOptions.find((o) => (o.min ?? null) === (filters.minSize ?? null) && (o.max ?? null) === (filters.maxSize ?? null))?.label
    ?? `${filters.minSize ? `≥ ${(Number(filters.minSize) / 1048576).toFixed(0)} MB` : ''}${filters.minSize && filters.maxSize ? ' · ' : ''}${filters.maxSize ? `≤ ${(Number(filters.maxSize) / 1048576).toFixed(0)} MB` : ''}`

  return (
    <div className="flex items-center gap-2 flex-wrap py-1 text-xs select-none">
      {/* 1. Chip Loại (Type) */}
      <div className="relative shrink-0">
        <button
          ref={kindBtnRef}
          type="button"
          onClick={(e) => toggleChip('kind', e.currentTarget)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 rounded-full border transition font-medium cursor-pointer',
            filters.kind || openChip === 'kind'
              ? 'bg-[#c2e7ff] text-[#001d35] border-blue-400 dark:bg-[#004a77] dark:text-[#c2e7ff]'
              : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
        >
          <FileType className="h-3.5 w-3.5 text-slate-500" />
          <span>{filters.kind ? `${vi ? 'Loại: ' : 'Type: '}${activeKindLabel}` : (vi ? 'Loại' : 'Type')}</span>
          {filters.kind ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onFilterChange({ kind: undefined })
              }}
              className="ml-1 p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full"
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
          )}
        </button>
      </div>

      {/* 2. Chip Tài khoản (Account) */}
      <div className="relative shrink-0">
        <button
          ref={accountBtnRef}
          type="button"
          onClick={(e) => toggleChip('account', e.currentTarget)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 rounded-full border transition font-medium cursor-pointer',
            filters.accountId || openChip === 'account'
              ? 'bg-[#c2e7ff] text-[#001d35] border-blue-400 dark:bg-[#004a77] dark:text-[#c2e7ff]'
              : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
        >
          <HardDrive className="h-3.5 w-3.5 text-slate-500" />
          <span>
            {activeAccount
              ? `${vi ? 'Tài khoản: ' : 'Account: '}${activeAccount.email.split('@')[0]}`
              : (vi ? 'Tài khoản' : 'People / Drive')}
          </span>
          {filters.accountId ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onFilterChange({ accountId: undefined })
              }}
              className="ml-1 p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full"
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
          )}
        </button>
      </div>

      {/* 3. Chip Lần sửa đổi (Date modified) */}
      <div className="relative shrink-0">
        <button
          ref={dateBtnRef}
          type="button"
          onClick={(e) => toggleChip('date', e.currentTarget)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 rounded-full border transition font-medium cursor-pointer',
            isDateActive || openChip === 'date'
              ? 'bg-[#c2e7ff] text-[#001d35] border-blue-400 dark:bg-[#004a77] dark:text-[#c2e7ff]'
              : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
        >
          <Calendar className="h-3.5 w-3.5 text-slate-500" />
          <span>{isDateActive ? `${vi ? 'Lần sửa đổi: ' : 'Modified: '}${activeDateLabel}` : (vi ? 'Lần sửa đổi' : 'Last modified')}</span>
          {isDateActive ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onFilterChange({ startDate: undefined, endDate: undefined, datePreset: undefined, dateRange: undefined })
              }}
              className="ml-1 p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full"
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
          )}
        </button>
      </div>

      {/* 4. Chip Dung lượng (File size) */}
      <div className="relative shrink-0">
        <button
          ref={sizeBtnRef}
          type="button"
          onClick={(e) => toggleChip('size', e.currentTarget)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 rounded-full border transition font-medium cursor-pointer',
            isCustomSizeActive || openChip === 'size'
              ? 'bg-[#c2e7ff] text-[#001d35] border-blue-400 dark:bg-[#004a77] dark:text-[#c2e7ff]'
              : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
        >
          <Database className="h-3.5 w-3.5 text-slate-500" />
          <span>{isCustomSizeActive ? `${vi ? 'Dung lượng: ' : 'Size: '}${activeSizeLabel}` : (vi ? 'Dung lượng' : 'Size')}</span>
          {isCustomSizeActive ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onFilterChange({ minSize: undefined, maxSize: undefined })
              }}
              className="ml-1 p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full"
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
          )}
        </button>
      </div>

      {/* Clear All button */}
      {hasAnyFilter && (
        <button
          type="button"
          onClick={onClearFilters}
          className="ml-auto text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 px-2 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/40 shrink-0 cursor-pointer"
        >
          {vi ? 'Xoá bộ lọc' : 'Clear filters'}
        </button>
      )}

      {/* Render Dropdown via React Portal */}
      {openChip && menuCoords && typeof document !== 'undefined' && createPortal(
        <>
          {/* Transparent backdrop for outside clicks */}
          <div
            className="fixed inset-0 z-[9998] bg-transparent cursor-default"
            onClick={() => {
              setOpenChip(null)
              setMenuCoords(null)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setOpenChip(null)
              setMenuCoords(null)
            }}
          />

          <div
            style={{
              position: 'fixed',
              top: `${menuCoords.top}px`,
              left: `${menuCoords.left}px`,
              zIndex: 9999,
              maxHeight: 'calc(100vh - 32px)',
              overflowY: 'auto',
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none"
          >
            {/* 1. Kind Menu */}
            {openChip === 'kind' && (
              <div className="w-56">
                <div className="text-[11px] font-bold text-slate-400 px-2 py-1 uppercase">{vi ? 'Chọn định dạng' : 'Select Format'}</div>
                {kindOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onFilterChange({ kind: filters.kind === opt.value ? undefined : opt.value })
                      setOpenChip(null)
                      setMenuCoords(null)
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg text-left transition cursor-pointer',
                      filters.kind === opt.value
                        ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    )}
                  >
                    <span>{opt.label}</span>
                    {filters.kind === opt.value && <Check className="h-3.5 w-3.5 text-blue-600" />}
                  </button>
                ))}
              </div>
            )}

            {/* 2. Account Menu */}
            {openChip === 'account' && (
              <div className="w-72">
                <div className="text-[11px] font-bold text-slate-400 px-2 py-1 uppercase">{vi ? 'Chọn tài khoản lưu trữ' : 'Connected Drive Accounts'}</div>
                {accounts.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-slate-400 italic">
                    {vi ? 'Chưa có tài khoản nào' : 'No accounts connected'}
                  </p>
                ) : (
                  accounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        onFilterChange({ accountId: filters.accountId === acc.id ? undefined : acc.id })
                        setOpenChip(null)
                        setMenuCoords(null)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-lg text-left transition cursor-pointer',
                        filters.accountId === acc.id
                          ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 font-semibold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      )}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="truncate font-semibold">{acc.email}</p>
                        <p className="text-[10px] text-slate-400">{acc.provider === 'google_drive' ? 'Google Drive' : 'S3'}</p>
                      </div>
                      {filters.accountId === acc.id && <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* 3. Date Menu */}
            {openChip === 'date' && (
              <div className="w-64 p-1">
                <div className="space-y-1">
                  <button type="button" onClick={() => applyDatePreset('today')} className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer">{vi ? 'Hôm nay' : 'Today'}</button>
                  <button type="button" onClick={() => applyDatePreset('7d')} className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer">{vi ? '7 ngày qua' : 'Last 7 days'}</button>
                  <button type="button" onClick={() => applyDatePreset('30d')} className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer">{vi ? '30 ngày qua' : 'Last 30 days'}</button>
                  <button type="button" onClick={() => applyDatePreset('this_year')} className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer">{vi ? 'Năm nay' : 'This year'}</button>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{vi ? 'Khoảng ngày tuỳ chỉnh' : 'Custom range'}</span>
                  <div className="mt-1.5 grid gap-1.5">
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-slate-800 dark:text-slate-200"
                    />
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-slate-800 dark:text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={applyCustomDate}
                      className="mt-1 w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-1 font-semibold text-xs cursor-pointer transition"
                    >
                      {vi ? 'Áp dụng' : 'Apply'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Size Menu */}
            {openChip === 'size' && (
              <div className="w-52">
                <div className="text-[11px] font-bold text-slate-400 px-2 py-1 uppercase">{vi ? 'Chọn kích cỡ' : 'Size range'}</div>
                {sizeOptions.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      onFilterChange({ minSize: opt.min, maxSize: opt.max })
                      setOpenChip(null)
                      setMenuCoords(null)
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
