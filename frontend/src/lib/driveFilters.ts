export type DriveFilters = {
  kind?: string | null
  accountId?: string | null
  startDate?: string | null
  endDate?: string | null
  minSize?: string | null
  maxSize?: string | null
  datePreset?: string | null
  dateRange?: string | null
}

export type FilterParams = DriveFilters
export type FilterValues = DriveFilters

export const KIND_OPTIONS = [
  { value: 'folder', labelVi: 'Thư mục', labelEn: 'Folders' },
  { value: 'doc', labelVi: 'Tài liệu (Docs/Word)', labelEn: 'Documents' },
  { value: 'sheet', labelVi: 'Bảng tính (Sheets/Excel)', labelEn: 'Spreadsheets' },
  { value: 'slide', labelVi: 'Bản trình bày (Slides)', labelEn: 'Presentations' },
  { value: 'pdf', labelVi: 'Tệp PDF', labelEn: 'PDFs' },
  { value: 'image', labelVi: 'Hình ảnh', labelEn: 'Images' },
  { value: 'video', labelVi: 'Video', labelEn: 'Videos' },
  { value: 'archive', labelVi: 'Tệp nén (ZIP/RAR)', labelEn: 'Archives' },
]

export const SIZE_PRESETS = [
  { min: null, max: '10485760', labelVi: '< 10 MB', labelEn: '< 10 MB' },
  { min: '10485760', max: '104857600', labelVi: '10 MB – 100 MB', labelEn: '10 MB – 100 MB' },
  { min: '104857600', max: '1073741824', labelVi: '100 MB – 1 GB', labelEn: '100 MB – 1 GB' },
  { min: '1073741824', max: null, labelVi: '> 1 GB', labelEn: '> 1 GB' },
]

export function getDatePresetRange(preset: string): { startDate: string; endDate: string } | null {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  let start: Date

  switch (preset) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      break
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case 'this_year':
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)
      break
    default:
      return null
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  }
}

export function parseFilters(params: URLSearchParams): DriveFilters {
  return {
    kind: params.get('kind') || null,
    accountId: params.get('accountId') || null,
    startDate: params.get('startDate') || null,
    endDate: params.get('endDate') || null,
    minSize: params.get('minSize') || null,
    maxSize: params.get('maxSize') || null,
    datePreset: params.get('datePreset') || null,
    dateRange: params.get('dateRange') || null,
  }
}

export function filtersToParams(
  filters: Partial<DriveFilters>,
  baseParams: URLSearchParams = new URLSearchParams()
): URLSearchParams {
  const params = new URLSearchParams(baseParams)
  const filterKeys: Array<keyof DriveFilters> = [
    'kind',
    'accountId',
    'startDate',
    'endDate',
    'minSize',
    'maxSize',
    'datePreset',
    'dateRange',
  ]

  for (const key of filterKeys) {
    const val = filters[key]
    if (val) {
      params.set(key, String(val))
    } else {
      params.delete(key)
    }
  }

  return params
}

export function hasActiveFilters(filters: DriveFilters): boolean {
  return Boolean(
    filters.kind ||
    filters.accountId ||
    filters.startDate ||
    filters.endDate ||
    filters.minSize ||
    filters.maxSize ||
    filters.datePreset ||
    filters.dateRange
  )
}
