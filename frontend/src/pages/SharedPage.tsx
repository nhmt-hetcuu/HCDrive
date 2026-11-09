import { useEffect, useState, useMemo, type MouseEvent } from 'react'
import {
  Users,
  Share2,
  Link as LinkIcon,
  MoreVertical,
  Link2Off,
} from 'lucide-react'
import { apiFetch, API_URL, formatBytes, formatDriveDate } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { getAccessToken } from '@/lib/auth'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { DetailsPanel } from '@/components/drive/DetailsPanel'
import { FileContextMenu } from '@/components/drive/FileContextMenu'
import { GoogleFilePreview } from '@/components/drive/GoogleFilePreview'
import { ShareDialog, type ShareTarget } from '@/components/drive/ShareDialog'
import { FilterChips, type FilterValues } from '@/components/drive/FilterChips'
import { AvatarStack } from '@/components/drive/AvatarStack'
import type { FileItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

type SharedWithMeItem = {
  id: string
  name: string
  mimeType: string
  size: string
  sizeBytes: string
  modifiedTime?: string | null
  sharedWithMeTime?: string | null
  ownerName: string
  ownerEmail?: string | null
  accountEmail: string
  accountId: string
  source: 'google_drive' | 'hcdrive' | '9drive'
  webViewLink?: string | null
  webContentLink?: string | null
  iconLink?: string | null
  thumbnailLink?: string | null
  isFolder: boolean
}

type SharedByMeItem = {
  id: string
  name: string
  mimeType: string
  size: string
  sizeBytes: string
  modifiedTime?: string | null
  sharedWith: string
  shareType: string
  accountEmail: string
  accountId: string
  webViewLink?: string | null
  isFolder: boolean
  /** How it was shared: a Google Drive permission, an HCDrive public link, or an HCDrive invite. */
  shareKind: 'google' | 'link' | 'invite'
  /** The HCDrive file/folder id; null for a Google item HCDrive does not track. */
  hcdriveId: string | null
  ninedriveId?: string | null
  inviteId?: string
}

type Invite = {
  id: string
  email: string
  role: string
  status: string
  targetType: 'file' | 'folder'
  targetId: string
  target: { id: string; name: string; type: 'file' | 'folder'; mimeType?: string; sizeBytes?: string } | null
  createdAt: string
  user: { id: string; name: string; email: string } | null
}

export function SharedPage() {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const vi = lang === 'vi'

  const [activeTab, setActiveTab] = useState<'with_me' | 'by_me'>('with_me')
  const [withMeFiles, setWithMeFiles] = useState<SharedWithMeItem[]>([])
  const [byMeFiles, setByMeFiles] = useState<SharedByMeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeItem, setActiveItem] = useState<any | null>(null)

  // Filters
  const [filters, setFilters] = useState<FilterValues>({
    kind: null,
    accountId: null,
  })

  // Modals & Context Menus
  const [previewOpen, setPreviewOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    file: FileItem | null
  }>({ x: 0, y: 0, file: null })

  async function loadData() {
    setLoading(true)
    try {
      const [sharedRes, byMeRes, invitesRes] = await Promise.allSettled([
        apiFetch<{ items: any[] }>('/files/shared-with-me'),
        apiFetch<{ items: any[] }>('/files/shared-by-me'),
        apiFetch<{ received: Invite[]; sent: Invite[] }>('/invites'),
      ])

      const listWithMe: SharedWithMeItem[] = []

      // 1. Google Drive shared with me
      if (sharedRes.status === 'fulfilled' && sharedRes.value?.items) {
        for (const item of sharedRes.value.items) {
          listWithMe.push({
            id: item.id,
            name: item.name,
            mimeType: item.mimeType,
            size: item.size || '--',
            sizeBytes: item.sizeBytes ? String(item.sizeBytes) : '0',
            modifiedTime: item.modifiedTime,
            sharedWithMeTime: item.sharedWithMeTime || item.modifiedTime,
            ownerName: item.ownerName || 'Unknown',
            ownerEmail: item.ownerEmail || null,
            accountEmail: item.accountEmail || 'Google Drive',
            accountId: item.accountId || '',
            source: 'google_drive',
            webViewLink: item.webViewLink || (item.id ? `https://drive.google.com/file/d/${item.id}/view` : null),
            isFolder: item.isFolder || false,
          })
        }
      }

      // 2. HCDrive invites received
      if (invitesRes.status === 'fulfilled' && invitesRes.value?.received) {
        for (const inv of invitesRes.value.received) {
          if (inv.target) {
            listWithMe.push({
              id: inv.target.id,
              name: inv.target.name,
              mimeType: inv.target.mimeType || 'application/octet-stream',
              size: inv.target.sizeBytes ? formatBytes(inv.target.sizeBytes) : '--',
              sizeBytes: inv.target.sizeBytes ? String(inv.target.sizeBytes) : '0',
              modifiedTime: inv.createdAt,
              sharedWithMeTime: inv.createdAt,
              ownerName: inv.user?.name || inv.user?.email || 'HCDrive User',
              ownerEmail: inv.user?.email || null,
              accountEmail: 'HCDrive',
              accountId: 'hcdrive',
              source: 'hcdrive',
              webViewLink: null,
              isFolder: inv.targetType === 'folder',
            })
          }
        }
      }

      // Sort newest shared first
      listWithMe.sort((a, b) => {
        const timeA = new Date(a.sharedWithMeTime || a.modifiedTime || 0).getTime()
        const timeB = new Date(b.sharedWithMeTime || b.modifiedTime || 0).getTime()
        return timeB - timeA
      })
      setWithMeFiles(listWithMe)

      // 3. Shared by me items
      const listByMe: SharedByMeItem[] = []
      if (byMeRes.status === 'fulfilled' && byMeRes.value?.items) {
        for (const item of byMeRes.value.items) {
          listByMe.push({
            id: item.id,
            name: item.name,
            mimeType: item.mimeType,
            size: item.size || '--',
            sizeBytes: item.sizeBytes ? String(item.sizeBytes) : '0',
            modifiedTime: item.modifiedTime,
            sharedWith: item.sharedWith === 'HCDrive Public Link' || item.sharedWith === '9Drive Public Link'
              ? (vi ? 'Bất kỳ ai có đường liên kết' : 'Anyone with the link')
              : item.sharedWith || (vi ? 'Bất kỳ ai có liên kết' : 'Anyone with link'),
            shareType: item.sharedWith === 'HCDrive Public Link' || item.sharedWith === '9Drive Public Link'
              ? (vi ? 'Link HCDrive' : 'HCDrive link')
              : 'Google Drive',
            accountEmail: item.accountEmail || 'HCDrive',
            accountId: item.accountId || '',
            webViewLink: item.webViewLink || null,
            isFolder: item.isFolder || false,
            shareKind: (item.sharedWith === 'HCDrive Public Link' || item.sharedWith === '9Drive Public Link') ? 'link' : 'google',
            hcdriveId: item.hcdriveId ?? item.ninedriveId ?? null,
            ninedriveId: item.hcdriveId ?? item.ninedriveId ?? null,
          })
        }
      }
      // HCDrive invites I sent; these can be revoked from here.
      if (invitesRes.status === 'fulfilled' && invitesRes.value?.sent) {
        for (const inv of invitesRes.value.sent) {
          if (!inv.target) continue
          listByMe.push({
            id: `invite-${inv.id}`,
            name: inv.target.name,
            mimeType: inv.targetType === 'folder' ? 'application/vnd.google-apps.folder' : inv.target.mimeType || 'application/octet-stream',
            size: inv.target.sizeBytes ? formatBytes(inv.target.sizeBytes) : '--',
            sizeBytes: inv.target.sizeBytes ? String(inv.target.sizeBytes) : '0',
            modifiedTime: inv.createdAt,
            sharedWith: inv.email,
            shareType: vi ? `Lời mời HCDrive (${inv.role === 'editor' ? 'sửa' : 'xem'})` : `HCDrive invite (${inv.role === 'editor' ? 'edit' : 'view'})`,
            accountEmail: 'HCDrive',
            accountId: 'hcdrive',
            webViewLink: null,
            isFolder: inv.targetType === 'folder',
            shareKind: 'invite',
            hcdriveId: inv.target.id,
            ninedriveId: inv.target.id,
            inviteId: inv.id,
          })
        }
      }
      listByMe.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime())
      setByMeFiles(listByMe)
    } catch (err: any) {
      console.warn('Failed to load shared items:', err)
      showSnackbar(vi ? 'Không thể tải tài nguyên chia sẻ' : 'Failed to load shared resources')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    function handleReload() {
      loadData()
    }
    window.addEventListener('hcdrive:refresh-files', handleReload)
    window.addEventListener('9drive:refresh-files', handleReload)
    window.addEventListener('hcdrive:upload-completed', handleReload)
    window.addEventListener('9drive:upload-completed', handleReload)
    return () => {
      window.removeEventListener('hcdrive:refresh-files', handleReload)
      window.removeEventListener('9drive:refresh-files', handleReload)
      window.removeEventListener('hcdrive:upload-completed', handleReload)
      window.removeEventListener('9drive:upload-completed', handleReload)
    }
  }, [])

  const currentList = activeTab === 'with_me' ? withMeFiles : byMeFiles

  const connectedAccounts = useMemo(() => {
    const map = new Map<string, { id: string; email: string }>()
    for (const f of currentList) {
      if (f.accountId && f.accountEmail && !map.has(f.accountId)) {
        map.set(f.accountId, { id: f.accountId, email: f.accountEmail })
      }
    }
    return Array.from(map.values())
  }, [currentList])

  const filteredItems = useMemo(() => {
    return currentList.filter((item) => {
      if (filters.kind) {
        const mime = item.mimeType || ''
        if (filters.kind === 'image' && !mime.startsWith('image/')) return false
        if (filters.kind === 'video' && !mime.startsWith('video/')) return false
        if (filters.kind === 'pdf' && !mime.includes('pdf')) return false
        if (filters.kind === 'doc' && !mime.includes('document') && !mime.includes('word') && !mime.startsWith('text/')) return false
        if (filters.kind === 'sheet' && !mime.includes('sheet') && !mime.includes('excel') && mime !== 'text/csv') return false
        if (filters.kind === 'slide' && !mime.includes('presentation') && !mime.includes('powerpoint')) return false
        if (filters.kind === 'archive' && !mime.includes('zip') && !mime.includes('rar') && !mime.includes('tar') && !mime.includes('7z')) return false
      }
      if (filters.accountId && item.accountId !== filters.accountId) {
        return false
      }
      const when = new Date(('sharedWithMeTime' in item && item.sharedWithMeTime) || item.modifiedTime || 0).getTime()
      if (filters.startDate && when < new Date(filters.startDate).getTime()) return false
      if (filters.endDate && when > new Date(filters.endDate).getTime()) return false
      const size = Number(item.sizeBytes || 0)
      if (filters.minSize && size < Number(filters.minSize)) return false
      if (filters.maxSize && size > Number(filters.maxSize)) return false
      return true
    })
  }, [currentList, filters])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredItems.map((f) => f.id)))
    }
  }

  // Opens sharing settings: the share dialog for items HCDrive tracks, otherwise the item on Google Drive.
  function manageSharing(item: SharedByMeItem) {
    const id = item.hcdriveId || item.ninedriveId
    if (id && item.shareKind !== 'invite') {
      setShareTarget({ kind: item.isFolder ? 'folder' : 'file', id, name: item.name })
    } else if (item.webViewLink) {
      window.open(item.webViewLink, '_blank', 'noopener')
    }
  }

  async function revokeSharing(item: SharedByMeItem) {
    const id = item.hcdriveId || item.ninedriveId
    try {
      if (item.shareKind === 'invite' && item.inviteId) {
        await apiFetch(`/invites/${item.inviteId}`, { method: 'DELETE' })
      } else if (item.shareKind === 'link' && id) {
        await apiFetch(`/files/${id}/share`, { method: 'DELETE' })
      } else {
        // Google permissions are removed person by person in the share dialog.
        manageSharing(item)
        return
      }
      showSnackbar(vi ? `Đã thu hồi chia sẻ "${item.name}"` : `Stopped sharing "${item.name}"`)
      window.dispatchEvent(new Event('hcdrive:invites-changed'))
      window.dispatchEvent(new Event('9drive:invites-changed'))
      await loadData()
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : (vi ? 'Không thu hồi được' : 'Could not stop sharing'))
    }
  }

  function handleViewItem(item: any) {
    setActiveItem(item)
    setPreviewOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function handleDownloadItem(item?: any) {
    const target = item || activeItem
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
      if (target.id) {
        window.open(`https://drive.google.com/uc?id=${target.id}&export=download`, '_blank')
      }
    } catch {
      showSnackbar(vi ? 'Tải tệp thất bại' : 'Download failed')
    }
  }

  function handleContextMenu(e: MouseEvent<HTMLElement>, item: any) {
    e.preventDefault()
    e.stopPropagation()
    setActiveItem(item)
    const fileItem: FileItem = {
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      size: item.size,
      sizeBytes: item.sizeBytes,
      date: item.modifiedTime,
      access: item.ownerName || 'Shared',
      webViewLink: item.webViewLink,
      providerFileId: item.id,
    }
    setContextMenu({ x: e.clientX, y: e.clientY, file: fileItem })
  }

  const singleSelectedItem =
    selectedIds.size === 1
      ? currentList.find((f) => f.id === Array.from(selectedIds)[0]) || activeItem
      : activeItem

  const singleSelectedFileItem: FileItem | null = useMemo(() => {
    if (!singleSelectedItem) return null
    return {
      id: singleSelectedItem.id,
      name: singleSelectedItem.name,
      mimeType: singleSelectedItem.mimeType,
      size: singleSelectedItem.size || '--',
      sizeBytes: singleSelectedItem.sizeBytes ? String(singleSelectedItem.sizeBytes) : '0',
      date: singleSelectedItem.modifiedTime || singleSelectedItem.createdAt || '',
      access: singleSelectedItem.ownerName || 'Shared',
      webViewLink: singleSelectedItem.webViewLink,
      providerFileId: singleSelectedItem.providerFileId || singleSelectedItem.id,
    }
  }, [singleSelectedItem])

  const previewFiles: FileItem[] = useMemo(() => {
    return filteredItems.map((item: any) => ({
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      size: item.size || '--',
      sizeBytes: item.sizeBytes ? String(item.sizeBytes) : '0',
      date: item.modifiedTime || item.createdAt || '',
      access: item.ownerName || 'Shared',
      webViewLink: item.webViewLink,
      providerFileId: item.providerFileId || item.id,
    }))
  }, [filteredItems])

  const activeFileItem: FileItem | null = useMemo(() => {
    if (!activeItem) return null
    return {
      id: activeItem.id,
      name: activeItem.name,
      mimeType: activeItem.mimeType,
      size: activeItem.size || '--',
      sizeBytes: activeItem.sizeBytes ? String(activeItem.sizeBytes) : '0',
      date: activeItem.modifiedTime || activeItem.createdAt || '',
      access: activeItem.ownerName || 'Shared',
      webViewLink: activeItem.webViewLink,
      providerFileId: activeItem.providerFileId || activeItem.id,
    }
  }, [activeItem])

  return (
    <div className="flex h-full flex-col min-w-0 select-none">
      {/* 1. Header Toolbar with Google Drive Segmented Tabs */}
      <div className="flex items-center justify-between px-4 sm:px-6 pt-3 pb-2 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center gap-1 p-1 bg-[#f0f4f9] dark:bg-[#282a2d] rounded-full border border-slate-200/60 dark:border-slate-800/60">
          <button
            type="button"
            onClick={() => {
              setActiveTab('with_me')
              setSelectedIds(new Set())
            }}
            className={cn(
              'px-4 py-1.5 rounded-full text-xs font-medium transition cursor-pointer',
              activeTab === 'with_me'
                ? 'bg-white dark:bg-[#1e1f20] text-[#0b57d0] dark:text-[#a8c7fa] shadow-sm font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            )}
          >
            {vi ? 'Được chia sẻ với tôi' : 'Shared with me'}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('by_me')
              setSelectedIds(new Set())
            }}
            className={cn(
              'px-4 py-1.5 rounded-full text-xs font-medium transition cursor-pointer',
              activeTab === 'by_me'
                ? 'bg-white dark:bg-[#1e1f20] text-[#0b57d0] dark:text-[#a8c7fa] shadow-sm font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            )}
          >
            {vi ? 'Tôi đã chia sẻ' : 'Shared by me'}
          </button>
        </div>
      </div>

      {/* 2. Filter Chips */}
      <div className="px-4 sm:px-6 pt-2 pb-1">
        <FilterChips
          filters={filters}
          accounts={connectedAccounts}
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
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto">
              <div className="w-40 h-40 mb-4 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800/60">
                <Users className="w-20 h-20 text-slate-400 stroke-[1.25]" />
              </div>
              <h3 className="text-lg font-normal text-slate-800 dark:text-slate-100 mb-1">
                {activeTab === 'with_me'
                  ? (vi ? 'Chưa có tệp nào được chia sẻ với bạn' : 'No files shared with you')
                  : (vi ? 'Bạn chưa chia sẻ tệp nào' : 'No files shared by you')}
              </h3>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {activeTab === 'with_me'
                  ? (vi
                      ? 'Các tệp người khác chia sẻ cho bạn từ Google Drive hoặc HCDrive sẽ xuất hiện tại đây.'
                      : 'Files shared with your Google Drive or HCDrive will appear here.')
                  : (vi
                      ? 'Các tệp bạn tạo liên kết công khai hoặc chia sẻ cho người khác sẽ xuất hiện tại đây.'
                      : 'Files you share via links or invites will appear here.')}
              </p>
            </div>
          ) : activeTab === 'with_me' ? (
            /* Tab: Được chia sẻ với tôi */
            <div className="overflow-x-auto select-none">
              <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="w-10 py-3 pl-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded cursor-pointer accent-[#0b57d0]"
                        checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="py-3 font-semibold min-w-[220px]">{vi ? 'Tên' : 'Name'}</th>
                    <th className="py-3 font-semibold">{vi ? 'Người chia sẻ' : 'Shared by'}</th>
                    <th className="py-3 font-semibold">{vi ? 'Ngày chia sẻ' : 'Share date'}</th>
                    <th className="py-3 font-semibold hidden md:table-cell">{vi ? 'Nguồn' : 'Source'}</th>
                    <th className="py-3 pr-3 text-right font-semibold w-12" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {(filteredItems as SharedWithMeItem[]).map((file) => {
                    const isSelected = selectedIds.has(file.id)
                    const visual = getFileVisual(file.mimeType)
                    const Icon = visual.icon
                    return (
                      <tr
                        key={`withme-${file.id}`}
                        onClick={() => toggleSelect(file.id)}
                        onDoubleClick={() => handleViewItem(file)}
                        onContextMenu={(e) => handleContextMenu(e, file)}
                        className={cn(
                          'h-12 cursor-pointer transition group',
                          isSelected
                            ? 'bg-[#c2e7ff]/50 dark:bg-[#004a77]/40 text-blue-900 dark:text-blue-100 font-medium'
                            : 'hover:bg-slate-100/60 dark:hover:bg-[#282a2d]/60 text-slate-700 dark:text-slate-200'
                        )}
                      >
                        <td className="py-2.5 pl-3 w-10">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded cursor-pointer accent-[#0b57d0]"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation()
                              toggleSelect(file.id)
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>

                        {/* Name + Source badge */}
                        <td className="py-2.5 pr-4 min-w-[220px]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon className={cn('h-4.5 w-4.5 shrink-0', visual.color)} />
                            <span className="truncate font-medium text-xs sm:text-sm" title={file.name}>
                              {file.name}
                            </span>
                          </div>
                        </td>

                        {/* Shared by */}
                        <td className="py-2.5 text-slate-600 dark:text-slate-300 text-xs">
                          <div className="flex items-center gap-2 truncate">
                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-200 text-[10px] font-bold flex items-center justify-center shrink-0">
                              {file.ownerName ? file.ownerName.charAt(0).toUpperCase() : 'U'}
                            </div>
                            <span className="truncate" title={file.ownerEmail || file.ownerName}>
                              {file.ownerName}
                            </span>
                          </div>
                        </td>

                        {/* Date shared */}
                        <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                          {formatDriveDate(file.sharedWithMeTime || file.modifiedTime, lang)}
                        </td>

                        {/* Source */}
                        <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs hidden md:table-cell">
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium',
                            file.source === 'google_drive'
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                              : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                          )}>
                            {file.source === 'google_drive' ? 'Google Drive' : 'HCDrive'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 pr-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => handleContextMenu(e, file)}
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
            /* Tab: Tôi đã chia sẻ */
            <div className="overflow-x-auto select-none">
              <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="w-10 py-3 pl-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded cursor-pointer accent-[#0b57d0]"
                        checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="py-3 font-semibold min-w-[220px]">{vi ? 'Tên' : 'Name'}</th>
                    <th className="py-3 font-semibold">{vi ? 'Chia sẻ với' : 'Shared with'}</th>
                    <th className="py-3 font-semibold">{vi ? 'Loại chia sẻ' : 'Share type'}</th>
                    <th className="py-3 font-semibold">{vi ? 'Ngày sửa đổi' : 'Last modified'}</th>
                    <th className="py-3 pr-3 text-right font-semibold w-12" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {(filteredItems as SharedByMeItem[]).map((file) => {
                    const isSelected = selectedIds.has(file.id)
                    const visual = getFileVisual(file.mimeType)
                    const Icon = visual.icon
                    return (
                      <tr
                        key={`byme-${file.id}`}
                        onClick={() => toggleSelect(file.id)}
                        onDoubleClick={() => manageSharing(file)}
                        onContextMenu={(e) => handleContextMenu(e, file)}
                        className={cn(
                          'h-12 cursor-pointer transition group',
                          isSelected
                            ? 'bg-[#c2e7ff]/50 dark:bg-[#004a77]/40 text-blue-900 dark:text-blue-100 font-medium'
                            : 'hover:bg-slate-100/60 dark:hover:bg-[#282a2d]/60 text-slate-700 dark:text-slate-200'
                        )}
                      >
                        <td className="py-2.5 pl-3 w-10">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded cursor-pointer accent-[#0b57d0]"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation()
                              toggleSelect(file.id)
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>

                        {/* Name */}
                        <td className="py-2.5 pr-4 min-w-[220px]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon className={cn('h-4.5 w-4.5 shrink-0', visual.color)} />
                            <span className="truncate font-medium text-xs sm:text-sm" title={file.name}>
                              {file.name}
                            </span>
                          </div>
                        </td>

                        {/* Shared with */}
                        <td className="py-2.5 text-slate-600 dark:text-slate-300 text-xs">
                          <div className="flex items-center gap-2">
                            <AvatarStack count={2} />
                            <span className="truncate text-xs text-slate-500">
                              {file.sharedWith}
                            </span>
                          </div>
                        </td>

                        {/* Share type */}
                        <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <LinkIcon className="h-3 w-3 text-blue-500" />
                            <span>{file.shareType}</span>
                          </span>
                        </td>

                        {/* Modified time */}
                        <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                          {formatDriveDate(file.modifiedTime, lang)}
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 pr-3 text-right">
                          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {file.shareKind !== 'invite' ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  manageSharing(file)
                                }}
                                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5"
                                title={(file.hcdriveId || file.ninedriveId) ? (vi ? 'Quản lý quyền chia sẻ' : 'Manage share') : (vi ? 'Mở trên Google Drive để quản lý' : 'Manage on Google Drive')}
                              >
                                <Share2 className="h-4 w-4" />
                              </button>
                            ) : null}
                            {file.shareKind !== 'google' ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  revokeSharing(file)
                                }}
                                className="p-1.5 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                                title={vi ? 'Thu hồi chia sẻ' : 'Stop sharing'}
                              >
                                <Link2Off className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 4. Details Panel (i) */}
        <DetailsPanel
          open={detailOpen}
          file={singleSelectedFileItem}
          folder={null}
          selectedCount={selectedIds.size}
          totalSelectedBytes={BigInt(singleSelectedItem?.sizeBytes || 0)}
          onClose={() => setDetailOpen(false)}
          onShare={() => {
            if (singleSelectedItem && activeTab === 'by_me') manageSharing(singleSelectedItem as SharedByMeItem)
            else if (singleSelectedItem?.webViewLink) window.open(singleSelectedItem.webViewLink, '_blank', 'noopener')
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
        onView={() => activeItem && handleViewItem(activeItem)}
        onDownload={() => {
          if (activeItem) handleDownloadItem(activeItem)
          setContextMenu({ x: 0, y: 0, file: null })
        }}
        onDetails={() => {
          setDetailOpen(true)
          setContextMenu({ x: 0, y: 0, file: null })
        }}
        onShare={() => {
          if (activeItem && activeTab === 'by_me') manageSharing(activeItem as SharedByMeItem)
          else if (activeItem?.webViewLink) window.open(activeItem.webViewLink, '_blank', 'noopener')
          setContextMenu({ x: 0, y: 0, file: null })
        }}
        onCopyLink={() => {
          if (activeItem?.webViewLink) {
            navigator.clipboard.writeText(activeItem.webViewLink)
            showSnackbar(vi ? 'Đã sao chép đường liên kết' : 'Link copied to clipboard')
          }
          setContextMenu({ x: 0, y: 0, file: null })
        }}
        onDelete={activeTab === 'by_me' && activeItem && (activeItem as SharedByMeItem).shareKind !== 'google'
          ? () => {
              revokeSharing(activeItem as SharedByMeItem)
              setContextMenu({ x: 0, y: 0, file: null })
            }
          : undefined}
        deleteLabel={vi ? 'Thu hồi chia sẻ' : 'Stop sharing'}
      />

      {/* 6. Google File Preview */}
      <GoogleFilePreview
        open={previewOpen}
        file={activeFileItem}
        files={previewFiles}
        onClose={() => setPreviewOpen(false)}
        onShare={(f) => {
          const item = byMeFiles.find((entry) => entry.id === f.id)
          if (item) manageSharing(item)
          else if (f.webViewLink) window.open(f.webViewLink, '_blank', 'noopener')
        }}
        onDownload={(f) => handleDownloadItem(f)}
        onNavigateFile={(f) => {
          const found = filteredItems.find((item: any) => item.id === f.id)
          setActiveItem(found || f)
        }}
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
