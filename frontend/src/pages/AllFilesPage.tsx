import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardPaste, FolderPlus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DummyModal } from '@/components/drive/DummyModal'
import { EmptyAreaContextMenu } from '@/components/drive/EmptyAreaContextMenu'
import { FileContextMenu } from '@/components/drive/FileContextMenu'
import { ShareDialog, type ShareTarget } from '@/components/drive/ShareDialog'
import { FolderContextMenu } from '@/components/drive/FolderContextMenu'
import { defaultFolderColor, defaultFolderIconUrl, folderColorOptions, folderIconOptions, normalizeFolderColor } from '@/components/drive/FolderVisual'
import { DriveToolbar, type SortField, type SortDirection } from '@/components/drive/DriveToolbar'
import { FilterChips, type FilterParams } from '@/components/drive/FilterChips'
import { parseFilters } from '@/lib/driveFilters'
import { SelectionBar } from '@/components/drive/SelectionBar'
import { DriveGridView } from '@/components/drive/DriveGridView'
import { DriveListView } from '@/components/drive/DriveListView'
import { DetailsPanel } from '@/components/drive/DetailsPanel'
import { GoogleFilePreview } from '@/components/drive/GoogleFilePreview'
import { Input } from '@/components/ui/input'
import { API_URL, apiFetch, formatBytes, formatDate } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { useUpload } from '@/context/UploadContext'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'

type BackendFile = { id: string; name: string; mimeType: string; sizeBytes: string; createdAt: string; folderId?: string | null; providerFileId?: string; connectedAccount?: { email: string; provider: string }; folder?: { id: string; name: string } | null; webViewLink?: string | null; starred?: boolean; thumbnailUrl?: string | null }
type BackendFolder = { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; updatedAt: string; accounts?: { id: string; email: string }[]; path?: { id: string; name: string }[] }
type ConnectedAccount = { id: string; provider: string; email: string; displayName?: string | null; status: string }

function mimeToKind(mimeType: string): FileItem['kind'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.includes('pdf')) return 'pdf'
  if (
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv'
  ) return 'sheet'
  if (
    mimeType === 'application/vnd.google-apps.presentation' ||
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint')
  ) return 'slide'
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z') ||
    mimeType.includes('tar')
  ) return 'archive'
  return 'doc'
}

function providerLabel(provider: string | undefined) {
  if (provider === 's3') return 'S3 Storage'
  return 'Google Drive'
}

function mapFile(file: BackendFile): FileItem {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    accountEmail: file.connectedAccount?.email,
    accountProvider: providerLabel(file.connectedAccount?.provider),
    date: formatDate(file.createdAt),
    size: formatBytes(file.sizeBytes),
    access: file.connectedAccount?.email ?? providerLabel(file.connectedAccount?.provider),
    kind: mimeToKind(file.mimeType),
    shared: 1,
    folderId: file.folderId,
    folderName: file.folder?.name,
    providerFileId: file.providerFileId,
    // HCDrive's signed thumbnail proxy, so previews show without a Google sign-in in this browser.
    thumbnailLink: file.thumbnailUrl ? `${API_URL}${file.thumbnailUrl}` : null,
    webViewLink: file.webViewLink || (file.providerFileId ? `https://drive.google.com/file/d/${file.providerFileId}/view` : null),
    starred: Boolean(file.starred),
  }
}

function mapFolder(folder: BackendFolder): FolderItem {
  return { id: folder.id, name: folder.name, color: folder.color, iconUrl: folder.iconUrl, parentId: folder.parentId, providerFolderId: folder.providerFolderId, updated: `Updated ${formatDate(folder.updatedAt)}`, updatedAt: folder.updatedAt, accounts: folder.accounts || [], path: folder.path }
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

// Keyboard shortcuts must not fire while the user is typing (Ctrl+X / Ctrl+V in the search box, a rename field, ...).
function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable))
}

// "Parent / Child / Folder" for folder pickers; merged folders from several accounts can share a name.
function folderPathLabel(folder: FolderItem, foldersById: Map<string | undefined, FolderItem>) {
  const names: string[] = []
  const seen = new Set<string>()
  let current: FolderItem | undefined = folder
  while (current?.id && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parentId ? foldersById.get(current.parentId) : undefined
  }
  return names.join(' / ')
}



function FolderAppearanceFields({ color, iconUrl, onColorChange, onIconChange }: { color: string; iconUrl: string; onColorChange: (color: string) => void; onIconChange: (iconUrl: string) => void }) {
  const normalizedColor = normalizeFolderColor(color)
  return (
    <div className="grid gap-4">
      <label className="grid gap-2 text-sm font-semibold">Folder Color<Input type="color" value={normalizedColor} onChange={(event) => onColorChange(event.target.value)} className="h-12 p-1" /></label>
      <div className="flex flex-wrap gap-2">{folderColorOptions.map((option) => <button key={option} type="button" onClick={() => onColorChange(option)} className={normalizedColor === option ? 'h-8 w-8 rounded-lg border-2 border-blue-600' : 'h-8 w-8 rounded-lg border border-slate-200'} style={{ backgroundColor: option }} aria-label={`Use ${option} folder color`} />)}</div>
      <div className="grid gap-2 text-sm font-semibold"><span>Folder Icon</span><div className="grid grid-cols-4 gap-2 sm:grid-cols-8">{folderIconOptions.map((option) => <button key={option.url} type="button" onClick={() => onIconChange(option.url)} className={iconUrl === option.url ? 'flex h-12 items-center justify-center rounded-xl border-2 border-blue-600 bg-blue-50 p-2' : 'flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-2 hover:bg-slate-100'} title={option.label} aria-label={`Use ${option.label} icon`}><img src={`${option.url}?color=${encodeURIComponent(normalizedColor)}`} alt="" className="h-6 w-6" /></button>)}</div></div>
    </div>
  )
}

export function AllFilesPage() {
  const { t, lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeFolderId = searchParams.get('folderId')
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const [uploadOpen, setUploadOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [folderRenameOpen, setFolderRenameOpen] = useState(false)
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [allFolders, setAllFolders] = useState<FolderItem[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [isUploadDragging, setIsUploadDragging] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState(defaultFolderColor)
  const [folderIconUrl, setFolderIconUrl] = useState(defaultFolderIconUrl)
  const [renameValue, setRenameValue] = useState('')
  const [folderRenameValue, setFolderRenameValue] = useState('')
  const [folderRenameColor, setFolderRenameColor] = useState(defaultFolderColor)
  const [folderRenameIconUrl, setFolderRenameIconUrl] = useState(defaultFolderIconUrl)
  const [activeFile, setActiveFile] = useState<FileItem | null>(null)
  const [activeFolderForMenu, setActiveFolderForMenu] = useState<FolderItem | null>(null)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [cutFolder, setCutFolder] = useState<FolderItem | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileItem | null }>({ x: 0, y: 0, file: null })
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folder: FolderItem | null }>({ x: 0, y: 0, folder: null })
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number; open: boolean }>({ x: 0, y: 0, open: false })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncingDrive, setSyncingDrive] = useState(false)
  const { uploadFiles, uploadBatch } = useUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviteTargetType, setInviteTargetType] = useState<'file' | 'folder'>('file')
  const [inviteTargetId, setInviteTargetId] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviting, setInviting] = useState(false)
  const { setHeaderActions } = useDriveLayoutActions()
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([])
  const [selectedTargetAccountId, setSelectedTargetAccountId] = useState('')
  const [selectedFolderForDetails, setSelectedFolderForDetails] = useState<FolderItem | null>(null)
  const lastSelectedFileIdRef = useRef<string | null>(null)

  // View mode state (grid vs list)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('hcdrive:drive-view') || localStorage.getItem('9drive:drive-view')
    return saved === 'list' ? 'list' : 'grid'
  })

  function handleViewModeChange(mode: 'grid' | 'list') {
    setViewMode(mode)
    localStorage.setItem('hcdrive:drive-view', mode)
    localStorage.setItem('9drive:drive-view', mode)
  }

  // Sort state
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  function handleSortChange(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // Listen to new action event from DriveLayout sidebar
  useEffect(() => {
    function handleNewAction(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail === 'folder') setFolderOpen(true)
      else if (detail === 'upload') fileInputRef.current?.click()
      else if (detail === 'upload-folder') folderInputRef.current?.click()
    }
    window.addEventListener('hcdrive:new', handleNewAction)
    window.addEventListener('9drive:new', handleNewAction)
    return () => {
      window.removeEventListener('hcdrive:new', handleNewAction)
      window.removeEventListener('9drive:new', handleNewAction)
    }
  }, [])

  function handleFileInputSelected(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return
    const filesArray = Array.from(fileList)
    event.target.value = ''
    uploadFiles(filesArray, activeFolderId ?? null, selectedTargetAccountId || null)
  }

  async function handleFolderInputSelected(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return
    const filesArray = Array.from(fileList)
    event.target.value = ''

    setLoading(true)
    showSnackbar(lang === 'vi' ? `Đang tạo cấu trúc thư mục (${filesArray.length} tệp)...` : `Creating folder structure (${filesArray.length} files)...`)

    try {
      const folderMap = new Map<string, string>()
      const currentRootParentId = activeFolderId ?? null
      const uploadItems: { file: File; folderId: string | null }[] = []

      for (const file of filesArray) {
        const relativePath = ((file as any).webkitRelativePath as string) || file.name
        const parts = relativePath.split('/')

        if (parts.length > 1) {
          const dirParts = parts.slice(0, -1)
          let currentParent = currentRootParentId
          let accumulatedPath = ''

          for (const dirName of dirParts) {
            accumulatedPath = accumulatedPath ? `${accumulatedPath}/${dirName}` : dirName
            if (folderMap.has(accumulatedPath)) {
              currentParent = folderMap.get(accumulatedPath)!
            } else {
              const existing = allFolders.find(f => f.name === dirName && (f.parentId ?? null) === currentParent)
              if (existing?.id) {
                folderMap.set(accumulatedPath, existing.id)
                currentParent = existing.id
              } else {
                const res = await apiFetch<{ folder: { id: string } }>('/folders', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: dirName,
                    parentId: currentParent,
                  })
                })
                const newFolderId = res.folder.id
                folderMap.set(accumulatedPath, newFolderId)
                currentParent = newFolderId
              }
            }
          }
          uploadItems.push({ file, folderId: currentParent })
        } else {
          uploadItems.push({ file, folderId: currentRootParentId })
        }
      }

      await reloadAfterFolderChange()
      await loadFolderTree()

      await uploadBatch(uploadItems, selectedTargetAccountId || null)
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Tải thư mục lên thất bại' : 'Failed to upload folder'))
    } finally {
      setLoading(false)
    }
  }

  async function downloadFolder(folder?: FolderItem | null) {
    const target = folder ?? activeFolderForMenu
    if (!target?.id) return
    setFolderContextMenu({ x: 0, y: 0, folder: null })
    try {
      showSnackbar(lang === 'vi' ? 'Đang nén thư mục và tải xuống...' : 'Zipping folder and downloading...')
      const response = await fetch(`${API_URL}/folders/${target.id}/download`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` }
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.message || (lang === 'vi' ? 'Tải thư mục thất bại' : 'Download folder failed'))
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${target.name}.zip`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      showSnackbar(lang === 'vi' ? 'Tải thư mục hoàn tất' : 'Folder downloaded')
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Tải thư mục thất bại' : 'Folder download failed'))
    }
  }

  function handleSelectFile(file: FileItem, event: MouseEvent) {
    if (!file.id) return
    setSelectedFolderForDetails(null)
    setActiveFile(file)

    if (event.ctrlKey || event.metaKey) {
      toggleFileSelection(file)
      return
    }

    if (event.shiftKey && lastSelectedFileIdRef.current) {
      const lastId = lastSelectedFileIdRef.current
      const currentList = sortedFiles && sortedFiles.length > 0 ? sortedFiles : files
      const prevIdx = currentList.findIndex((f) => f.id === lastId)
      const currIdx = currentList.findIndex((f) => f.id === file.id)

      if (prevIdx !== -1 && currIdx !== -1) {
        const start = Math.min(prevIdx, currIdx)
        const end = Math.max(prevIdx, currIdx)
        const rangeIds = currentList.slice(start, end + 1).map((f) => f.id!).filter(Boolean)
        setSelectedFileIds((current) => {
          const next = new Set(current)
          rangeIds.forEach((id) => next.add(id))
          return next
        })
        return
      }
    }

    lastSelectedFileIdRef.current = file.id
    setSelectedFileIds(new Set([file.id]))
  }

  function handleSelectFolder(folder: FolderItem, _event: MouseEvent) {
    if (!folder.id) return
    setSelectedFileIds(new Set())
    setActiveFile(null)
    setSelectedFolderForDetails(folder)
    setActiveFolderForMenu(folder)
  }

  function handlePageDragOver(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsUploadDragging(true)
    }
  }

  function handlePageDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setIsUploadDragging(false)
  }

  function handlePageDrop(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      event.preventDefault()
      setIsUploadDragging(false)
      selectUploadFiles(event.dataTransfer.files)
      setUploadOpen(true)
    }
  }

  const hasChips = Boolean(
    searchParams.get('kind') ||
    searchParams.get('accountId') ||
    searchParams.get('minSize') ||
    searchParams.get('maxSize') ||
    searchParams.get('startDate') ||
    searchParams.get('endDate')
  )

  const isSearching = hasChips || Boolean(searchQuery)

  const filterKey = useMemo(() => {
    const p = new URLSearchParams(searchParams)
    p.delete('preview')
    p.sort()
    return p.toString()
  }, [searchParams])

  // datePreset is read too, so the date chip can show "Last 7 days" instead of a raw range.
  const currentFilters: FilterParams = useMemo(() => parseFilters(searchParams), [searchParams])

  function handleFilterChange(next: Partial<FilterParams>) {
    const params = new URLSearchParams(searchParams)
    Object.entries(next).forEach(([key, val]) => {
      if (val) params.set(key, val)
      else params.delete(key)
    })
    setSearchParams(params)
  }

  function handleClearFilters() {
    // Keeps the open folder and the search text; drops every filter.
    const params = new URLSearchParams()
    if (activeFolderId) params.set('folderId', activeFolderId)
    if (searchQuery) params.set('q', searchQuery)
    setSearchParams(params)
  }

  async function loadFiles() {
    const kind = searchParams.get('kind')
    const accountId = searchParams.get('accountId')
    const minSize = searchParams.get('minSize')
    const maxSize = searchParams.get('maxSize')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (kind === 'folder') {
      setFiles([])
      return
    }

    const params = new URLSearchParams()
    // Search and filters cover the whole merged Drive (like Google Drive); otherwise list the open folder.
    if (!isSearching) params.set('folderId', activeFolderId || 'root')

    if (searchQuery) params.set('q', searchQuery)
    // Also match words inside the files (Google's full-text index), like Google Drive's search.
    if (searchQuery) params.set('content', '1')
    if (kind) params.set('kind', kind)
    if (accountId) params.set('accountId', accountId)
    if (minSize) params.set('minSize', minSize)
    if (maxSize) params.set('maxSize', maxSize)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    const query = params.toString()
    const path = query ? `/files?${query}` : '/files'
    const data = await apiFetch<{ files: BackendFile[] }>(path)
    // Same default order as Google Drive: by name, numbers compared as numbers.
    setFiles(data.files.map(mapFile).sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })))
  }

  async function loadFolders() {
    const kind = searchParams.get('kind')
    const minSize = searchParams.get('minSize')
    const maxSize = searchParams.get('maxSize')

    // A type other than "folder", or a size range, only matches files.
    if ((kind && kind !== 'folder') || minSize || maxSize) {
      setFolders([])
      return
    }

    let path = activeFolderId ? `/folders?parentId=${encodeURIComponent(activeFolderId)}` : '/folders'
    if (isSearching) {
      const params = new URLSearchParams()
      if (searchQuery) params.set('q', searchQuery)
      for (const key of ['accountId', 'startDate', 'endDate']) {
        const value = searchParams.get(key)
        if (value) params.set(key, value)
      }
      // "Type: folder" alone lists every folder.
      path = params.toString() ? `/folders?${params}` : '/folders?all=1'
    }
    const data = await apiFetch<{ folders: BackendFolder[] }>(path)
    setFolders(data.folders.map(mapFolder))
  }

  // The whole merged tree, for breadcrumbs and folder pickers. Reloaded only when folders change,
  // not on every navigation.
  async function loadFolderTree() {
    const data = await apiFetch<{ folders: BackendFolder[] }>('/folders?all=1')
    setAllFolders(data.folders.map(mapFolder))
  }

  async function loadAll() {
    await Promise.all([loadFiles(), loadFolders()])
  }

  async function reloadAfterFolderChange() {
    await Promise.all([loadFiles(), loadFolders(), loadFolderTree()])
  }

  // Handle URL ?preview=<id>
  useEffect(() => {
    const previewParam = searchParams.get('preview')
    if (previewParam && files.length > 0 && !previewOpen) {
      const match = files.find((f) => f.id === previewParam || f.providerFileId === previewParam)
      if (match) {
        setActiveFile(match)
        setPreviewOpen(true)
      }
    }
  }, [searchParams, files, previewOpen])

  // Timers and window listeners must reload the folder that is open now, not the one open when they were set up.
  const loadAllRef = useRef(loadAll)
  loadAllRef.current = loadAll
  const reloadAfterFolderChangeRef = useRef(reloadAfterFolderChange)
  reloadAfterFolderChangeRef.current = reloadAfterFolderChange
  const activeFolderIdRef = useRef(activeFolderId)
  activeFolderIdRef.current = activeFolderId

  // Reads the open folder straight from Google Drive in every account (like the Live Explorer on the
  // Quota page) and reloads when Drive differs from the saved copy shown first.
  async function refreshFromDrive() {
    const folderId = activeFolderIdRef.current
    const result = await apiFetch<{ changed: boolean; errors: string[] }>('/folders/refresh', { method: 'POST', body: JSON.stringify({ parentId: folderId ?? null }) })
    if (result.changed && activeFolderIdRef.current === folderId) await reloadAfterFolderChangeRef.current()
    if (result.errors.length > 0) setMessage(`${lang === 'vi' ? 'Không đọc được từ' : 'Could not read from'} ${result.errors.join('; ')}`)
  }

  async function handleDropItem(fileId: string, targetFolderId: string) {
    const fileIds = selectedFileIds.has(fileId) ? Array.from(selectedFileIds) : [fileId]
    setLoading(true)
    setMessage('')
    try {
      await apiFetch('/files/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds, folderId: targetFolderId })
      })
      showSnackbar(lang === 'vi' ? `Đã di chuyển ${fileIds.length} mục` : `Moved ${fileIds.length} item(s)`)
      loadAll().catch(() => undefined)
      setSelectedFileIds(new Set())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to move items')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load files'))
    setSelectedFileIds(new Set())
    setSelectedFolderForDetails(null)
    if (!isSearching) refreshFromDrive().catch(() => undefined)
  }, [filterKey])

  useEffect(() => {
    loadFolderTree().catch(() => undefined)
  }, [])

  useEffect(() => {
    let syncing = false
    function runAutoSync() {
      if (syncing || document.visibilityState !== 'visible') return
      syncing = true
      apiFetch<{ results: { created: number; updated: number; deleted: number }[] }>('/files/sync-google', {
        method: 'POST',
        body: JSON.stringify({})
      })
        .then((res) => {
          const hasChanges = res?.results?.some((r) => r.created > 0 || r.updated > 0 || r.deleted > 0)
          if (hasChanges) {
            reloadAfterFolderChangeRef.current().catch(() => undefined)
            window.dispatchEvent(new Event('hcdrive:storage-changed'))
            window.dispatchEvent(new Event('9drive:storage-changed'))
          }
        })
        .catch(() => undefined)
        .finally(() => { syncing = false })
    }
    function refreshOnFocus() {
      refreshFromDrive().catch(() => undefined)
    }

    // The full sync walks every file of every account, so it runs once per visit and every 10 minutes;
    // coming back to the tab only re-reads the open folder.
    runAutoSync()
    window.addEventListener('focus', refreshOnFocus)
    const interval = setInterval(runAutoSync, 10 * 60_000)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    async function loadConnectedAccounts() {
      try {
        const data = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
        setConnectedAccounts(data.accounts || [])
      } catch (error) {
        console.error('Failed to load connected accounts:', error)
      }
    }
    loadConnectedAccounts()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextMenu({ x: 0, y: 0, file: null })
      if (event.key === 'Escape') setFolderContextMenu({ x: 0, y: 0, folder: null })
      if (event.key === 'Escape') setEmptyContextMenu({ x: 0, y: 0, open: false })
      if (isTypingTarget(event.target)) return
      if (event.ctrlKey && event.key.toLowerCase() === 'x' && selectedFolderForDetails) {
        event.preventDefault()
        cutSelectedFolder(selectedFolderForDetails)
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'v' && cutFolder) {
        event.preventDefault()
        pasteFolder().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to paste folder'))
      }
    }

    function onOpenMoveShortcut(e: Event) {
      const file = (e as CustomEvent).detail as FileItem
      setActiveFile(file)
      setSelectedFolderId(file.folderId || '')
      setMoveOpen(true)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('hcdrive:open-move-modal', onOpenMoveShortcut)
    window.addEventListener('9drive:open-move-modal', onOpenMoveShortcut)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hcdrive:open-move-modal', onOpenMoveShortcut)
      window.removeEventListener('9drive:open-move-modal', onOpenMoveShortcut)
    }
  }, [selectedFolderForDetails, cutFolder, activeFolderId])

  async function createFolder(event: FormEvent) {
    event.preventDefault()
    try {
      await apiFetch('/folders', { method: 'POST', body: JSON.stringify({ name: folderName, color: folderColor, iconUrl: folderIconUrl, parentId: activeFolderId ?? null }) })
      setFolderName('')
      setFolderColor(defaultFolderColor)
      setFolderIconUrl(defaultFolderIconUrl)
      setFolderOpen(false)
      await reloadAfterFolderChange()
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Không tạo được thư mục' : 'Could not create the folder'))
    }
  }

  async function uploadFile(event: FormEvent) {
    event.preventDefault()
    if (selectedFiles.length === 0) return
    setLoading(true)
    setMessage('')

    const uploadingFiles = [...selectedFiles]
    const targetFolderId = activeFolderId || selectedFolderId
    const targetAccountId = selectedTargetAccountId || null

    setSelectedFiles([])
    setSelectedFolderId('')
    setSelectedTargetAccountId('')
    setUploadOpen(false)

    try {
      await uploadFiles(uploadingFiles, targetFolderId, targetAccountId)
    } catch (err) {
      console.error('Upload initiation failed:', err)
    } finally {
      setLoading(false)
    }
  }


  async function syncGoogleDrive() {
    setSyncingDrive(true)
    setMessage('')
    try {
      const response = await apiFetch<{ results: { created: number; updated: number; deleted: number }[] }>('/files/sync-google', { method: 'POST', body: JSON.stringify({ force: true }) })

      let created = 0, updated = 0, deleted = 0
      for (const res of response.results) {
        created += res.created
        updated += res.updated
        deleted += res.deleted
      }
      const accounts = response.results.length

      setMessage(lang === 'vi'
        ? `Đã đồng bộ Google Drive: thêm ${created}, cập nhật ${updated}, gỡ ${deleted} trên ${accounts} tài khoản.`
        : `Google Drive synced. ${created} added, ${updated} updated, ${deleted} removed across ${accounts} account${accounts === 1 ? '' : 's'}.`)
      await reloadAfterFolderChange()
      window.dispatchEvent(new Event('hcdrive:storage-changed'))
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to sync Google Drive')
    } finally {
      setSyncingDrive(false)
    }
  }

  function selectUploadFiles(files: FileList | File[] | null | undefined) {
    if (!files) return
    const nextFiles = Array.from(files)
    if (nextFiles.length === 0) return
    setSelectedFiles(nextFiles)
  }

  function removeUploadFile(index: number) {
    setSelectedFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))
  }

  function handleUploadDrag(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') setIsUploadDragging(true)
    if (event.type === 'dragleave' || event.type === 'drop') setIsUploadDragging(false)
    if (event.type === 'drop') selectUploadFiles(event.dataTransfer.files)
  }



  function openContext(event: MouseEvent<HTMLElement>, file: FileItem) {
    event.preventDefault()
    event.stopPropagation()
    setActiveFile(file)
    setContextMenu({ x: event.clientX, y: event.clientY, file })
  }

  function toggleFileSelection(file: FileItem) {
    if (!file.id) return
    setSelectedFolderForDetails(null)
    lastSelectedFileIdRef.current = file.id
    setActiveFile(file)
    setSelectedFileIds((current) => {
      const next = new Set(current)
      if (next.has(file.id!)) next.delete(file.id!)
      else next.add(file.id!)
      return next
    })
  }

  function toggleAllVisibleFiles() {
    const visibleIds = files.map((file) => file.id).filter(Boolean) as string[]
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedFileIds.has(id))
    setSelectedFileIds(allSelected ? new Set() : new Set(visibleIds))
  }

  function clearSelection() {
    setSelectedFileIds(new Set())
    setSelectedFolderForDetails(null)
    lastSelectedFileIdRef.current = null
  }

  function openFolderMenu(event: MouseEvent<HTMLElement>, folder: FolderItem) {
    event.preventDefault()
    event.stopPropagation()
    setActiveFolderForMenu(folder)
    setFolderContextMenu({ x: event.clientX, y: event.clientY, folder })
  }

  function openFolder(folder: FolderItem) {
    if (!folder.id) return
    setSearchParams(searchQuery ? { folderId: folder.id, q: searchQuery } : { folderId: folder.id })
  }

  function openFolderById(folderId: string) {
    setSearchParams(searchQuery ? { folderId, q: searchQuery } : { folderId })
  }

  function openEmptyContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setEmptyContextMenu({ x: event.clientX, y: event.clientY, open: true })
  }

  function closeFolder() {
    setSearchParams(searchQuery ? { q: searchQuery } : {})
  }

  function viewFile(targetFile?: FileItem) {
    const file = targetFile ?? activeFile
    if (!file?.id && !file?.providerFileId) return
    setActiveFile(file)
    setPreviewOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function downloadFile(targetFile?: FileItem) {
    const file = targetFile ?? activeFile
    setContextMenu({ x: 0, y: 0, file: null })
    if (!file?.id) return
    try {
      const response = await fetch(`${API_URL}/files/${file.id}/download`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
      if (!response.ok) throw new Error(lang === 'vi' ? 'Tải xuống thất bại' : 'Download failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      // Revoking right away can cancel the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Tải xuống thất bại' : 'Download failed'))
    }
  }

  async function downloadBatchAsZip() {
    const selectedIds = [...selectedFileIds]
    if (selectedIds.length === 0) return
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/files/batch-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAccessToken()}`
        },
        body: JSON.stringify({ fileIds: selectedIds })
      })
      if (!response.ok) throw new Error('Failed to download ZIP file')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'hcdrive-download.zip'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      clearSelection()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Batch download failed')
    } finally {
      setLoading(false)
    }
  }


  async function renameFile(event: FormEvent) {
    event.preventDefault()
    if (!activeFile?.id) return
    try {
      await apiFetch(`/files/${activeFile.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameValue }) })
      setRenameOpen(false)
      await loadFiles()
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Không đổi tên được' : 'Could not rename'))
    }
  }

  async function moveFile(event: FormEvent) {
    event.preventDefault()
    const selectedIds = [...selectedFileIds]
    try {
      if (selectedIds.length > 0) await apiFetch('/files/batch', { method: 'PATCH', body: JSON.stringify({ fileIds: selectedIds, folderId: selectedFolderId || null }) })
      else if (activeFile?.id) await apiFetch(`/files/${activeFile.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: selectedFolderId || null }) })
      else return
      setMoveOpen(false)
      setSelectedFolderId('')
      clearSelection()
      showSnackbar(lang === 'vi' ? 'Đã di chuyển' : 'Moved')
      await loadFiles()
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Không di chuyển được' : 'Could not move'))
    }
  }

  async function deleteFile() {
    const selectedIds = [...selectedFileIds]
    try {
      if (selectedIds.length > 0) await apiFetch('/files/batch', { method: 'DELETE', body: JSON.stringify({ fileIds: selectedIds }) })
      else if (activeFile?.id) await apiFetch(`/files/${activeFile.id}`, { method: 'DELETE' })
      else return
      setDeleteOpen(false)
      clearSelection()
      showSnackbar(lang === 'vi' ? 'Đã chuyển vào thùng rác' : 'Moved to trash')
      await loadFiles()
      window.dispatchEvent(new Event('hcdrive:storage-changed'))
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Không xoá được' : 'Could not delete'))
    }
  }

  async function toggleStar(targetFile?: FileItem) {
    const file = targetFile ?? activeFile
    if (!file?.id) return
    const fileId = file.id
    const nextStarred = !file.starred
    try {
      await apiFetch(`/files/${fileId}/star`, {
        method: 'POST',
        body: JSON.stringify({ starred: nextStarred })
      })
      // Match by HCDrive id only: S3 files have no providerFileId, so comparing those matched every S3 file.
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, starred: nextStarred } : f)))
      showSnackbar(nextStarred ? (lang === 'vi' ? 'Đã thêm vào mục có gắn dấu sao' : 'Added to Starred') : (lang === 'vi' ? 'Đã xoá khỏi mục có gắn dấu sao' : 'Removed from Starred'))
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to update star')
    }
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function quickChangeFolderColor(folder: FolderItem, color: string) {
    if (!folder.id) return
    try {
      await apiFetch(`/folders/${folder.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ color })
      })
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, color } : f)))
      showSnackbar(lang === 'vi' ? 'Đã thay đổi màu thư mục' : 'Folder color updated')
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to update folder color')
    }
  }

  function shareFile(targetFile?: FileItem) {
    const file = targetFile ?? activeFile
    setContextMenu({ x: 0, y: 0, file: null })
    if (!file?.id) return
    setShareTarget({ kind: 'file', id: file.id, name: file.name, provider: file.accountProvider === 'S3 Storage' ? 's3' : 'google_drive' })
  }

  function shareFolder(targetFolder?: FolderItem) {
    const folder = targetFolder ?? activeFolderForMenu
    setFolderContextMenu({ x: 0, y: 0, folder: null })
    if (!folder?.id) return
    setShareTarget({ kind: 'folder', id: folder.id, name: folder.name })
  }

  async function copyShareLinkDirect() {
    if (!activeFile?.id) return
    try {
      // Use the revocable HCDrive share link; Drive files are no longer made public automatically.
      const shareData = await apiFetch<{ url: string }>(`/files/${activeFile.id}/share`, { method: 'POST' })
      await navigator.clipboard.writeText(shareData.url)
      showSnackbar(lang === 'vi' ? 'Đã sao chép đường liên kết vào khay nhớ tạm' : 'Link copied to clipboard')
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to copy link')
    }
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function inviteToFile() {
    if (!activeFile?.id) return
    setInviteTargetType('file')
    setInviteTargetId(activeFile.id)
    setInviteOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function inviteToFolder() {
    if (!activeFolderForMenu?.id) return
    setInviteTargetType('folder')
    setInviteTargetId(activeFolderForMenu.id)
    setInviteOpen(true)
    setFolderContextMenu({ x: 0, y: 0, folder: null })
  }

  async function copyFolderLink() {
    if (!activeFolderForMenu?.id) return
    let url = `${window.location.origin}/all-files?folderId=${activeFolderForMenu.id}`
    if (activeFolderForMenu.providerFolderId) {
      url = `https://drive.google.com/open?id=${activeFolderForMenu.providerFolderId}`
    }
    await navigator.clipboard.writeText(url)
    showSnackbar(lang === 'vi' ? 'Đã sao chép đường liên kết thư mục' : 'Folder link copied to clipboard')
    setFolderContextMenu({ x: 0, y: 0, folder: null })
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault()
    if (!inviteTargetId) return
    setInviting(true)
    setInviteMessage('')
    try {
      await apiFetch('/invites', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole, targetType: inviteTargetType, targetId: inviteTargetId }) })
      setInviteEmail('')
      setInviteRole('viewer')
      setInviteMessage('Invite saved. Member will appear in Shared.')
      window.dispatchEvent(new Event('hcdrive:invites-changed'))
      window.dispatchEvent(new Event('9drive:invites-changed'))
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  async function renameFolder(event: FormEvent) {
    event.preventDefault()
    if (!activeFolderForMenu?.id) return
    try {
      await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'PATCH', body: JSON.stringify({ name: folderRenameValue, color: folderRenameColor, iconUrl: folderRenameIconUrl }) })
      setFolderRenameOpen(false)
      await reloadAfterFolderChange()
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Không đổi tên thư mục được' : 'Could not rename the folder'))
    }
  }

  async function deleteFolder() {
    if (!activeFolderForMenu?.id) return
    try {
      await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'DELETE' })
      setFolderDeleteOpen(false)
      if (selectedFolderForDetails?.id === activeFolderForMenu.id) setSelectedFolderForDetails(null)
      showSnackbar(lang === 'vi' ? 'Đã xoá thư mục' : 'Folder deleted')
      await reloadAfterFolderChange()
    } catch (error) {
      showSnackbar(errorText(error, lang === 'vi' ? 'Không xoá được thư mục' : 'Could not delete the folder'))
    }
  }

  function cutSelectedFolder(folder: FolderItem | null) {
    if (!folder?.id) return
    setCutFolder(folder)
    setFolderContextMenu({ x: 0, y: 0, folder: null })
  }

  async function pasteFolder() {
    if (!cutFolder?.id) return
    if (cutFolder.id === activeFolderId) return
    await apiFetch(`/folders/${cutFolder.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: activeFolderId ?? null }) })
    showSnackbar(lang === 'vi' ? `Đã chuyển thư mục "${cutFolder.name}"` : `Folder "${cutFolder.name}" moved`)
    setCutFolder(null)
    await reloadAfterFolderChange()
  }

  function closePreview() {
    setPreviewOpen(false)
  }

  useEffect(() => {
    function handleUploadCompleted() {
      reloadAfterFolderChangeRef.current().catch(() => undefined)
    }
    window.addEventListener('hcdrive:upload-completed', handleUploadCompleted)
    window.addEventListener('9drive:upload-completed', handleUploadCompleted)
    return () => {
      window.removeEventListener('hcdrive:upload-completed', handleUploadCompleted)
      window.removeEventListener('9drive:upload-completed', handleUploadCompleted)
    }
  }, [])

  useEffect(() => {
    setHeaderActions(null)
  }, [setHeaderActions])

  const activeFolder = allFolders.find((folder) => folder.id === activeFolderId)
  const folderBreadcrumbs = (() => {
    if (!activeFolder) return []
    const foldersById = new Map(allFolders.map((folder) => [folder.id, folder]))
    const path: FolderItem[] = []
    const visited = new Set<string>()
    let current: FolderItem | undefined = activeFolder
    while (current?.id && !visited.has(current.id)) {
      path.unshift(current)
      visited.add(current.id)
      current = current.parentId ? foldersById.get(current.parentId) : undefined
    }
    return path
  })()
  const allVisibleSelected = files.length > 0 && files.every((file) => file.id && selectedFileIds.has(file.id))
  const foldersById = useMemo(() => new Map(allFolders.map((folder) => [folder.id, folder])), [allFolders])
  const folderOptions = useMemo(
    () => allFolders
      .map((folder) => ({ id: folder.id!, label: folderPathLabel(folder, foldersById) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi', { numeric: true, sensitivity: 'base' })),
    [allFolders, foldersById],
  )

  const sortedFolders = useMemo(() => {
    return [...folders].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })
      } else if (sortField === 'updatedAt') {
        cmp = (a.updatedAt || '').localeCompare(b.updatedAt || '')
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [folders, sortField, sortDirection])

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })
      } else if (sortField === 'updatedAt') {
        cmp = (a.createdAt || '').localeCompare(b.createdAt || '')
      } else if (sortField === 'size') {
        const sA = BigInt(a.sizeBytes || 0)
        const sB = BigInt(b.sizeBytes || 0)
        cmp = sA < sB ? -1 : sA > sB ? 1 : 0
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [files, sortField, sortDirection])

  const singleSelectedFile = useMemo(() => {
    if (selectedFileIds.size === 1) {
      const id = Array.from(selectedFileIds)[0]
      return files.find((f) => f.id === id) ?? null
    }
    return null
  }, [selectedFileIds, files, activeFile])

  const totalSelectedBytes = useMemo(() => {
    let total = 0
    for (const f of files) {
      if (f.id && selectedFileIds.has(f.id)) {
        total += Number(f.sizeBytes || 0)
      }
    }
    return total
  }, [files, selectedFileIds])

  return (
    <>
      <div
        onContextMenu={openEmptyContextMenu}
        onDragOver={handlePageDragOver}
        onDragEnter={handlePageDragOver}
        onDragLeave={handlePageDragLeave}
        onDrop={handlePageDrop}
        className="relative flex flex-col flex-1 min-h-0 w-full"
      >
        {/* Drag & Drop Visual Overlay */}
        {isUploadDragging && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-500 bg-blue-50/90 dark:bg-blue-950/90 backdrop-blur-sm pointer-events-none transition-all">
            <Upload className="h-12 w-12 text-blue-600 animate-bounce mb-2" />
            <p className="text-base font-bold text-blue-800 dark:text-blue-200">
              {lang === 'vi' ? 'Thả tệp vào đây để tải lên Drive' : 'Drop files here to upload to Drive'}
            </p>
          </div>
        )}

        {/* Main Content + Details Panel Container */}
        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
          {/* Main List/Grid View Column */}
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto px-1 sm:px-2">
            {/* Top Toolbar (Breadcrumbs + Actions) */}
            <DriveToolbar
              title={searchQuery
                ? (lang === 'vi' ? `Kết quả tìm kiếm cho "${searchQuery}"` : `Results for "${searchQuery}"`)
                : hasChips ? (lang === 'vi' ? 'Kết quả lọc' : 'Filter results') : undefined}
              activeFolder={activeFolder}
              breadcrumbs={folderBreadcrumbs}
              onOpenFolder={openFolderById}
              onFolderMenu={openFolderMenu}
              onRootClick={closeFolder}
              onNewFolder={() => setFolderOpen(true)}
              onUploadFile={() => fileInputRef.current?.click()}
              onUploadFolder={() => folderInputRef.current?.click()}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              detailsOpen={detailOpen}
              onToggleDetails={() => setDetailOpen(!detailOpen)}
              syncing={syncingDrive}
              onSync={syncGoogleDrive}
              sortField={sortField}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
              lang={lang}
            />

            {/* Filter Chips OR Multi-selection Action Bar */}
            <div className="my-2 min-h-9">
              {selectedFileIds.size > 0 ? (
                <SelectionBar
                  selectedCount={selectedFileIds.size}
                  onClearSelection={clearSelection}
                  onShare={() => {
                    const target = singleSelectedFile
                    if (target) shareFile(target)
                  }}
                  onDownload={() => {
                    if (selectedFileIds.size === 1) {
                      const target = singleSelectedFile
                      if (target) downloadFile(target)
                    } else if (selectedFileIds.size > 1) {
                      downloadBatchAsZip()
                    }
                  }}
                  onMove={() => setMoveOpen(true)}
                  onDelete={() => setDeleteOpen(true)}
                  onStar={() => {
                    const target = singleSelectedFile
                    if (target) toggleStar(target)
                  }}
                  canShare={selectedFileIds.size === 1}
                  isSingleItem={selectedFileIds.size === 1}
                  lang={lang}
                />
              ) : (
                <FilterChips
                  filters={currentFilters}
                  accounts={connectedAccounts}
                  onFilterChange={handleFilterChange}
                  onClearFilters={handleClearFilters}
                  lang={lang}
                />
              )}
            </div>

            {/* Message alert */}
            {message ? (
              <p className="my-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 p-3 text-xs sm:text-sm font-medium text-blue-700 dark:text-blue-300">
                {message}
              </p>
            ) : null}

            {/* Cut folder alert */}
            {cutFolder ? (
              <p className="my-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 p-3 text-xs sm:text-sm font-semibold text-amber-700 dark:text-amber-300">
                <ClipboardPaste className="mr-2 inline h-4 w-4" />
                {lang === 'vi'
                  ? `Đã cắt thư mục "${cutFolder.name}". Mở thư mục đích rồi bấm Ctrl+V hoặc chuột phải để dán.`
                  : `Cut folder: ${cutFolder.name}. Press Ctrl+V or right-click to paste here.`}
              </p>
            ) : null}

            {/* Empty State vs File/Folder View */}
            {folders.length === 0 && files.length === 0 ? (
              <Card className="my-6 flex flex-col items-center justify-center p-12 text-center border-dashed">
                <FolderPlus className="mb-3 h-12 w-12 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {searchQuery
                    ? (lang === 'vi' ? `Không tìm thấy kết quả cho "${searchQuery}".` : `Nothing found for "${searchQuery}".`)
                    : hasChips
                      ? (lang === 'vi' ? 'Không có mục nào khớp bộ lọc.' : 'Nothing matches these filters.')
                      : (lang === 'vi' ? 'Thư mục này đang trống.' : 'This folder is empty.')}
                </p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {lang === 'vi' ? 'Kéo thả tệp vào đây hoặc bấm nút "Tải lên" để thêm tệp mới.' : 'Drop files here or click "Upload" to add files.'}
                </p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
                    <FolderPlus className="h-3.5 w-3.5" />
                    {t('action.new_folder', 'New Folder')}
                  </Button>
                  <Button size="sm" onClick={() => setUploadOpen(true)}>
                    <Upload className="h-3.5 w-3.5" />
                    {t('action.upload', 'Upload')}
                  </Button>
                </div>
              </Card>
            ) : viewMode === 'grid' ? (
              <div className="py-2">
                <DriveGridView
                  folders={sortedFolders}
                  files={sortedFiles}
                  selectedFileIds={selectedFileIds}
                  selectedFolderId={selectedFolderForDetails?.id}
                  onSelectFile={handleSelectFile}
                  onToggleFile={toggleFileSelection}
                  onSelectFolder={handleSelectFolder}
                  onOpenFolder={openFolder}
                  onFolderMenu={openFolderMenu}
                  onViewFile={(file) => {
                    setActiveFile(file)
                    viewFile(file)
                  }}
                  onFileMenu={openContext}
                  onDropItem={handleDropItem}
                  lang={lang}
                />
              </div>
            ) : (
              <div className="py-2">
                <DriveListView
                  folders={sortedFolders}
                  files={sortedFiles}
                  selectedFileIds={selectedFileIds}
                  selectedFolderId={selectedFolderForDetails?.id}
                  allSelected={allVisibleSelected}
                  onToggleAll={toggleAllVisibleFiles}
                  onSelectFile={handleSelectFile}
                  onToggleFile={toggleFileSelection}
                  onSelectFolder={handleSelectFolder}
                  onOpenFolder={openFolder}
                  onFolderMenu={openFolderMenu}
                  onViewFile={(file) => {
                    setActiveFile(file)
                    viewFile(file)
                  }}
                  onFileMenu={openContext}
                  onDropItem={handleDropItem}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSortChange={handleSortChange}
                  columns={isSearching ? ['name', 'location', 'owner', 'last_modified', 'size'] : undefined}
                  lang={lang}
                />
              </div>
            )}
          </div>

          {/* Right Details Panel (i) */}
          <DetailsPanel
            open={detailOpen}
            file={singleSelectedFile}
            folder={selectedFolderForDetails}
            selectedCount={selectedFileIds.size}
            totalSelectedBytes={totalSelectedBytes}
            onClose={() => setDetailOpen(false)}
            onShare={() => {
              if (singleSelectedFile) shareFile(singleSelectedFile)
              else if (selectedFolderForDetails) shareFolder(selectedFolderForDetails)
            }}
            lang={lang}
          />
        </div>
      </div>
      <EmptyAreaContextMenu
        x={emptyContextMenu.x}
        y={emptyContextMenu.y}
        open={emptyContextMenu.open}
        canPasteFolder={Boolean(cutFolder)}
        onClose={() => setEmptyContextMenu({ x: 0, y: 0, open: false })}
        onUpload={() => {
          setEmptyContextMenu({ x: 0, y: 0, open: false })
          fileInputRef.current?.click()
        }}
        onUploadFolder={() => {
          setEmptyContextMenu({ x: 0, y: 0, open: false })
          folderInputRef.current?.click()
        }}
        onCreateFolder={() => {
          setFolderOpen(true)
          setEmptyContextMenu({ x: 0, y: 0, open: false })
        }}
        onPasteFolder={() => {
          pasteFolder().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to paste folder'))
          setEmptyContextMenu({ x: 0, y: 0, open: false })
        }}
      />
      <FileContextMenu x={contextMenu.x} y={contextMenu.y} file={contextMenu.file} onClose={() => setContextMenu({ x: 0, y: 0, file: null })} onView={() => viewFile()} onDownload={() => downloadFile()} onRename={() => { setRenameValue(activeFile?.name ?? ''); setRenameOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onMove={() => { setMoveOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onDetails={() => { setDetailOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onShare={() => shareFile()} onCopyLink={copyShareLinkDirect} onInvite={inviteToFile} onDelete={() => { setDeleteOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onStar={() => toggleStar()} />
      <FolderContextMenu
        x={folderContextMenu.x}
        y={folderContextMenu.y}
        folder={folderContextMenu.folder}
        onClose={() => setFolderContextMenu({ x: 0, y: 0, folder: null })}
        onOpen={() => {
          if (folderContextMenu.folder) {
            openFolder(folderContextMenu.folder)
            setFolderContextMenu({ x: 0, y: 0, folder: null })
          }
        }}
        onDownload={() => downloadFolder(folderContextMenu.folder)}
        onCut={() => cutSelectedFolder(activeFolderForMenu)}
        onRename={() => {
          setFolderRenameValue(activeFolderForMenu?.name ?? '')
          setFolderRenameColor(normalizeFolderColor(activeFolderForMenu?.color))
          setFolderRenameIconUrl(activeFolderForMenu?.iconUrl ?? defaultFolderIconUrl)
          setFolderRenameOpen(true)
          setFolderContextMenu({ x: 0, y: 0, folder: null })
        }}
        onInvite={inviteToFolder}
        onShare={() => shareFolder()}
        onCopyLink={copyFolderLink}
        onDelete={() => {
          setFolderDeleteOpen(true)
          setFolderContextMenu({ x: 0, y: 0, folder: null })
        }}
        onChangeColor={(color) => {
          if (activeFolderForMenu) {
            quickChangeFolderColor(activeFolderForMenu, color)
          }
        }}
      />

      <DummyModal open={uploadOpen} title={lang === 'vi' ? 'Tải tệp lên' : 'Upload File'} description={lang === 'vi' ? 'Tệp được truyền thẳng lên tài khoản lưu trữ.' : 'Files stream straight to the storage account.'} onClose={() => setUploadOpen(false)}>
        <form onSubmit={uploadFile} className="grid gap-4">
           <label onDragEnter={handleUploadDrag} onDragOver={handleUploadDrag} onDragLeave={handleUploadDrag} onDrop={handleUploadDrag} className={isUploadDragging ? 'grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-blue-500 bg-blue-50 p-4 text-center transition sm:p-6' : 'grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center transition hover:border-blue-300 hover:bg-blue-50/50 sm:p-6'}>
            <Upload className={isUploadDragging ? 'mx-auto h-8 w-8 text-blue-600' : 'mx-auto h-8 w-8 text-slate-500'} />
            <span className="text-sm font-extrabold text-slate-950">{lang === 'vi' ? 'Kéo thả tệp vào đây hoặc bấm để chọn' : 'Drop files here or click to browse'}</span>
            <span className="text-xs text-slate-500">{lang === 'vi' ? 'Có thể chọn nhiều tệp cùng lúc.' : 'You can pick several files at once.'}</span>
            <Input type="file" className="sr-only" multiple onChange={(event) => selectUploadFiles(event.target.files)} required={selectedFiles.length === 0} />
          </label>
          <label className="grid gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            {lang === 'vi' ? 'Tài khoản lưu trữ đích (Target Storage Account)' : 'Target Storage Account'}
            <select
              className="h-11 rounded-xl border border-slate-200 dark:border-slate-800 px-3 text-xs bg-white dark:bg-slate-950 focus:border-blue-500 focus:outline-none"
              value={selectedTargetAccountId}
              onChange={(event) => setSelectedTargetAccountId(event.target.value)}
            >
              <option value="">{t('quota.auto_pooling', 'Tự động phân bổ / Gộp dung lượng (Mặc định)')}</option>
              {connectedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName || account.email} — ({account.provider === 's3' ? 'S3 Storage' : 'Google Drive'})
                </option>
              ))}
            </select>
            <span className="text-[11px] font-normal text-slate-400">
              {lang === 'vi' ? 'Để mặc định nếu muốn hệ thống tự động gộp dung lượng và cân bằng tải giữa các tài khoản.' : 'Keep default to automatically pool storage across drives.'}
            </span>
          </label>
          {activeFolder ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{lang === 'vi' ? 'Tải vào thư mục' : 'Uploading to'}: <b>{activeFolder.name}</b></p> : <label className="grid gap-2 text-sm font-semibold">{lang === 'vi' ? 'Thư mục ảo' : 'Virtual Folder'}<select className="h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white" value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}><option value="">{lang === 'vi' ? 'Không có thư mục' : 'No folder'}</option>{folderOptions.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}</select></label>}
          {selectedFiles.length > 0 ? <div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><div className="flex items-center justify-between gap-3"><span className="font-bold text-slate-950">{lang === 'vi' ? `Đã chọn ${selectedFiles.length} tệp` : `${selectedFiles.length} selected`}</span><span className="shrink-0">{formatBytes(selectedFiles.reduce((total, file) => total + file.size, 0))}</span></div>{selectedFiles.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="shrink-0 text-xs text-slate-500">{formatBytes(file.size)}</span><button type="button" className="shrink-0 text-slate-500 hover:text-red-600" onClick={() => removeUploadFile(index)} aria-label={`Remove ${file.name}`}><X className="h-4 w-4" /></button></div>)}</div> : null}
          <div className="grid gap-2 sm:flex sm:justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="text" onClick={() => setUploadOpen(false)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</Button>
            <Button variant="filled" disabled={loading || selectedFiles.length === 0}>{loading ? (lang === 'vi' ? 'Đang tải...' : 'Uploading...') : lang === 'vi' ? `Tải lên${selectedFiles.length > 1 ? ` ${selectedFiles.length} tệp` : ''}` : `Upload${selectedFiles.length > 1 ? ` ${selectedFiles.length} files` : ''}`}</Button>
          </div>
        </form>
      </DummyModal>
      <DummyModal open={folderOpen} title={lang === 'vi' ? 'Thư mục mới' : 'New Folder'} description={lang === 'vi' ? 'Tạo thư mục ảo để sắp xếp và quản lý tệp tin.' : 'Create a virtual folder for organizing files.'} onClose={() => setFolderOpen(false)}>
        <form onSubmit={createFolder} className="grid gap-4">
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            {lang === 'vi' ? 'Tên thư mục' : 'Folder Name'}
            <Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={lang === 'vi' ? 'Thư mục không tên' : 'Untitled folder'} required />
          </label>
          <FolderAppearanceFields color={folderColor} iconUrl={folderIconUrl} onColorChange={setFolderColor} onIconChange={setFolderIconUrl} />
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="text" onClick={() => setFolderOpen(false)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</Button>
            <Button variant="filled">{lang === 'vi' ? 'Tạo' : 'Create'}</Button>
          </div>
        </form>
      </DummyModal>
      <DummyModal open={renameOpen} title={lang === 'vi' ? 'Đổi tên' : 'Rename'} description={activeFile?.name ?? ''} onClose={() => setRenameOpen(false)}>
        <form onSubmit={renameFile} className="grid gap-4">
          <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required />
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="text" onClick={() => setRenameOpen(false)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</Button>
            <Button variant="filled">{lang === 'vi' ? 'OK' : 'OK'}</Button>
          </div>
        </form>
      </DummyModal>
      <DummyModal open={moveOpen} title={lang === 'vi' ? 'Di chuyển' : 'Move to Folder'} description={selectedFileIds.size > 0 ? (lang === 'vi' ? `Di chuyển ${selectedFileIds.size} tệp` : `Move ${selectedFileIds.size} files`) : activeFile?.name ?? ''} onClose={() => setMoveOpen(false)}>
        <form onSubmit={moveFile} className="grid gap-4">
          <select className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#282a2c] px-3 text-xs" value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}>
            <option value="">{lang === 'vi' ? 'Drive của tôi (Gốc)' : 'My Drive (Root)'}</option>
            {folderOptions.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
          </select>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="text" onClick={() => setMoveOpen(false)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</Button>
            <Button variant="filled">{lang === 'vi' ? 'Di chuyển vào đây' : 'Move here'}</Button>
          </div>
        </form>
      </DummyModal>
      <DummyModal
        open={deleteOpen}
        title={lang === 'vi' ? 'Chuyển vào thùng rác' : 'Move to Recycle Bin'}
        description={lang === 'vi'
          ? `${selectedFileIds.size > 0 ? `${selectedFileIds.size} tệp` : `"${activeFile?.name ?? 'tệp'}"`} sẽ được chuyển vào Thùng rác. Bạn có thể khôi phục lại từ đó.`
          : `${selectedFileIds.size > 0 ? `${selectedFileIds.size} files` : `"${activeFile?.name ?? 'file'}"`} will be moved to the Recycle Bin. You can restore them from there.`}
        onClose={() => setDeleteOpen(false)}
      >
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="text" onClick={() => setDeleteOpen(false)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</Button>
          <Button variant="danger" onClick={deleteFile}><Trash2 className="h-4 w-4" />{lang === 'vi' ? 'Chuyển vào thùng rác' : 'Move to Recycle Bin'}</Button>
        </div>
      </DummyModal>
      <ShareDialog target={shareTarget} lang={lang} onClose={() => setShareTarget(null)} />
      <DummyModal open={folderRenameOpen} title={lang === 'vi' ? 'Đổi tên thư mục' : 'Rename Folder'} description={activeFolderForMenu?.name ?? ''} onClose={() => setFolderRenameOpen(false)}>
        <form onSubmit={renameFolder} className="grid gap-4">
          <Input value={folderRenameValue} onChange={(event) => setFolderRenameValue(event.target.value)} required />
          <FolderAppearanceFields color={folderRenameColor} iconUrl={folderRenameIconUrl} onColorChange={setFolderRenameColor} onIconChange={setFolderRenameIconUrl} />
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="text" onClick={() => setFolderRenameOpen(false)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</Button>
            <Button variant="filled">{lang === 'vi' ? 'OK' : 'OK'}</Button>
          </div>
        </form>
      </DummyModal>
      <DummyModal open={folderDeleteOpen} title={lang === 'vi' ? 'Xoá thư mục' : 'Delete Folder'} description={lang === 'vi' ? `Bạn có chắc muốn xoá thư mục "${activeFolderForMenu?.name ?? ''}"? Các tệp bên trong vẫn được giữ lại.` : `Delete virtual folder ${activeFolderForMenu?.name ?? ''}? Files inside will remain uploaded.`} onClose={() => setFolderDeleteOpen(false)}>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="text" onClick={() => setFolderDeleteOpen(false)}>{lang === 'vi' ? 'Huỷ' : 'Cancel'}</Button>
          <Button variant="danger" onClick={deleteFolder}>{lang === 'vi' ? 'Xoá' : 'Delete'}</Button>
        </div>
      </DummyModal>
      <DummyModal open={inviteOpen} title="Invite Member" description={`Share ${inviteTargetType === 'file' ? (activeFile?.name ?? 'file') : (activeFolderForMenu?.name ?? 'folder')} with a team member.`} onClose={() => setInviteOpen(false)}>
        <form onSubmit={sendInvite} className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">Email Address<Input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" required /></label>
          <label className="grid gap-2 text-sm font-semibold">Role<select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="viewer">Can view</option><option value="editor">Can edit</option></select></label>
          {inviteMessage ? <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">{inviteMessage}</p> : null}
          <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button><Button disabled={inviting}>{inviting ? 'Sending...' : 'Send Invite'}</Button></div>
        </form>
      </DummyModal>
      <GoogleFilePreview
        open={previewOpen}
        file={activeFile}
        files={sortedFiles}
        onClose={closePreview}
        onShare={(f) => shareFile(f)}
        onDownload={(f) => downloadFile(f)}
        onNavigateFile={(f) => {
          setActiveFile(f)
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputSelected}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
        onChange={handleFolderInputSelected}
      />
    </>
  )
}
