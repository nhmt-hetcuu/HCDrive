import { useEffect, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  HardDrive,
  MoreVertical,
  Star,
  Clock,
  ArrowRight
} from 'lucide-react'
import { apiFetch, API_URL, formatDriveDate } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { getAccessToken } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { DriveToolbar } from '@/components/drive/DriveToolbar'
import { DetailsPanel } from '@/components/drive/DetailsPanel'
import { FileContextMenu } from '@/components/drive/FileContextMenu'
import { FolderContextMenu } from '@/components/drive/FolderContextMenu'
import { GoogleFilePreview } from '@/components/drive/GoogleFilePreview'
import { ShareDialog, type ShareTarget } from '@/components/drive/ShareDialog'
import { getFileVisual } from '@/components/drive/DriveGridView'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

interface SuggestedFileItem extends FileItem {
  reason?: 'opened' | 'edited' | 'uploaded'
  reasonTime?: string
  folderName?: string | null
}

export function HomePage() {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const navigate = useNavigate()
  const vi = lang === 'vi'

  const [loading, setLoading] = useState(true)
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [files, setFiles] = useState<SuggestedFileItem[]>([])
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<SuggestedFileItem | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null)

  // Section collapse state (persisted to localStorage)
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => {
    return (localStorage.getItem('hcdrive_home_folders_collapsed') || localStorage.getItem('9drive_home_folders_collapsed')) === 'true'
  })
  const [filesCollapsed, setFilesCollapsed] = useState(() => {
    return (localStorage.getItem('hcdrive_home_files_collapsed') || localStorage.getItem('9drive_home_files_collapsed')) === 'true'
  })

  // Modals & context menus
  const [previewOpen, setPreviewOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)

  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number
    y: number
    file: FileItem | null
  }>({ x: 0, y: 0, file: null })

  const [folderContextMenu, setFolderContextMenu] = useState<{
    x: number
    y: number
    folder: FolderItem | null
  }>({ x: 0, y: 0, folder: null })

  async function loadSuggestions() {
    setLoading(true)
    try {
      const data = await apiFetch<{
        folders: FolderItem[]
        files: SuggestedFileItem[]
      }>('/home/suggestions')
      setFolders(data.folders || [])
      setFiles(data.files || [])
    } catch (err: any) {
      console.warn('Failed to load home suggestions:', err)
      // Fallback: load recent files
      try {
        const recentData = await apiFetch<{ files: any[] }>('/files/recent')
        const mapped = (recentData.files || []).map((f) => ({
          ...f,
          reason: 'opened' as const,
          reasonTime: f.viewedByMeTime || f.modifiedTime,
        }))
        setFiles(mapped.slice(0, 10))
      } catch {
        // quiet fallback
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSuggestions()
  }, [])

  function toggleFoldersCollapse() {
    setFoldersCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('hcdrive_home_folders_collapsed', String(next))
      localStorage.setItem('9drive_home_folders_collapsed', String(next))
      return next
    })
  }

  function toggleFilesCollapse() {
    setFilesCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('hcdrive_home_files_collapsed', String(next))
      localStorage.setItem('9drive_home_files_collapsed', String(next))
      return next
    })
  }

  function handleFileClick(file: SuggestedFileItem) {
    setSelectedFile(file)
    setSelectedFolder(null)
  }

  function handleFolderClick(folder: FolderItem) {
    setSelectedFolder(folder)
    setSelectedFile(null)
  }

  function handleOpenFolder(folder: FolderItem) {
    if (folder.id) {
      navigate(`/all-files?folderId=${folder.id}`)
    }
  }

  function handleViewFile(file: SuggestedFileItem) {
    setSelectedFile(file)
    setPreviewOpen(true)
    setFileContextMenu({ x: 0, y: 0, file: null })
  }

  async function handleDownloadFile(file?: SuggestedFileItem) {
    const target = file || selectedFile
    if (!target) return
    try {
      if (target.id) {
        const res = await fetch(`${API_URL}/files/${target.id}/download`, {
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        })
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = target.name
          a.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
          showSnackbar(vi ? `Đang tải xuống ${target.name}` : `Downloading ${target.name}`)
          return
        }
      }
      if (target.providerFileId) {
        window.open(`https://drive.google.com/uc?id=${target.providerFileId}&export=download`, '_blank')
      }
    } catch (err: any) {
      showSnackbar(vi ? 'Tải tệp thất bại' : 'Download failed')
    }
  }

  async function handleToggleStar(targetFile?: FileItem) {
    const f = targetFile || selectedFile
    if (!f?.id) return
    const newStar = !f.starred
    try {
      await apiFetch(`/files/${f.id}/star`, {
        method: 'POST',
        body: JSON.stringify({ starred: newStar }),
      })
      setFiles((prev) =>
        prev.map((item) => (item.id === f.id ? { ...item, starred: newStar } : item))
      )
      showSnackbar(
        newStar
          ? (vi ? 'Đã thêm vào mục có gắn dấu sao' : 'Added to Starred')
          : (vi ? 'Đã xoá khỏi mục có gắn dấu sao' : 'Removed from Starred')
      )
    } catch {
      showSnackbar(vi ? 'Không thể cập nhật dấu sao' : 'Failed to update star')
    }
  }

  function handleFileMenu(e: MouseEvent<HTMLElement>, file: SuggestedFileItem) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedFile(file)
    setFileContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  function handleFolderMenu(e: MouseEvent<HTMLElement>, folder: FolderItem) {
    e.preventDefault()
    e.stopPropagation()
    setSelectedFolder(folder)
    setFolderContextMenu({ x: e.clientX, y: e.clientY, folder })
  }

  function formatReason(item: SuggestedFileItem): string {
    const timeStr = formatDriveDate(item.reasonTime || item.date || item.createdAt, lang)
    if (item.reason === 'edited') {
      return vi ? `Bạn đã chỉnh sửa • ${timeStr}` : `You edited • ${timeStr}`
    }
    if (item.reason === 'uploaded') {
      return vi ? `Bạn đã tải lên • ${timeStr}` : `You uploaded • ${timeStr}`
    }
    return vi ? `Bạn đã mở • ${timeStr}` : `You opened • ${timeStr}`
  }

  const isEmpty = !loading && folders.length === 0 && files.length === 0

  return (
    <div className="flex h-full flex-col min-w-0 select-none">
      {/* 1. Drive Toolbar */}
      <DriveToolbar
        title={vi ? 'Chào mừng bạn đến với HCDrive' : 'Welcome to HCDrive'}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        detailOpen={detailOpen}
        onToggleDetail={() => setDetailOpen(!detailOpen)}
        lang={lang}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">
          {loading ? (
            <div className="space-y-6 animate-pulse">
              <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded" />
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
                ))}
              </div>
              <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded mt-8" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800/60 rounded-lg" />
                ))}
              </div>
            </div>
          ) : isEmpty ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
              <div className="w-48 h-48 mb-6 flex items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
                <HardDrive className="w-24 h-24 text-blue-500 stroke-[1.25]" />
              </div>
              <h2 className="text-xl font-normal text-slate-800 dark:text-slate-100 mb-2">
                {vi ? 'Bắt đầu với HCDrive' : 'Get started with HCDrive'}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                {vi
                  ? 'Kết nối tài khoản Google Drive để bắt đầu quản lý và lưu trữ tệp tin của bạn trên HCDrive.'
                  : 'Connect your Google Drive accounts to begin organizing and storing your files on HCDrive.'}
              </p>
              <Button
                variant="filled"
                onClick={() => navigate('/accounts')}
                className="rounded-full px-6 py-2.5 text-sm font-medium"
              >
                {vi ? 'Kết nối tài khoản' : 'Connect Account'}
              </Button>
            </div>
          ) : (
            <>
              {/* 2. Suggested Folders Section */}
              {folders.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={toggleFoldersCollapse}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white mb-3 cursor-pointer group"
                  >
                    {foldersCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-600" />
                    )}
                    <span>{vi ? 'Thư mục đề xuất' : 'Suggested folders'}</span>
                  </button>

                  {!foldersCollapsed && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                      {folders.slice(0, 6).map((folder) => {
                        const isSelected = selectedFolder?.id === folder.id
                        return (
                          <div
                            key={`suggested-folder-${folder.id}`}
                            onClick={() => handleFolderClick(folder)}
                            onDoubleClick={() => handleOpenFolder(folder)}
                            onContextMenu={(e) => handleFolderMenu(e, folder)}
                            className={cn(
                              'group flex items-center justify-between h-14 px-3.5 rounded-xl cursor-pointer transition border',
                              isSelected
                                ? 'bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff] border-blue-400 ring-2 ring-blue-600 font-semibold'
                                : 'bg-[#f0f4f9] hover:bg-[#e9eef6] dark:bg-[#282a2d] dark:hover:bg-[#333538] border-slate-200/60 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                            )}
                            title={folder.name}
                          >
                            <div className="flex items-center gap-3 min-w-0 pr-1 flex-1">
                              <FolderIcon
                                className={cn(
                                  'h-5 w-5 shrink-0',
                                  folder.color ? folder.color : 'text-slate-600 dark:text-slate-300'
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <span className="truncate text-xs font-medium block">
                                  {folder.name}
                                </span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 block truncate">
                                  {vi ? 'trong Drive của tôi' : 'in My Drive'}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleFolderMenu(e, folder)}
                              className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                              title={vi ? 'Thao tác' : 'Actions'}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 3. Suggested Files Section */}
              {files.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={toggleFilesCollapse}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer group"
                    >
                      {filesCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-600" />
                      )}
                      <span>{vi ? 'Tệp đề xuất' : 'Suggested files'}</span>
                    </button>

                    <Link
                      to="/recent"
                      className="flex items-center gap-1 text-xs text-[#0b57d0] dark:text-[#a8c7fa] hover:underline font-medium"
                    >
                      <span>{vi ? 'Xem thêm' : 'View more'}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  {!filesCollapsed && (
                    viewMode === 'list' ? (
                      /* List View */
                      <div className="overflow-x-auto select-none">
                        <table className="w-full min-w-[680px] text-left text-xs sm:text-sm">
                          <thead>
                            <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                              <th className="py-2.5 pl-3 min-w-[220px] font-semibold">
                                {vi ? 'Tên' : 'Name'}
                              </th>
                              <th className="py-2.5 font-semibold">
                                {vi ? 'Lý do được đề xuất' : 'Reason suggested'}
                              </th>
                              <th className="py-2.5 font-semibold hidden md:table-cell">
                                {vi ? 'Chủ sở hữu' : 'Owner'}
                              </th>
                              <th className="py-2.5 font-semibold hidden lg:table-cell">
                                {vi ? 'Vị trí' : 'Location'}
                              </th>
                              <th className="py-2.5 pr-3 text-right font-semibold w-12" aria-label="Actions" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {files.slice(0, 10).map((file) => {
                              const isSelected = selectedFile?.id === file.id
                              const visual = getFileVisual(file.mimeType)
                              const Icon = visual.icon
                              return (
                                <tr
                                  key={`file-${file.id}`}
                                  onClick={() => handleFileClick(file)}
                                  onDoubleClick={() => handleViewFile(file)}
                                  onContextMenu={(e) => handleFileMenu(e, file)}
                                  className={cn(
                                    'h-12 cursor-pointer transition group',
                                    isSelected
                                      ? 'bg-[#c2e7ff]/50 dark:bg-[#004a77]/40 text-blue-900 dark:text-blue-100 font-medium'
                                      : 'hover:bg-slate-100/60 dark:hover:bg-[#282a2d]/60 text-slate-700 dark:text-slate-200'
                                  )}
                                >
                                  {/* Name */}
                                  <td className="py-2.5 pl-3 pr-4">
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

                                  {/* Reason */}
                                  <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                                    {formatReason(file)}
                                  </td>

                                  {/* Owner */}
                                  <td className="py-2.5 text-slate-500 dark:text-slate-400 hidden md:table-cell text-xs">
                                    <span className="truncate block" title={file.accountEmail ?? file.owner ?? 'Tôi'}>
                                      {file.accountEmail ? file.accountEmail.split('@')[0] : 'Tôi'}
                                    </span>
                                  </td>

                                  {/* Location */}
                                  <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs hidden lg:table-cell">
                                    <div className="flex items-center gap-1.5 truncate">
                                      <FolderIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                      <span className="truncate" title={file.folderName || (vi ? 'Drive của tôi' : 'My Drive')}>
                                        {file.folderName || (vi ? 'Drive của tôi' : 'My Drive')}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Actions */}
                                  <td className="py-2.5 pr-3 text-right">
                                    <button
                                      type="button"
                                      onClick={(e) => handleFileMenu(e, file)}
                                      className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title={vi ? 'Thao tác' : 'Actions'}
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* Grid View */
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
                        {files.slice(0, 10).map((file) => {
                          const isSelected = selectedFile?.id === file.id
                          const visual = getFileVisual(file.mimeType)
                          const Icon = visual.icon
                          const isImage = file.mimeType?.startsWith('image/')
                          const thumbUrl = file.providerFileId
                            ? `https://drive.google.com/thumbnail?id=${file.providerFileId}&sz=w400`
                            : undefined

                          return (
                            <div
                              key={`suggested-grid-${file.id}`}
                              onClick={() => handleFileClick(file)}
                              onDoubleClick={() => handleViewFile(file)}
                              onContextMenu={(e) => handleFileMenu(e, file)}
                              className={cn(
                                'group flex flex-col h-[220px] rounded-2xl cursor-pointer transition border p-3',
                                isSelected
                                  ? 'bg-[#c2e7ff]/30 border-blue-500 ring-2 ring-blue-600 dark:bg-[#004a77]/30'
                                  : 'bg-[#f0f4f9] hover:bg-[#e9eef6] dark:bg-[#282a2d] dark:hover:bg-[#333538] border-slate-200/60 dark:border-slate-800'
                              )}
                              title={file.name}
                            >
                              {/* Header */}
                              <div className="flex items-center justify-between gap-1.5 mb-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <Icon className={cn('h-4 w-4 shrink-0', visual.color)} />
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
                                    onClick={(e) => handleFileMenu(e, file)}
                                    className="p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Thumbnail preview */}
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
                                <div className={cn('flex flex-col items-center justify-center p-4', (thumbUrl || isImage) ? 'hidden' : '')}>
                                  <div className={cn('p-3 rounded-2xl', visual.bg)}>
                                    <Icon className={cn('h-8 w-8', visual.color)} />
                                  </div>
                                </div>
                              </div>

                              {/* Footer */}
                              <div className="mt-2 text-[10px] text-slate-400 truncate flex items-center gap-1">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span className="truncate">{formatReason(file)}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 4. Details Panel (i) */}
        <DetailsPanel
          open={detailOpen}
          file={selectedFile}
          folder={selectedFolder}
          selectedCount={selectedFile ? 1 : selectedFolder ? 1 : 0}
          totalSelectedBytes={BigInt(selectedFile?.sizeBytes || 0)}
          onClose={() => setDetailOpen(false)}
          onShare={() => {
            if (selectedFile) {
              setShareTarget({ kind: 'file', id: selectedFile.id || '', name: selectedFile.name, isFolder: false })
            } else if (selectedFolder) {
              setShareTarget({ kind: 'folder', id: selectedFolder.id || '', name: selectedFolder.name, isFolder: true })
            }
          }}
          lang={lang}
        />
      </div>

      {/* 5. Context Menus */}
      <FileContextMenu
        x={fileContextMenu.x}
        y={fileContextMenu.y}
        file={fileContextMenu.file}
        onClose={() => setFileContextMenu({ x: 0, y: 0, file: null })}
        onView={() => fileContextMenu.file && handleViewFile(fileContextMenu.file)}
        onDownload={() => fileContextMenu.file && handleDownloadFile(fileContextMenu.file)}
        onDetails={() => {
          setDetailOpen(true)
          setFileContextMenu({ x: 0, y: 0, file: null })
        }}
        onShare={() => {
          if (selectedFile) {
            setShareTarget({ kind: 'file', id: selectedFile.id || '', name: selectedFile.name, isFolder: false })
          }
          setFileContextMenu({ x: 0, y: 0, file: null })
        }}
        onCopyLink={() => {
          if (selectedFile?.webViewLink) {
            navigator.clipboard.writeText(selectedFile.webViewLink)
            showSnackbar(vi ? 'Đã sao chép đường liên kết' : 'Link copied to clipboard')
          }
          setFileContextMenu({ x: 0, y: 0, file: null })
        }}
        onStar={handleToggleStar}
      />

      <FolderContextMenu
        x={folderContextMenu.x}
        y={folderContextMenu.y}
        folder={folderContextMenu.folder}
        onClose={() => setFolderContextMenu({ x: 0, y: 0, folder: null })}
        onOpen={() => {
          if (folderContextMenu.folder) handleOpenFolder(folderContextMenu.folder)
          setFolderContextMenu({ x: 0, y: 0, folder: null })
        }}
        onInvite={() => {
          if (selectedFolder) {
            setShareTarget({ kind: 'folder', id: selectedFolder.id || '', name: selectedFolder.name, isFolder: true })
          }
          setFolderContextMenu({ x: 0, y: 0, folder: null })
        }}
        onShare={() => {
          if (selectedFolder) {
            setShareTarget({ kind: 'folder', id: selectedFolder.id || '', name: selectedFolder.name, isFolder: true })
          }
          setFolderContextMenu({ x: 0, y: 0, folder: null })
        }}
        onCopyLink={() => {
          const folder = folderContextMenu.folder
          if (folder?.id) {
            navigator.clipboard.writeText(`${window.location.origin}/all-files?folderId=${folder.id}`)
              .then(() => showSnackbar(vi ? 'Đã sao chép đường liên kết thư mục' : 'Folder link copied'))
              .catch(() => showSnackbar(vi ? 'Không sao chép được' : 'Could not copy'))
          }
          setFolderContextMenu({ x: 0, y: 0, folder: null })
        }}
      />

      {/* 6. Google File Preview */}
      <GoogleFilePreview
        open={previewOpen}
        file={selectedFile}
        files={files}
        onClose={() => setPreviewOpen(false)}
        onShare={(f) => setShareTarget({ kind: 'file', id: f.id || '', name: f.name, isFolder: false })}
        onDownload={(f) => handleDownloadFile(f)}
        onNavigateFile={(f) => setSelectedFile(f)}
      />

      {/* 7. Share Dialog */}
      {shareTarget && (
        <ShareDialog
          target={shareTarget}
          onClose={() => setShareTarget(null)}
          lang={lang}
        />
      )}
    </div>
  )
}
