import { useEffect, useState, useMemo, useRef, type MouseEvent } from 'react'
import { Clock } from 'lucide-react'
import { apiFetch, API_URL } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { getAccessToken } from '@/lib/auth'
import { DriveToolbar } from '@/components/drive/DriveToolbar'
import { DriveListView } from '@/components/drive/DriveListView'
import { DriveGridView } from '@/components/drive/DriveGridView'
import { DetailsPanel } from '@/components/drive/DetailsPanel'
import { FileContextMenu } from '@/components/drive/FileContextMenu'
import { CopyToDriveModal, type CopyToDriveItem } from '@/components/drive/CopyToDriveModal'
import { GoogleFilePreview } from '@/components/drive/GoogleFilePreview'
import { ShareDialog, type ShareTarget } from '@/components/drive/ShareDialog'
import { FilterChips, type FilterValues } from '@/components/drive/FilterChips'
import type { FileItem } from '@/data/drive-data'

export function RecentPage() {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const vi = lang === 'vi'

  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [activeFile, setActiveFile] = useState<FileItem | null>(null)
  const lastSelectedFileIdRef = useRef<string | null>(null)

  // Filters
  const [filters, setFilters] = useState<FilterValues>({
    kind: null,
    accountId: null,
    dateRange: null,
  })

  // Modals & Context Menus
  const [previewOpen, setPreviewOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [connectedAccounts, setConnectedAccounts] = useState<any[]>([])
  const [copyToDriveOpen, setCopyToDriveOpen] = useState(false)
  const [copyToDriveItem, setCopyToDriveItem] = useState<CopyToDriveItem | null>(null)

  useEffect(() => {
    apiFetch<{ accounts: any[] }>('/connected-accounts')
      .then((data) => setConnectedAccounts(data.accounts || []))
      .catch(() => setConnectedAccounts([]))
  }, [])

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    file: FileItem | null
  }>({ x: 0, y: 0, file: null })

  async function loadRecent() {
    setLoading(true)
    try {
      const data = await apiFetch<{ files: any[] }>('/files/recent')
      const mapped: FileItem[] = (data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size || '--',
        sizeBytes: f.sizeBytes ? String(f.sizeBytes) : '0',
        date: f.viewedByMeTime || f.modifiedTime,
        createdAt: f.viewedByMeTime || f.modifiedTime,
        accountEmail: f.accountEmail,
        accountId: f.accountId,
        webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
        providerFileId: f.id,
        starred: Boolean(f.starred),
      }))
      setFiles(mapped)
    } catch (err: any) {
      console.warn('Failed to load recent files:', err)
      showSnackbar(vi ? 'Không thể tải lịch sử tệp gần đây' : 'Failed to load recent files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRecent()
  }, [])

  // Accounts for FilterChips
  const filterAccounts = useMemo(() => {
    const map = new Map<string, { id: string; email: string }>()
    for (const f of files) {
      if (f.accountId && f.accountEmail && !map.has(f.accountId)) {
        map.set(f.accountId, { id: f.accountId, email: f.accountEmail })
      }
    }
    return Array.from(map.values())
  }, [files])

  // Filtered files
  const filteredFiles = useMemo(() => {
    return files.filter((file) => {
      // 1. Kind filter
      if (filters.kind) {
        const mime = file.mimeType || ''
        if (filters.kind === 'image' && !mime.startsWith('image/')) return false
        if (filters.kind === 'video' && !mime.startsWith('video/')) return false
        if (filters.kind === 'pdf' && !mime.includes('pdf')) return false
        if (filters.kind === 'doc' && !mime.includes('document') && !mime.includes('word') && !mime.startsWith('text/')) return false
        if (filters.kind === 'sheet' && !mime.includes('sheet') && !mime.includes('excel') && mime !== 'text/csv') return false
        if (filters.kind === 'slide' && !mime.includes('presentation') && !mime.includes('powerpoint')) return false
        if (filters.kind === 'archive' && !mime.includes('zip') && !mime.includes('rar') && !mime.includes('tar') && !mime.includes('7z')) return false
      }
      // 2. Account filter
      if (filters.accountId && file.accountId !== filters.accountId) {
        return false
      }
      // 3. Date range filter
      const range = filters.datePreset || filters.dateRange
      if (range) {
        const fileTime = new Date(file.createdAt || file.date || 0).getTime()
        const now = Date.now()
        if (range === 'today' && now - fileTime > 24 * 60 * 60 * 1000) return false
        if (range === '7d' && now - fileTime > 7 * 24 * 60 * 60 * 1000) return false
        if (range === '30d' && now - fileTime > 30 * 24 * 60 * 60 * 1000) return false
        if (range === 'this_year') {
          const year = new Date().getFullYear()
          if (new Date(fileTime).getFullYear() !== year) return false
        }
      } else if (filters.startDate || filters.endDate) {
        const fileTime = new Date(file.createdAt || file.date || 0).getTime()
        if (filters.startDate && fileTime < new Date(filters.startDate).getTime()) return false
        if (filters.endDate && fileTime > new Date(filters.endDate).getTime()) return false
      }
      // 4. Size filter
      const size = Number(file.sizeBytes || 0)
      if (filters.minSize && size < Number(filters.minSize)) return false
      if (filters.maxSize && size > Number(filters.maxSize)) return false
      return true
    })
  }, [files, filters])

  function handleToggleFile(file: FileItem) {
    if (!file.id) return
    setActiveFile(file)
    lastSelectedFileIdRef.current = file.id
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (next.has(file.id!)) next.delete(file.id!)
      else next.add(file.id!)
      return next
    })
  }

  function handleSelectFile(file: FileItem, event: MouseEvent) {
    if (!file.id) return
    setActiveFile(file)
    if (event.metaKey || event.ctrlKey) {
      handleToggleFile(file)
      return
    }

    if (event.shiftKey && lastSelectedFileIdRef.current) {
      const lastId = lastSelectedFileIdRef.current
      const prevIdx = filteredFiles.findIndex((f) => f.id === lastId)
      const currIdx = filteredFiles.findIndex((f) => f.id === file.id)

      if (prevIdx !== -1 && currIdx !== -1) {
        const start = Math.min(prevIdx, currIdx)
        const end = Math.max(prevIdx, currIdx)
        const rangeIds = filteredFiles.slice(start, end + 1).map((f) => f.id!).filter(Boolean)
        setSelectedFileIds((prev) => {
          const next = new Set(prev)
          rangeIds.forEach((id) => next.add(id))
          return next
        })
        return
      }
    }

    lastSelectedFileIdRef.current = file.id
    setSelectedFileIds(new Set([file.id]))
  }

  function handleToggleAll() {
    if (selectedFileIds.size === filteredFiles.length) {
      setSelectedFileIds(new Set())
    } else {
      setSelectedFileIds(new Set(filteredFiles.map((f) => f.id!).filter(Boolean)))
    }
  }

  function handleViewFile(file: FileItem) {
    setActiveFile(file)
    setPreviewOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function handleDownloadFile(file?: FileItem) {
    const target = file || activeFile
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
    } catch {
      showSnackbar(vi ? 'Tải tệp thất bại' : 'Download failed')
    }
  }

  async function handleToggleStar(targetFile?: FileItem) {
    const f = targetFile || activeFile
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

  function handleFileMenu(e: MouseEvent<HTMLElement>, file: FileItem) {
    e.preventDefault()
    e.stopPropagation()
    setActiveFile(file)
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const singleSelectedFile =
    selectedFileIds.size === 1
      ? files.find((f) => f.id === Array.from(selectedFileIds)[0]) || activeFile
      : activeFile

  return (
    <div className="flex h-full flex-col min-w-0 select-none">
      {/* 1. Drive Toolbar */}
      <DriveToolbar
        title={vi ? 'Gần đây' : 'Recent'}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        detailOpen={detailOpen}
        onToggleDetail={() => setDetailOpen(!detailOpen)}
        lang={lang}
      />

      {/* 2. Filter Chips */}
      <div className="px-4 sm:px-6 pt-2 pb-1">
        <FilterChips
          filters={filters}
          accounts={filterAccounts}
          onFilterChange={(next) => setFilters((prev) => ({ ...prev, ...next }))}
          onClearFilters={() => setFilters({})}
          lang={lang}
        />
      </div>

      {/* 3. Main Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2">
          {loading ? (
            <div className="space-y-3 animate-pulse pt-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
              ))}
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto">
              <div className="w-40 h-40 mb-4 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800/60">
                <Clock className="w-20 h-20 text-slate-400 stroke-[1.25]" />
              </div>
              <h3 className="text-lg font-normal text-slate-800 dark:text-slate-100 mb-1">
                {vi ? 'Chưa có tệp nào gần đây' : 'No recent files'}
              </h3>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {vi
                  ? 'Các tệp bạn vừa mở, chỉnh sửa hoặc tải lên sẽ xuất hiện tại đây.'
                  : 'Files you recently viewed, edited or uploaded will appear here.'}
              </p>
            </div>
          ) : viewMode === 'list' ? (
            <DriveListView
              files={filteredFiles}
              folders={[]}
              selectedFileIds={selectedFileIds}
              allSelected={selectedFileIds.size === filteredFiles.length && filteredFiles.length > 0}
              onToggleAll={handleToggleAll}
              onSelectFile={handleSelectFile}
              onToggleFile={handleToggleFile}
              onSelectFolder={() => {}}
              onOpenFolder={() => {}}
              onFolderMenu={() => {}}
              onViewFile={handleViewFile}
              onFileMenu={handleFileMenu}
              columns={['name', 'owner', 'last_modified', 'size']}
              groupBy="date"
              lang={lang}
            />
          ) : (
            <DriveGridView
              files={filteredFiles}
              folders={[]}
              selectedFileIds={selectedFileIds}
              onSelectFile={handleSelectFile}
              onToggleFile={handleToggleFile}
              onSelectFolder={() => {}}
              onOpenFolder={() => {}}
              onFolderMenu={() => {}}
              onViewFile={handleViewFile}
              onFileMenu={handleFileMenu}
              onDropItem={() => {}}
              lang={lang}
            />
          )}
        </div>

        {/* 4. Details Panel (i) */}
        <DetailsPanel
          open={detailOpen}
          file={singleSelectedFile}
          folder={null}
          selectedCount={selectedFileIds.size}
          totalSelectedBytes={BigInt(singleSelectedFile?.sizeBytes || 0)}
          onClose={() => setDetailOpen(false)}
          onShare={() => {
            if (singleSelectedFile) {
              setShareTarget({ kind: 'file', id: singleSelectedFile.id || '', name: singleSelectedFile.name, isFolder: false })
            }
          }}
          lang={lang}
        />
      </div>

      {/* 5. Context Menu */}
      <FileContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        file={contextMenu.file}
        onClose={() => setContextMenu({ x: 0, y: 0, file: null })}
        onView={() => activeFile && handleViewFile(activeFile)}
        onDownload={() => activeFile && handleDownloadFile(activeFile)}
        onDetails={() => {
          setDetailOpen(true)
          setContextMenu({ x: 0, y: 0, file: null })
        }}
        onShare={() => {
          if (activeFile) {
            setShareTarget({ kind: 'file', id: activeFile.id || '', name: activeFile.name, isFolder: false })
          }
          setContextMenu({ x: 0, y: 0, file: null })
        }}
        onCopyLink={() => {
          if (activeFile?.webViewLink) {
            navigator.clipboard.writeText(activeFile.webViewLink)
            showSnackbar(vi ? 'Đã sao chép đường liên kết' : 'Link copied to clipboard')
          }
          setContextMenu({ x: 0, y: 0, file: null })
        }}
        onStar={handleToggleStar}
        onCopyToDrive={() => {
          if (contextMenu.file?.id) {
            setCopyToDriveItem({
              type: 'file',
              id: contextMenu.file.id,
              name: contextMenu.file.name,
              currentAccountId: contextMenu.file.accountId,
            })
            setCopyToDriveOpen(true)
            setContextMenu({ x: 0, y: 0, file: null })
          }
        }}
      />

      <CopyToDriveModal
        open={copyToDriveOpen}
        onClose={() => setCopyToDriveOpen(false)}
        item={copyToDriveItem}
        connectedAccounts={connectedAccounts}
        onSuccess={loadRecent}
      />

      {/* 6. Google File Preview */}
      <GoogleFilePreview
        open={previewOpen}
        file={activeFile}
        files={filteredFiles}
        onClose={() => setPreviewOpen(false)}
        onShare={(f) => setShareTarget({ kind: 'file', id: f.id || '', name: f.name, isFolder: false })}
        onDownload={(f) => handleDownloadFile(f)}
        onNavigateFile={(f) => setActiveFile(f)}
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
