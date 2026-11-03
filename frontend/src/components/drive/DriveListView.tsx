import type { MouseEvent } from 'react'
import {
  Folder,
  MoreVertical,
  Star,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { formatDriveDate } from '@/lib/api'
import { cn } from '@/lib/utils'

export type TableColumn = 'name' | 'owner' | 'last_modified' | 'size' | 'starred_on' | 'location'

function getDateGroup(dateValue: string | undefined, lang: 'vi' | 'en'): string {
  if (!dateValue) return lang === 'vi' ? 'Cũ hơn' : 'Older'
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return lang === 'vi' ? 'Cũ hơn' : 'Older'

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const fileDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - fileDay.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return lang === 'vi' ? 'Hôm nay' : 'Today'
  if (diffDays === 1) return lang === 'vi' ? 'Hôm qua' : 'Yesterday'
  if (diffDays <= 7) return lang === 'vi' ? '7 ngày qua' : 'Past 7 days'
  if (diffDays <= 30) return lang === 'vi' ? '30 ngày qua' : 'Past 30 days'
  if (date.getFullYear() === now.getFullYear()) return lang === 'vi' ? 'Năm nay' : 'Earlier this year'
  return lang === 'vi' ? 'Cũ hơn' : 'Older'
}

export function DriveListView({
  folders = [],
  files = [],
  selectedFileIds,
  selectedFolderId,
  allSelected,
  onToggleAll,
  onSelectFile,
  onToggleFile,
  onSelectFolder,
  onOpenFolder,
  onFolderMenu,
  onViewFile,
  onFileMenu,
  onDropItem,
  sortField = 'name',
  sortDirection = 'asc',
  onSortChange,
  columns = ['name', 'owner', 'last_modified', 'size'],
  groupBy = 'none',
  lang = 'vi',
}: {
  folders?: FolderItem[]
  files?: FileItem[]
  selectedFileIds: Set<string>
  selectedFolderId?: string | null
  allSelected: boolean
  onToggleAll: () => void
  onSelectFile: (file: FileItem, event: MouseEvent) => void
  onToggleFile?: (file: FileItem) => void
  onSelectFolder: (folder: FolderItem, event: MouseEvent) => void
  onOpenFolder: (folder: FolderItem) => void
  onFolderMenu: (event: MouseEvent<HTMLElement>, folder: FolderItem) => void
  onViewFile: (file: FileItem) => void
  onFileMenu: (event: MouseEvent<HTMLElement>, file: FileItem) => void
  onDropItem?: (fileId: string, folderId: string) => void
  sortField?: 'name' | 'updatedAt' | 'size'
  sortDirection?: 'asc' | 'desc'
  onSortChange?: (field: 'name' | 'updatedAt' | 'size') => void
  columns?: TableColumn[]
  groupBy?: 'none' | 'date'
  lang?: 'vi' | 'en'
}) {
  const vi = lang === 'vi'

  // Render grouped files if groupBy === 'date'
  const groupedFiles: { group: string; items: FileItem[] }[] = []
  if (groupBy === 'date') {
    const map = new Map<string, FileItem[]>()
    for (const f of files) {
      const g = getDateGroup(f.createdAt || f.date, lang)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(f)
    }
    for (const [group, items] of map.entries()) {
      groupedFiles.push({ group, items })
    }
  }

  function renderFileRow(file: FileItem) {
    const isSelected = Boolean(file.id && selectedFileIds.has(file.id))
    const visual = getFileVisual(file.mimeType)
    const Icon = visual.icon
    const displayDate = file.createdAt
      ? formatDriveDate(file.createdAt, lang)
      : file.date || '--'

    return (
      <tr
        key={`file-${file.id}`}
        draggable
        onDragStart={(e) => {
          if (file.id) e.dataTransfer.setData('text/plain', file.id)
        }}
        onClick={(e) => onSelectFile(file, e)}
        onDoubleClick={() => onViewFile(file)}
        onContextMenu={(e) => onFileMenu(e, file)}
        className={cn(
          'h-12 cursor-pointer transition group',
          isSelected
            ? 'bg-[#c2e7ff]/50 dark:bg-[#004a77]/40 text-blue-900 dark:text-blue-100 font-medium'
            : 'hover:bg-slate-100/60 dark:hover:bg-[#282a2c]/60 text-slate-700 dark:text-slate-200'
        )}
      >
        <td className="py-2.5 pl-3 w-10">
          <input
            type="checkbox"
            className="h-4 w-4 rounded cursor-pointer accent-[#0b57d0]"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation()
              if (onToggleFile) {
                onToggleFile(file)
              } else {
                onSelectFile(file, { ctrlKey: true, metaKey: true, stopPropagation: () => {} } as any)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${file.name}`}
          />
        </td>

        {/* Name column */}
        <td className="py-2.5 pr-4 min-w-[200px]">
          <div className="flex items-center gap-3 min-w-0">
            <Icon className={cn('h-4.5 w-4.5 shrink-0', visual.color)} />
            <span className="truncate font-medium text-xs sm:text-sm" title={file.name}>
              {file.name}
            </span>
            {file.starred && (
              <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
            )}
          </div>
        </td>

        {/* Location column if enabled */}
        {columns.includes('location') && (
          <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs hidden md:table-cell">
            <span className="truncate block" title={file.folderName || (vi ? 'Drive của tôi' : 'My Drive')}>
              {file.folderName || (vi ? 'Drive của tôi' : 'My Drive')}
            </span>
          </td>
        )}

        {/* Owner column */}
        {columns.includes('owner') && (
          <td className="py-2.5 text-slate-500 dark:text-slate-400 hidden md:table-cell text-xs">
            <span className="truncate block" title={file.accountEmail ?? file.owner ?? file.access}>
              {file.accountEmail ? file.accountEmail.split('@')[0] : file.owner ?? file.access ?? 'Tôi'}
            </span>
          </td>
        )}

        {/* Starred date column if enabled */}
        {columns.includes('starred_on') && (
          <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
            {file.starredDate || displayDate}
          </td>
        )}

        {/* Last modified column */}
        {columns.includes('last_modified') && (
          <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
            {displayDate}
          </td>
        )}

        {/* File size column */}
        {columns.includes('size') && (
          <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
            {file.size}
          </td>
        )}

        {/* Actions menu */}
        <td className="py-2.5 pr-3 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFileMenu(e, file)
            }}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            title={vi ? 'Thao tác' : 'Actions'}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className="overflow-x-auto select-none">
      <table className="w-full min-w-[680px] text-left text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <th className="w-10 py-3 pl-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded cursor-pointer accent-[#0b57d0]"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={vi ? 'Chọn tất cả tệp' : 'Select all files'}
                disabled={files.length === 0}
              />
            </th>

            <th className="py-3 font-semibold">
              <button
                type="button"
                onClick={() => onSortChange?.('name')}
                className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
              >
                <span>{vi ? 'Tên' : 'Name'}</span>
                {sortField === 'name' && (
                  sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#0b57d0]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#0b57d0]" />
                )}
              </button>
            </th>

            {columns.includes('location') && (
              <th className="py-3 font-semibold hidden md:table-cell">
                {vi ? 'Vị trí' : 'Location'}
              </th>
            )}

            {columns.includes('owner') && (
              <th className="py-3 font-semibold hidden md:table-cell">
                {vi ? 'Chủ sở hữu' : 'Owner / Drive'}
              </th>
            )}

            {columns.includes('starred_on') && (
              <th className="py-3 font-semibold">
                {vi ? 'Ngày gắn dấu sao' : 'Starred date'}
              </th>
            )}

            {columns.includes('last_modified') && (
              <th className="py-3 font-semibold">
                <button
                  type="button"
                  onClick={() => onSortChange?.('updatedAt')}
                  className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
                >
                  <span>{vi ? 'Sửa đổi lần cuối' : 'Last modified'}</span>
                  {sortField === 'updatedAt' && (
                    sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#0b57d0]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#0b57d0]" />
                  )}
                </button>
              </th>
            )}

            {columns.includes('size') && (
              <th className="py-3 font-semibold">
                <button
                  type="button"
                  onClick={() => onSortChange?.('size')}
                  className="flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
                >
                  <span>{vi ? 'Kích thước tệp' : 'File size'}</span>
                  {sortField === 'size' && (
                    sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-[#0b57d0]" /> : <ArrowDown className="h-3.5 w-3.5 text-[#0b57d0]" />
                  )}
                </button>
              </th>
            )}

            <th className="py-3 pr-3 text-right font-semibold w-12" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {/* Folders first (if any) */}
          {folders.map((folder) => {
            const isSelected = selectedFolderId === folder.id
            return (
              <tr
                key={`folder-${folder.id}`}
                onClick={(e) => onSelectFolder(folder, e)}
                onDoubleClick={() => onOpenFolder(folder)}
                onContextMenu={(e) => onFolderMenu(e, folder)}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDragEnter={(e) => e.currentTarget.classList.add('bg-blue-50', 'dark:bg-blue-950/40')}
                onDragLeave={(e) => e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-950/40')}
                onDrop={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-950/40')
                  const fileId = e.dataTransfer.getData('text/plain')
                  if (fileId && folder.id) onDropItem?.(fileId, folder.id)
                }}
                className={cn(
                  'h-12 cursor-pointer transition group',
                  isSelected
                    ? 'bg-[#c2e7ff]/50 dark:bg-[#004a77]/40 text-blue-900 dark:text-blue-100 font-medium'
                    : 'hover:bg-slate-100/60 dark:hover:bg-[#282a2c]/60 text-slate-700 dark:text-slate-200'
                )}
              >
                <td className="py-2.5 pl-3 w-10">
                  <Folder className={cn('h-5 w-5', folder.color ? folder.color : 'text-slate-500')} />
                </td>
                <td className="py-2.5 font-medium min-w-[200px] pr-4">
                  <span className="truncate block" title={folder.name}>
                    {folder.name}
                  </span>
                </td>

                {columns.includes('location') && (
                  <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs hidden md:table-cell">
                    <span className="truncate block">
                      {folder.path && folder.path.length > 0 ? folder.path[folder.path.length - 1].name : vi ? 'Drive của tôi' : 'My Drive'}
                    </span>
                  </td>
                )}

                {columns.includes('owner') && (
                  <td className="py-2.5 text-slate-500 dark:text-slate-400 hidden md:table-cell">
                    {folder.accounts && folder.accounts.length > 0 ? (
                      <span className="truncate block text-xs">
                        {folder.accounts.map((a) => a.email.split('@')[0]).join(', ')}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Google Drive</span>
                    )}
                  </td>
                )}

                {columns.includes('starred_on') && (
                  <td className="py-2.5 text-slate-400 text-xs">—</td>
                )}

                {columns.includes('last_modified') && (
                  <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    {folder.updated.replace('Updated ', '')}
                  </td>
                )}

                {columns.includes('size') && (
                  <td className="py-2.5 text-slate-400 text-xs">—</td>
                )}

                <td className="py-2.5 pr-3 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFolderMenu(e, folder)
                    }}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title={vi ? 'Thao tác' : 'Actions'}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            )
          })}

          {/* Files: Grouped or Ungrouped */}
          {groupBy === 'date' ? (
            groupedFiles.map(({ group, items }) => (
              <tr key={`group-${group}`} className="contents">
                <td colSpan={columns.length + 2} className="pt-4 pb-1.5 px-3 bg-transparent">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    {group}
                  </span>
                </td>
                {items.map(renderFileRow)}
              </tr>
            ))
          ) : (
            files.map(renderFileRow)
          )}
        </tbody>
      </table>
    </div>
  )
}
