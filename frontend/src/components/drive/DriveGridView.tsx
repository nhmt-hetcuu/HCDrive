import { type MouseEvent } from 'react'
import {
  Check,
  File,
  FileArchive,
  FileImage,
  FilePlay,
  FileText,
  Folder,
  MoreVertical,
  Star
} from 'lucide-react'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

export function getFileVisual(mimeType = '') {
  if (
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv'
  ) {
    return { icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/40', label: { vi: 'Bảng tính', en: 'Spreadsheet' } }
  }
  if (
    mimeType === 'application/vnd.google-apps.presentation' ||
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint')
  ) {
    return { icon: FileText, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', label: { vi: 'Bản trình bày', en: 'Presentation' } }
  }
  if (
    mimeType === 'application/vnd.google-apps.document' ||
    mimeType.includes('wordprocessing') ||
    mimeType === 'application/msword' ||
    mimeType.startsWith('text/')
  ) {
    return { icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/40', label: { vi: 'Tài liệu', en: 'Document' } }
  }
  if (mimeType.includes('pdf')) {
    return { icon: FileText, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/40', label: { vi: 'PDF', en: 'PDF' } }
  }
  if (mimeType.startsWith('image/')) {
    return { icon: FileImage, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/40', label: { vi: 'Hình ảnh', en: 'Image' } }
  }
  if (mimeType.startsWith('video/')) {
    return { icon: FilePlay, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/40', label: { vi: 'Video', en: 'Video' } }
  }
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z') ||
    mimeType.includes('tar')
  ) {
    return { icon: FileArchive, color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', label: { vi: 'Tệp nén', en: 'Archive' } }
  }
  return { icon: File, color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', label: { vi: 'Tệp', en: 'File' } }
}

export function DriveGridView({
  folders,
  files,
  selectedFileIds,
  selectedFolderId,
  onSelectFile,
  onToggleFile,
  onSelectFolder,
  onOpenFolder,
  onFolderMenu,
  onViewFile,
  onFileMenu,
  onDropItem,
  lang,
}: {
  folders: FolderItem[]
  files: FileItem[]
  selectedFileIds: Set<string>
  selectedFolderId?: string | null
  onSelectFile: (file: FileItem, event: MouseEvent) => void
  onToggleFile?: (file: FileItem) => void
  onSelectFolder: (folder: FolderItem, event: MouseEvent) => void
  onOpenFolder: (folder: FolderItem) => void
  onFolderMenu: (event: MouseEvent<HTMLElement>, folder: FolderItem) => void
  onViewFile: (file: FileItem) => void
  onFileMenu: (event: MouseEvent<HTMLElement>, file: FileItem) => void
  onDropItem: (fileId: string, folderId: string) => void
  lang: 'vi' | 'en'
}) {
  const vi = lang === 'vi'
  const hasAnySelection = selectedFileIds.size > 0

  return (
    <div className="space-y-6 select-none">
      {/* 1. Folders Section */}
      {folders.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 px-1">
            {vi ? 'Thư mục' : 'Folders'}
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            {folders.map((folder) => {
              const isSelected = selectedFolderId === folder.id
              return (
                <div
                  key={`folder-${folder.id}`}
                  onClick={(e) => onSelectFolder(folder, e)}
                  onDoubleClick={() => onOpenFolder(folder)}
                  onContextMenu={(e) => onFolderMenu(e, folder)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDragEnter={(e) => e.currentTarget.classList.add('ring-2', 'ring-blue-500')}
                  onDragLeave={(e) => e.currentTarget.classList.remove('ring-2', 'ring-blue-500')}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.currentTarget.classList.remove('ring-2', 'ring-blue-500')
                    const fileId = e.dataTransfer.getData('text/plain')
                    if (fileId && folder.id) onDropItem(fileId, folder.id)
                  }}
                  className={cn(
                    'group flex items-center justify-between h-12 px-3 rounded-xl cursor-pointer transition border',
                    isSelected
                      ? 'bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff] border-blue-400 ring-2 ring-blue-600 font-semibold'
                      : 'bg-[#f0f4f9] hover:bg-[#e9eef6] dark:bg-[#282a2d] dark:hover:bg-[#333538] border-slate-200/60 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                  )}
                  title={folder.name}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-1">
                    <Folder
                      className={cn(
                        'h-5 w-5 shrink-0',
                        folder.color ? folder.color : 'text-slate-600 dark:text-slate-300'
                      )}
                    />
                    <span className="truncate text-xs font-medium">{folder.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFolderMenu(e, folder)
                    }}
                    className="p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={vi ? 'Thao tác' : 'Actions'}
                    aria-label="Folder menu"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 2. Files Section */}
      {files.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 px-1">
            {vi ? 'Tệp' : 'Files'}
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {files.map((file) => {
              const isSelected = Boolean(file.id && selectedFileIds.has(file.id))
              const visual = getFileVisual(file.mimeType)
              const Icon = visual.icon
              const isImage = file.mimeType?.startsWith('image/')
              // Google Drive thumbnail link
              const thumbUrl = file.thumbnailLink
                ? file.thumbnailLink
                : file.providerFileId
                  ? `https://drive.google.com/thumbnail?id=${file.providerFileId}&sz=w400`
                  : undefined

              return (
                <div
                  key={`file-${file.id}`}
                  draggable
                  onDragStart={(e) => {
                    if (file.id) e.dataTransfer.setData('text/plain', file.id)
                  }}
                  onClick={(e) => onSelectFile(file, e)}
                  onDoubleClick={() => onViewFile(file)}
                  onContextMenu={(e) => onFileMenu(e, file)}
                  className={cn(
                    'group flex flex-col h-[220px] rounded-2xl cursor-pointer transition border p-3',
                    isSelected
                      ? 'bg-[#c2e7ff]/30 border-blue-500 ring-2 ring-blue-600 dark:bg-[#004a77]/30'
                      : 'bg-[#f0f4f9] hover:bg-[#e9eef6] dark:bg-[#282a2d] dark:hover:bg-[#333538] border-slate-200/60 dark:border-slate-800'
                  )}
                  title={file.name}
                >
                  {/* Card Header: Icon + Name + Star + Menu */}
                  <div className="flex items-center justify-between gap-1.5 mb-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onToggleFile) {
                            onToggleFile(file)
                          } else {
                            onSelectFile(file, { ctrlKey: true, metaKey: true, stopPropagation: () => {} } as any)
                          }
                        }}
                        className={cn(
                          'h-5 w-5 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-all',
                          isSelected
                            ? 'bg-[#0b57d0] text-white shadow-sm'
                            : hasAnySelection
                              ? 'border-2 border-slate-400 dark:border-slate-500 hover:border-[#0b57d0] hover:bg-[#0b57d0]/10'
                              : 'hidden group-hover:flex border-2 border-slate-400 dark:border-slate-500 hover:border-[#0b57d0] hover:bg-[#0b57d0]/10'
                        )}
                        title={isSelected ? (vi ? 'Bỏ chọn' : 'Deselect') : (vi ? 'Chọn' : 'Select')}
                        aria-label={isSelected ? `Deselect ${file.name}` : `Select ${file.name}`}
                      >
                        {isSelected ? (
                          <Check className="h-3.5 w-3.5 stroke-[3]" />
                        ) : (
                          <Check className="h-3 w-3 text-[#0b57d0] opacity-0 hover:opacity-100 stroke-[2.5]" />
                        )}
                      </button>

                      {!isSelected && !hasAnySelection && (
                        <Icon className={cn('h-4 w-4 shrink-0 group-hover:hidden', visual.color)} />
                      )}

                      <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                        {file.name}
                      </span>
                    </div>

                    <div className="flex items-center shrink-0">
                      {file.starred && (
                        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 mr-0.5" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onFileMenu(e, file)
                        }}
                        className="p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={vi ? 'Thao tác' : 'Actions'}
                        aria-label="File menu"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body: Thumbnail Preview */}
                  <div className="flex-1 w-full rounded-xl bg-white dark:bg-[#1e1f20] border border-slate-200/40 dark:border-slate-800/40 overflow-hidden flex items-center justify-center relative">
                    {thumbUrl || isImage ? (
                      <img
                        src={thumbUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                          e.currentTarget.nextElementSibling?.classList.remove('hidden')
                        }}
                      />
                    ) : null}

                    {/* Fallback Icon */}
                    <div className={cn('flex flex-col items-center justify-center p-4', (thumbUrl || isImage) ? 'hidden' : '')}>
                      <div className={cn('p-3 rounded-2xl', visual.bg)}>
                        <Icon className={cn('h-10 w-10', visual.color)} />
                      </div>
                      <span className="mt-2 text-[10px] text-slate-400 font-semibold uppercase">
                        {file.size}
                      </span>
                    </div>
                  </div>

                  {/* Card Footer: Metadata info */}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate">{file.accountEmail ? file.accountEmail.split('@')[0] : file.access}</span>
                    <span className="shrink-0">{file.size}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
