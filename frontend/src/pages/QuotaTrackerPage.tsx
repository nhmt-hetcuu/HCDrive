import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  HardDrive,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  ArrowUpDown,
  Database,
  Globe,
  Users,
  MoreVertical,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { Input } from '@/components/ui/input'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { GoogleConnectModal } from '@/components/drive/GoogleConnectModal'
import { StorageAccountDetailsModal } from '@/components/drive/StorageAccountDetailsModal'
import { StorageAccountTransfer } from '@/components/drive/StorageAccountTransfer'
import { UploadRoutingPanel } from '@/components/drive/UploadRoutingPanel'
import { API_URL, apiFetch, formatBytes, formatDriveDate } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { getStoredUser } from '@/lib/auth'
import { useMenuPosition } from '@/hooks/useMenuPosition'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import type { FileItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

type StorageSummary = { totalBytes: string; usedBytes: string; availableBytes: string }
type ConnectedAccount = {
  id: string
  email: string
  displayName?: string | null
  provider: string
  status: string
  lastError?: string | null
  isShared?: boolean
  isOwner?: boolean
  ownerEmail?: string | null
  hasProxy?: boolean
  hasCookie?: boolean
  connectedVia?: string | null
  /** Masked: credentials are shown as ***. */
  proxyUrl?: string | null
  storageAccount?: {
    totalBytes: string | null
    usedBytes: string
    availableBytes: string | null
    lastSyncedAt: string | null
  } | null
}

type DriveItem = {
  id: string
  name: string
  mimeType: string
  size: string
  sizeBytes: string
  modifiedTime?: string | null
  webViewLink?: string | null
  webContentLink?: string | null
  iconLink?: string | null
  thumbnailLink?: string | null
  parents?: string[]
  driveId?: string | null
  isFolder: boolean
}

type BrowseBreadcrumb = {
  id: string
  name: string
}

const ACCOUNT_COLORS = [
  '#0b57d0', // Google Drive Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#f43f5e', // Rose
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#6366f1', // Indigo
]

export function QuotaTrackerPage() {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const location = useLocation()
  const navigate = useNavigate()
  const vi = lang === 'vi'

  const isAccountsRoute = location.pathname.startsWith('/accounts')

  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null)
  const [googleModalOpen, setGoogleModalOpen] = useState(false)
  const [googleInitialMethod, setGoogleInitialMethod] = useState<'rclone' | 'custom' | undefined>(undefined)

  // Storage page large files
  const [largeFiles, setLargeFiles] = useState<FileItem[]>([])
  const [loadingLargeFiles, setLoadingLargeFiles] = useState(false)
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  // Live Drive Explorer states
  const [selectedAccountForFiles, setSelectedAccountForFiles] = useState<ConnectedAccount | null>(null)
  const [browsePath, setBrowsePath] = useState<BrowseBreadcrumb[]>([{ id: 'root', name: 'Drive của tôi' }])
  const [liveItems, setLiveItems] = useState<DriveItem[]>([])
  const [loadingLive, setLoadingLive] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [deleteItemTarget, setDeleteItemTarget] = useState<DriveItem | null>(null)
  const [disconnectAccountTarget, setDisconnectAccountTarget] = useState<ConnectedAccount | null>(null)
  const [emptyTrashTarget, setEmptyTrashTarget] = useState<ConnectedAccount | null>(null)
  const [emptyingTrash, setEmptyingTrash] = useState(false)
  const [canConnectStorage, setCanConnectStorage] = useState(false)
  const [accountMenu, setAccountMenu] = useState<{ account: ConnectedAccount; x: number; y: number } | null>(null)
  const [detailsAccountId, setDetailsAccountId] = useState<string | null>(null)
  const isAdmin = Boolean(getStoredUser()?.isAdmin)

  // S3-compatible storage
  const emptyS3Form = { name: '', bucket: '', region: 'us-east-1', endpoint: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: false, quotaGb: '' }
  const [s3Open, setS3Open] = useState(false)
  const [s3Form, setS3Form] = useState(emptyS3Form)
  const [connectingS3, setConnectingS3] = useState(false)
  const [s3Error, setS3Error] = useState('')

  // Per-account proxy
  const [proxyAccount, setProxyAccount] = useState<ConnectedAccount | null>(null)
  const [proxyInput, setProxyInput] = useState('')
  const [savingProxy, setSavingProxy] = useState(false)
  const [testingProxy, setTestingProxy] = useState(false)
  const [proxyResult, setProxyResult] = useState<{ success: boolean; latencyMs: number; error?: string } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadData() {
    setLoading(true)
    try {
      const [summaryData, accountData] = await Promise.all([
        apiFetch<StorageSummary>('/storage/summary'),
        apiFetch<{ accounts: ConnectedAccount[]; canConnectStorage?: boolean }>('/connected-accounts'),
      ])
      setSummary(summaryData)
      setAccounts(accountData.accounts || [])
      setCanConnectStorage(Boolean(accountData.canConnectStorage))
    } catch (err: any) {
      console.warn('Failed to load storage data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadStorageFiles(order: 'desc' | 'asc' = sortOrder) {
    setLoadingLargeFiles(true)
    try {
      const data = await apiFetch<{ files: any[] }>(`/files?scope=all&sort=size&order=${order}&limit=100`)
      const mapped: FileItem[] = (data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size || formatBytes(f.sizeBytes),
        sizeBytes: f.sizeBytes ? String(f.sizeBytes) : '0',
        date: f.updatedAt || f.createdAt,
        accountEmail: f.connectedAccount?.email,
        accountId: f.connectedAccountId,
        webViewLink: f.webViewLink,
        providerFileId: f.providerFileId,
      }))
      setLargeFiles(mapped)
    } catch {
      // quiet fallback
    } finally {
      setLoadingLargeFiles(false)
    }
  }

  useEffect(() => {
    loadData()
    if (!isAccountsRoute) {
      loadStorageFiles('desc')
    }
  }, [location.pathname])

  // Account changes alter the totals in the sidebar too.
  async function reloadAccounts() {
    await loadData()
    window.dispatchEvent(new Event('hcdrive:storage-changed'))
    window.dispatchEvent(new Event('9drive:storage-changed'))
  }

  async function connectS3(event: FormEvent) {
    event.preventDefault()
    setConnectingS3(true)
    setS3Error('')
    try {
      const quotaGb = Number(s3Form.quotaGb)
      await apiFetch('/connected-accounts/s3', {
        method: 'POST',
        body: JSON.stringify({
          name: s3Form.name,
          bucket: s3Form.bucket,
          region: s3Form.region,
          endpoint: s3Form.endpoint.trim() || undefined,
          accessKeyId: s3Form.accessKeyId,
          secretAccessKey: s3Form.secretAccessKey,
          forcePathStyle: s3Form.forcePathStyle,
          quotaBytes: s3Form.quotaGb && quotaGb > 0 ? String(Math.round(quotaGb * 1024 ** 3)) : null,
        }),
      })
      setS3Open(false)
      setS3Form(emptyS3Form)
      showSnackbar(vi ? 'Đã kết nối bộ nhớ S3' : 'S3 storage connected')
      await reloadAccounts()
    } catch (err) {
      setS3Error(err instanceof Error ? err.message : vi ? 'Không kết nối được S3' : 'Could not connect S3')
    } finally {
      setConnectingS3(false)
    }
  }

  function openProxy(acc: ConnectedAccount) {
    setProxyAccount(acc)
    // The saved URL comes back masked, so the field starts empty instead of being prefilled with ***.
    setProxyInput('')
    setProxyResult(null)
  }

  async function saveProxy(proxyUrl: string | null) {
    if (!proxyAccount) return
    setSavingProxy(true)
    try {
      await apiFetch(`/connected-accounts/${proxyAccount.id}/proxy`, { method: 'PATCH', body: JSON.stringify({ proxyUrl }) })
      showSnackbar(proxyUrl
        ? (vi ? `Đã lưu proxy cho ${proxyAccount.email}` : `Proxy saved for ${proxyAccount.email}`)
        : (vi ? `Đã bỏ proxy của ${proxyAccount.email}` : `Proxy removed for ${proxyAccount.email}`))
      setProxyAccount(null)
      await loadData()
    } catch (err) {
      setProxyResult({ success: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setSavingProxy(false)
    }
  }

  async function testProxy() {
    if (!proxyAccount) return
    setTestingProxy(true)
    setProxyResult(null)
    try {
      setProxyResult(await apiFetch<{ success: boolean; latencyMs: number; error?: string }>(`/connected-accounts/${proxyAccount.id}/test-proxy`, {
        method: 'POST',
        body: JSON.stringify({ proxyUrl: proxyInput.trim() || undefined }),
      }))
    } catch (err) {
      setProxyResult({ success: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTestingProxy(false)
    }
  }

  async function toggleShared(acc: ConnectedAccount) {
    try {
      const next = !acc.isShared
      await apiFetch(`/connected-accounts/${acc.id}/share`, { method: 'PATCH', body: JSON.stringify({ isShared: next }) })
      showSnackbar(next
        ? (vi ? `Mọi người dùng HCDrive giờ dùng chung ${acc.email}` : `${acc.email} is now shared with every HCDrive user`)
        : (vi ? `${acc.email} chỉ còn mình bạn dùng` : `${acc.email} is private again`))
      await reloadAccounts()
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không đổi được chế độ dùng chung' : 'Could not change sharing')
    }
  }

  async function syncQuota(accountId: string) {
    setSyncingAccountId(accountId)
    try {
      await apiFetch(`/connected-accounts/${accountId}/sync-quota`, { method: 'POST' })
      showSnackbar(vi ? 'Đã đồng bộ dung lượng' : 'Quota synced')
      await reloadAccounts()
    } catch (err: any) {
      showSnackbar(vi ? 'Đồng bộ thất bại' : 'Sync failed')
    } finally {
      setSyncingAccountId(null)
    }
  }

  async function handleDisconnectAccount() {
    if (!disconnectAccountTarget) return
    try {
      await apiFetch(`/connected-accounts/${disconnectAccountTarget.id}`, { method: 'DELETE' })
      showSnackbar(vi ? 'Đã ngắt kết nối tài khoản' : 'Account disconnected')
      setDisconnectAccountTarget(null)
      await reloadAccounts()
    } catch (err: any) {
      showSnackbar(err?.message || (vi ? 'Không thể ngắt kết nối' : 'Failed to disconnect'))
    }
  }

  // Live folder browsing for selected account
  async function loadLiveFolder(accountId: string, parentId: string = 'root') {
    setLoadingLive(true)
    try {
      const data = await apiFetch<{ parentId: string; items: DriveItem[] }>(
        `/connected-accounts/${accountId}/drive-items?parentId=${parentId}`
      )
      setLiveItems(data.items || [])
    } catch (err: any) {
      showSnackbar(vi ? 'Không thể tải tệp từ Google Drive' : 'Failed to load drive items')
    } finally {
      setLoadingLive(false)
    }
  }

  function openAccountExplorer(acc: ConnectedAccount) {
    if (acc.provider !== 'google_drive') return
    if (acc.connectedVia === 'cookie') {
      showSnackbar(vi ? 'Tài khoản kết nối bằng Cookie dùng để stream và vượt quyền riêng tư trong Khóa học / Chia sẻ.' : 'Cookie account is used for streaming & bypassing private files in Courses / Shares.')
      return
    }
    setSelectedAccountForFiles(acc)
    setBrowsePath([{ id: 'root', name: vi ? 'Drive của tôi' : 'My Drive' }])
    loadLiveFolder(acc.id, 'root')
  }

  function openLiveFolder(folder: DriveItem) {
    if (!selectedAccountForFiles) return
    const nextPath = [...browsePath, { id: folder.id, name: folder.name }]
    setBrowsePath(nextPath)
    loadLiveFolder(selectedAccountForFiles.id, folder.id)
  }

  function navigateToBreadcrumb(index: number) {
    if (!selectedAccountForFiles) return
    const target = browsePath[index]
    setBrowsePath(browsePath.slice(0, index + 1))
    loadLiveFolder(selectedAccountForFiles.id, target.id)
  }

  async function handleCreateLiveFolder(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccountForFiles || !newFolderName.trim()) return
    setCreatingFolder(true)
    try {
      const currentParent = browsePath[browsePath.length - 1]?.id || 'root'
      await apiFetch(`/connected-accounts/${selectedAccountForFiles.id}/drive-folder`, {
        method: 'POST',
        body: JSON.stringify({ name: newFolderName.trim(), parentId: currentParent }),
      })
      setNewFolderName('')
      setNewFolderModalOpen(false)
      showSnackbar(vi ? 'Đã tạo thư mục' : 'Folder created')
      await loadLiveFolder(selectedAccountForFiles.id, currentParent)
    } catch {
      showSnackbar(vi ? 'Không thể tạo thư mục' : 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  async function handleDeleteLiveItem() {
    if (!selectedAccountForFiles || !deleteItemTarget) return
    try {
      await apiFetch(`/connected-accounts/${selectedAccountForFiles.id}/drive-item/${deleteItemTarget.id}`, {
        method: 'DELETE',
      })
      showSnackbar(vi ? `Đã xoá ${deleteItemTarget.name}` : `Deleted ${deleteItemTarget.name}`)
      setDeleteItemTarget(null)
      const currentParent = browsePath[browsePath.length - 1]?.id || 'root'
      await loadLiveFolder(selectedAccountForFiles.id, currentParent)
    } catch {
      showSnackbar(vi ? 'Xoá thất bại' : 'Delete failed')
    }
  }

  // Uploads go straight into the Drive folder that is open in the explorer (shared drives too),
  // one file after another, streamed through HCDrive without touching its disk.
  async function handleUploadToAccount(e: React.ChangeEvent<HTMLInputElement>) {
    const account = selectedAccountForFiles
    if (!e.target.files || e.target.files.length === 0 || !account) return
    const filesToUpload = Array.from(e.target.files)
    e.target.value = ''
    const parentId = browsePath[browsePath.length - 1]?.id || 'root'
    if (parentId === '__shared_drives__') {
      showSnackbar(vi ? 'Mở một Drive dùng chung trước rồi mới tải lên.' : 'Open a shared drive first.')
      return
    }
    let done = 0
    for (const file of filesToUpload) {
      showSnackbar(vi ? `Đang tải lên ${file.name} (${done + 1}/${filesToUpload.length})...` : `Uploading ${file.name} (${done + 1}/${filesToUpload.length})...`)
      try {
        const params = new URLSearchParams({ parentId, name: file.name, mimeType: file.type || 'application/octet-stream' })
        const response = await fetch(`${API_URL}/connected-accounts/${account.id}/drive-items/upload?${params}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getAccessToken()}`, 'Content-Type': 'application/octet-stream' },
          body: file,
        })
        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: response.statusText }))
          throw new Error(error.message)
        }
        done += 1
      } catch (error) {
        showSnackbar(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`)
      }
    }
    if (done > 0) showSnackbar(vi ? `Đã tải lên ${done}/${filesToUpload.length} tệp vào ${account.email}` : `Uploaded ${done} of ${filesToUpload.length} files to ${account.email}`)
    loadLiveFolder(account.id, parentId)
  }

  async function emptyGoogleTrash() {
    if (!emptyTrashTarget) return
    setEmptyingTrash(true)
    try {
      await apiFetch(`/connected-accounts/${emptyTrashTarget.id}/empty-trash`, { method: 'POST' })
      showSnackbar(vi ? `Đã dọn sạch thùng rác Google của ${emptyTrashTarget.email}` : `Emptied the Google trash of ${emptyTrashTarget.email}`)
      setEmptyTrashTarget(null)
      await reloadAccounts()
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : vi ? 'Không dọn được thùng rác' : 'Could not empty the trash')
    } finally {
      setEmptyingTrash(false)
    }
  }

  const totalUsedBytes = BigInt(summary?.usedBytes || 0)
  const totalCapacityBytes = BigInt(summary?.totalBytes || 0)

  return (
    <div className="flex h-full flex-col min-w-0 select-none">
      {/* View 1: If an account's Live Explorer is open */}
      {selectedAccountForFiles ? (
        <div className="flex flex-col h-full">
          {/* Breadcrumb Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="text"
                size="sm"
                onClick={() => setSelectedAccountForFiles(null)}
                className="h-8 w-8 p-0 rounded-full"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium truncate">
                <span className="text-slate-500">{selectedAccountForFiles.email}</span>
                {browsePath.map((item, idx) => (
                  <span key={item.id} className="flex items-center gap-1.5">
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <button
                      type="button"
                      onClick={() => navigateToBreadcrumb(idx)}
                      className={cn(
                        'truncate cursor-pointer hover:underline',
                        idx === browsePath.length - 1
                          ? 'text-slate-900 dark:text-white font-semibold'
                          : 'text-slate-500'
                      )}
                    >
                      {item.name}
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Live Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="text"
                size="sm"
                onClick={() => setNewFolderModalOpen(true)}
                className="h-8 gap-1.5 text-xs text-[#0b57d0] dark:text-[#a8c7fa]"
              >
                <FolderPlus className="h-4 w-4" />
                <span className="hidden sm:inline">{vi ? 'Thư mục mới' : 'New Folder'}</span>
              </Button>
              <Button
                variant="filled"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 gap-1.5 text-xs"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">{vi ? 'Tải lên' : 'Upload'}</span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleUploadToAccount}
              />
            </div>
          </div>

          {/* Live items table */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {loadingLive ? (
              <div className="space-y-3 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
                ))}
              </div>
            ) : liveItems.length === 0 ? (
              <div className="py-20 text-center text-xs text-slate-400">
                {vi ? 'Thư mục này trống.' : 'This folder is empty.'}
              </div>
            ) : (
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 min-w-[200px]">{vi ? 'Tên' : 'Name'}</th>
                    <th className="py-2.5">{vi ? 'Sửa đổi lần cuối' : 'Last modified'}</th>
                    <th className="py-2.5">{vi ? 'Kích thước' : 'Size'}</th>
                    <th className="py-2.5 pr-2 text-right w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {liveItems.map((item) => {
                    const visual = getFileVisual(item.mimeType)
                    const Icon = item.isFolder ? FolderIcon : visual.icon
                    return (
                      <tr
                        key={item.id}
                        onDoubleClick={() => {
                          if (item.isFolder) openLiveFolder(item)
                          else if (item.webViewLink) window.open(item.webViewLink, '_blank')
                        }}
                        className="h-12 cursor-pointer hover:bg-slate-100/60 dark:hover:bg-[#282a2d]/60 group transition"
                      >
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon className={cn('h-4.5 w-4.5 shrink-0', item.isFolder ? 'text-slate-500' : visual.color)} />
                            <span className="truncate font-medium">{item.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">
                          {formatDriveDate(item.modifiedTime, lang)}
                        </td>
                        <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">
                          {item.isFolder ? '--' : item.size}
                        </td>
                        <td className="py-2.5 pr-2 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteItemTarget(item)
                            }}
                            className="p-1 rounded-full text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={vi ? 'Xoá' : 'Delete'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : isAccountsRoute ? (
        /* View 2: /accounts (Tài khoản lưu trữ) */
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200/80 dark:border-slate-800">
            <h1 className="text-xl font-normal text-slate-800 dark:text-slate-100">
              {vi ? 'Tài khoản lưu trữ' : 'Storage Accounts'}
            </h1>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StorageAccountTransfer
                vi={vi}
                canExport={accounts.some((acc) => acc.isOwner)}
                canImport={canConnectStorage}
                onImported={() => { reloadAccounts().catch(() => undefined) }}
              />
            {canConnectStorage ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setS3Error(''); setS3Open(true) }}
                  className="gap-1.5 text-xs font-medium rounded-full"
                >
                  <Database className="h-4 w-4" />
                  <span>{vi ? 'Kết nối S3' : 'Connect S3'}</span>
                </Button>
                <Button
                  variant="tonal"
                  size="sm"
                  onClick={() => { setGoogleInitialMethod(undefined); setGoogleModalOpen(true) }}
                  className="gap-1.5 text-xs font-medium rounded-full"
                >
                  <Plus className="h-4 w-4" />
                  <span>{vi ? 'Kết nối Google Drive' : 'Connect Google Drive'}</span>
                </Button>
              </>
            ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {loading ? (
              <div className="space-y-3 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <div className="py-24 text-center max-w-sm mx-auto">
                <HardDrive className="w-16 h-16 text-slate-400 mx-auto mb-3 stroke-[1.25]" />
                <h3 className="text-lg font-normal text-slate-800 dark:text-slate-100 mb-1">
                  {vi ? 'Chưa kết nối tài khoản nào' : 'No connected accounts'}
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  {vi
                    ? 'Kết nối tài khoản Google Drive để mở rộng dung lượng và đồng bộ dữ liệu.'
                    : 'Connect Google Drive accounts to expand storage.'}
                </p>
                {canConnectStorage ? (
                  <Button
                    variant="filled"
                    size="sm"
                    onClick={() => setGoogleModalOpen(true)}
                    className="rounded-full"
                  >
                    {vi ? 'Kết nối ngay' : 'Connect now'}
                  </Button>
                ) : (
                  <p className="text-xs text-slate-400">{vi ? 'Quản trị viên chưa cho phép người dùng tự kết nối bộ nhớ.' : 'An admin has not allowed users to connect storage.'}</p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto select-none">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 min-w-[220px]">{vi ? 'Tên tài khoản' : 'Account'}</th>
                      <th className="py-2.5 min-w-[180px]">{vi ? 'Đã dùng' : 'Storage Used'}</th>
                      <th className="py-2.5 hidden md:table-cell">{vi ? 'Đồng bộ lần cuối' : 'Last sync'}</th>
                      <th className="py-2.5">{vi ? 'Trạng thái' : 'Status'}</th>
                      <th className="py-2.5 pr-2 text-right w-16" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {accounts.map((acc, idx) => {
                      const used = BigInt(acc.storageAccount?.usedBytes || 0)
                      const totalRaw = acc.storageAccount?.totalBytes
                      const total = totalRaw ? BigInt(totalRaw) : null
                      const pct = total && total > 0n ? Math.min(100, Number((used * 100n) / total)) : 0
                      const color = ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length]
                      const canManage = Boolean(acc.isOwner) || isAdmin

                      return (
                        <tr
                          key={acc.id}
                          onClick={() => openAccountExplorer(acc)}
                          className={cn('h-14 hover:bg-slate-100/60 dark:hover:bg-[#282a2d]/60 group transition', acc.provider === 'google_drive' && 'cursor-pointer')}
                        >
                          {/* Name + Badge */}
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                                style={{ backgroundColor: color }}
                              >
                                {acc.email.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <span className="font-medium block truncate text-xs sm:text-sm">
                                  {acc.email}
                                </span>
                                <span className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                                  <span className="uppercase tracking-wider">{acc.provider === 's3' ? 'S3 Storage' : 'Google Drive'}</span>
                                  {acc.isShared ? <span className="rounded-full bg-blue-50 dark:bg-blue-950/50 px-1.5 text-blue-700 dark:text-blue-300">{vi ? 'Dùng chung' : 'Shared'}</span> : null}
                                  {acc.hasProxy ? <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5" title={acc.proxyUrl ?? ''}>Proxy</span> : null}
                                  {!acc.isOwner && acc.ownerEmail ? <span>{vi ? `của ${acc.ownerEmail}` : `owned by ${acc.ownerEmail}`}</span> : null}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Used bar */}
                          <td className="py-2.5 pr-4">
                            <div className="space-y-1 max-w-[160px]">
                              <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${pct}%`, backgroundColor: color }}
                                />
                              </div>
                              <span className="text-[11px] text-slate-500 block">
                                {formatBytes(used)} / {total ? formatBytes(total) : (vi ? 'không giới hạn' : 'unlimited')}
                              </span>
                            </div>
                          </td>

                          {/* Last synced */}
                          <td className="py-2.5 text-slate-500 text-xs hidden md:table-cell whitespace-nowrap">
                            {formatDriveDate(acc.storageAccount?.lastSyncedAt, lang)}
                          </td>

                          {/* Status */}
                          <td className="py-2.5 whitespace-nowrap">
                            {acc.status === 'expired' ? (
                              <div className="flex items-center gap-1.5" title={acc.lastError || ''}>
                                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                <span className="text-xs text-red-600 dark:text-red-400 font-semibold">
                                  {vi ? 'Hết hạn' : 'Expired'}
                                </span>
                              </div>
                            ) : acc.status === 'error' || acc.lastError ? (
                              <div className="flex items-center gap-1.5" title={acc.lastError || ''}>
                                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
                                  {vi ? 'Lỗi' : 'Error'}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                                  {vi ? 'Đã kết nối' : 'Connected'}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-2.5 pr-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDetailsAccountId(acc.id)
                                }}
                                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                title={vi ? 'Xem thông tin tài khoản' : 'Account details'}
                                aria-label={vi ? 'Xem thông tin tài khoản' : 'Account details'}
                              >
                                <Info className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  syncQuota(acc.id)
                                }}
                                disabled={syncingAccountId === acc.id}
                                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                title={vi ? 'Đồng bộ dung lượng' : 'Sync quota'}
                              >
                                <RefreshCw className={cn('h-4 w-4', syncingAccountId === acc.id && 'animate-spin')} />
                              </button>
                              {canManage ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setAccountMenu({ account: acc, x: rect.right, y: rect.bottom + 4 })
                                  }}
                                  className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                  title={vi ? 'Proxy, dùng chung, ngắt kết nối' : 'Proxy, sharing, disconnect'}
                                  aria-label={vi ? 'Tuỳ chọn tài khoản' : 'Account options'}
                                >
                                  <MoreVertical className="h-4 w-4" />
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
            {!loading && accounts.length > 0 ? <div className="mt-6"><UploadRoutingPanel accounts={accounts} vi={vi} /></div> : null}
          </div>
        </div>
      ) : (
        /* View 3: /storage (Bộ nhớ Google Drive) */
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200/80 dark:border-slate-800">
            <h1 className="text-xl font-normal text-slate-800 dark:text-slate-100">
              {vi ? 'Bộ nhớ' : 'Storage'}
            </h1>
            <Link
              to="/settings?tab=system"
              className="text-xs text-[#0b57d0] dark:text-[#a8c7fa] hover:underline font-medium"
            >
              {vi ? 'Bản sao lưu' : 'Backups'}
            </Link>
          </div>

          <div className="px-4 sm:px-6 py-6 space-y-8">
            {/* 1. Storage Big Stat Hero */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1.5 sm:gap-2 mb-3">
                <span className="text-3xl sm:text-4xl font-normal text-slate-900 dark:text-slate-100">
                  {vi ? 'Đã dùng ' : 'Used '}{formatBytes(totalUsedBytes)}
                </span>
                <span className="text-sm sm:text-base text-slate-500 dark:text-slate-400">
                  {vi ? 'trong tổng số ' : 'of '}{formatBytes(totalCapacityBytes)}
                </span>
              </div>

              {/* Segmented Horizontal Progress Bar */}
              <div className="h-3 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                {accounts.map((acc, idx) => {
                  const used = BigInt(acc.storageAccount?.usedBytes || 0)
                  const pct = totalCapacityBytes > 0n ? Math.min(100, Number((used * 1000n) / totalCapacityBytes) / 10) : 0
                  const color = ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length]
                  if (pct <= 0) return null
                  return (
                    <div
                      key={acc.id}
                      style={{ width: `${pct}%`, backgroundColor: color }}
                      className="h-full transition-all"
                      title={`${acc.email}: ${formatBytes(used)} (${pct.toFixed(1)}%)`}
                    />
                  )
                })}
              </div>

              {/* Account Legend Dots */}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
                {accounts.map((acc, idx) => {
                  const used = BigInt(acc.storageAccount?.usedBytes || 0)
                  const color = ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length]
                  return (
                    <div key={acc.id} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-medium text-slate-700 dark:text-slate-300">{acc.email}</span>
                      <span className="text-slate-400">({formatBytes(used)})</span>
                    </div>
                  )
                })}
              </div>

              {/* Action Buttons */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/accounts')}
                  className="rounded-full text-xs h-8 px-4"
                >
                  {vi ? 'Quản lý tài khoản lưu trữ' : 'Manage storage accounts'}
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => navigate('/trash')}
                  className="text-xs h-8 text-[#0b57d0] dark:text-[#a8c7fa]"
                >
                  {vi ? 'Dọn dẹp bộ nhớ' : 'Clean up storage'}
                </Button>
              </div>
            </div>

            {/* 2. Files Sorted by Storage Used */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {vi ? 'Tệp chiếm nhiều bộ nhớ nhất' : 'Files using storage'}
                </h2>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    const nextOrder = sortOrder === 'desc' ? 'asc' : 'desc'
                    setSortOrder(nextOrder)
                    loadStorageFiles(nextOrder)
                  }}
                  className="h-7 text-xs gap-1 text-slate-500"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span>{sortOrder === 'desc' ? (vi ? 'Dung lượng giảm dần' : 'Largest first') : (vi ? 'Dung lượng tăng dần' : 'Smallest first')}</span>
                </Button>
              </div>

              <div className="overflow-x-auto select-none border border-slate-200/60 dark:border-slate-800 rounded-2xl">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 bg-[#f0f4f9]/50 dark:bg-[#282a2d]/50">
                      <th className="py-2.5 pl-4 min-w-[240px]">{vi ? 'Tên' : 'Name'}</th>
                      <th className="py-2.5 hidden md:table-cell">{vi ? 'Chủ sở hữu' : 'Owner'}</th>
                      <th className="py-2.5 pr-4 text-right">{vi ? 'Bộ nhớ đã sử dụng' : 'Storage used'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {loadingLargeFiles ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="h-12 animate-pulse">
                          <td className="py-2.5 pl-4"><div className="h-4 w-48 bg-slate-100 dark:bg-slate-800 rounded" /></td>
                          <td className="py-2.5 hidden md:table-cell"><div className="h-4 w-24 bg-slate-100 dark:bg-slate-800 rounded" /></td>
                          <td className="py-2.5 pr-4 text-right"><div className="h-4 w-16 bg-slate-100 dark:bg-slate-800 rounded ml-auto" /></td>
                        </tr>
                      ))
                    ) : largeFiles.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-xs text-slate-400">
                          {vi ? 'Chưa có tệp nào trong bộ nhớ.' : 'No files found in storage.'}
                        </td>
                      </tr>
                    ) : (
                      largeFiles.map((file) => {
                        const visual = getFileVisual(file.mimeType)
                        const Icon = visual.icon
                        return (
                          <tr
                            key={file.id}
                            onClick={() => {
                              if (file.webViewLink) window.open(file.webViewLink, '_blank')
                            }}
                            className="h-12 cursor-pointer hover:bg-slate-100/60 dark:hover:bg-[#282a2d]/60 transition"
                          >
                            <td className="py-2.5 pl-4 pr-4">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Icon className={cn('h-4 w-4 shrink-0', visual.color)} />
                                <span className="truncate font-medium">{file.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 text-slate-500 text-xs hidden md:table-cell truncate">
                              {file.accountEmail ? file.accountEmail.split('@')[0] : 'Tôi'}
                            </td>
                            <td className="py-2.5 pr-4 text-right text-slate-700 dark:text-slate-300 font-medium text-xs whitespace-nowrap">
                              {file.size}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. Phân bổ tải lên (Upload Routing Policy) */}
            <UploadRoutingPanel accounts={accounts} vi={vi} />
          </div>
        </div>
      )}

      {/* Google Connect Modal */}
      <GoogleConnectModal open={googleModalOpen} initialMethod={googleInitialMethod} onClose={() => setGoogleModalOpen(false)} onSuccess={() => { reloadAccounts().catch(() => undefined) }} />

      {accountMenu ? (
        <AccountActionsMenu
          x={accountMenu.x}
          y={accountMenu.y}
          account={accountMenu.account}
          vi={vi}
          onClose={() => setAccountMenu(null)}
          onDetails={() => { setDetailsAccountId(accountMenu.account.id); setAccountMenu(null) }}
          onProxy={() => { openProxy(accountMenu.account); setAccountMenu(null) }}
          onToggleShared={() => { toggleShared(accountMenu.account); setAccountMenu(null) }}
          onDisconnect={() => { setDisconnectAccountTarget(accountMenu.account); setAccountMenu(null) }}
          onEmptyTrash={accountMenu.account.provider === 'google_drive' && accountMenu.account.isOwner ? () => { setEmptyTrashTarget(accountMenu.account); setAccountMenu(null) } : undefined}
        />
      ) : null}

      <StorageAccountDetailsModal accountId={detailsAccountId} vi={vi} isAdmin={isAdmin} onClose={() => setDetailsAccountId(null)} onReconnect={canConnectStorage ? () => { setDetailsAccountId(null); setGoogleModalOpen(true) } : undefined} />

      {/* Modal: Connect S3-compatible storage */}
      <DummyModal
        open={s3Open}
        title={vi ? 'Kết nối bộ nhớ S3' : 'Connect S3 storage'}
        description={vi ? 'Amazon S3 hoặc dịch vụ tương thích S3 (MinIO, Cloudflare R2, Wasabi...).' : 'Amazon S3 or an S3-compatible service (MinIO, Cloudflare R2, Wasabi...).'}
        onClose={() => setS3Open(false)}
      >
        <form onSubmit={connectS3} className="grid gap-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">{vi ? 'Tên hiển thị' : 'Display name'}<Input value={s3Form.name} onChange={(e) => setS3Form({ ...s3Form, name: e.target.value })} required /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Bucket<Input value={s3Form.bucket} onChange={(e) => setS3Form({ ...s3Form, bucket: e.target.value })} required /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Region<Input value={s3Form.region} onChange={(e) => setS3Form({ ...s3Form, region: e.target.value })} required /></label>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Endpoint <span className="font-normal text-slate-400">{vi ? '(bỏ trống nếu dùng Amazon S3)' : '(leave empty for Amazon S3)'}</span><Input type="url" value={s3Form.endpoint} onChange={(e) => setS3Form({ ...s3Form, endpoint: e.target.value })} placeholder="https://s3.example.com" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Access key ID<Input value={s3Form.accessKeyId} onChange={(e) => setS3Form({ ...s3Form, accessKeyId: e.target.value })} autoComplete="off" required /></label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Secret access key<Input type="password" value={s3Form.secretAccessKey} onChange={(e) => setS3Form({ ...s3Form, secretAccessKey: e.target.value })} autoComplete="new-password" required /></label>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">{vi ? 'Hạn mức (GB)' : 'Quota (GB)'} <span className="font-normal text-slate-400">{vi ? '(bỏ trống = không giới hạn)' : '(empty = unlimited)'}</span><Input type="number" min="0" step="any" value={s3Form.quotaGb} onChange={(e) => setS3Form({ ...s3Form, quotaGb: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={s3Form.forcePathStyle} onChange={(e) => setS3Form({ ...s3Form, forcePathStyle: e.target.checked })} />{vi ? 'Dùng path-style (thường cần cho MinIO)' : 'Use path-style addressing (usually needed for MinIO)'}</label>
          {s3Error ? <p className="text-xs text-red-600 dark:text-red-400">{s3Error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="text" type="button" onClick={() => setS3Open(false)}>{vi ? 'Huỷ' : 'Cancel'}</Button>
            <Button variant="filled" type="submit" disabled={connectingS3}>{connectingS3 ? (vi ? 'Đang kết nối...' : 'Connecting...') : (vi ? 'Kết nối' : 'Connect')}</Button>
          </div>
        </form>
      </DummyModal>

      {/* Modal: Proxy for one account */}
      <DummyModal
        open={Boolean(proxyAccount)}
        title={vi ? 'Proxy cho tài khoản' : 'Account proxy'}
        description={proxyAccount?.email ?? ''}
        onClose={() => setProxyAccount(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (proxyInput.trim()) saveProxy(proxyInput.trim())
          }}
          className="grid gap-3"
        >
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {proxyAccount?.hasProxy
              ? (vi ? `Đang dùng: ${proxyAccount.proxyUrl}` : `Current: ${proxyAccount.proxyUrl}`)
              : (vi ? 'Tài khoản này đang kết nối trực tiếp, không qua proxy.' : 'This account connects directly, without a proxy.')}
          </p>
          <Input value={proxyInput} onChange={(e) => setProxyInput(e.target.value)} placeholder="socks5://user:pass@host:1080" autoComplete="off" />
          <p className="text-[11px] text-slate-400">
            {vi
              ? 'Hỗ trợ http://, https://, socks5:// và socks5h:// (phân giải tên miền ở phía proxy). Mọi lệnh gọi Google Drive của tài khoản này sẽ đi qua proxy.'
              : 'Supports http://, https://, socks5:// and socks5h:// (host names resolved by the proxy). Every Google Drive call for this account goes through it.'}
          </p>
          {proxyResult ? (
            <p className={cn('text-xs', proxyResult.success ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {proxyResult.success
                ? (vi ? `Proxy hoạt động (${proxyResult.latencyMs} ms)` : `Proxy works (${proxyResult.latencyMs} ms)`)
                : `${vi ? 'Lỗi' : 'Failed'}: ${proxyResult.error ?? ''}`}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {proxyAccount?.hasProxy ? (
              <Button variant="text" type="button" disabled={savingProxy} onClick={() => saveProxy(null)} className="mr-auto text-red-600">{vi ? 'Bỏ proxy' : 'Remove proxy'}</Button>
            ) : null}
            <Button variant="outline" type="button" disabled={testingProxy || (!proxyInput.trim() && !proxyAccount?.hasProxy)} onClick={testProxy}>{testingProxy ? (vi ? 'Đang thử...' : 'Testing...') : (vi ? 'Thử kết nối' : 'Test')}</Button>
            <Button variant="filled" type="submit" disabled={savingProxy || !proxyInput.trim()}>{vi ? 'Lưu' : 'Save'}</Button>
          </div>
        </form>
      </DummyModal>

      {/* Modal: Create Folder in Live Explorer */}
      <DummyModal
        open={newFolderModalOpen}
        title={vi ? 'Thư mục mới trên Google Drive' : 'New Folder on Google Drive'}
        onClose={() => setNewFolderModalOpen(false)}
      >
        <form onSubmit={handleCreateLiveFolder} className="space-y-4 pt-2">
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={vi ? 'Tên thư mục' : 'Folder name'}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="text" type="button" onClick={() => setNewFolderModalOpen(false)}>
              {vi ? 'Huỷ' : 'Cancel'}
            </Button>
            <Button variant="filled" type="submit" disabled={creatingFolder || !newFolderName.trim()}>
              {creatingFolder ? (vi ? 'Đang tạo...' : 'Creating...') : (vi ? 'Tạo' : 'Create')}
            </Button>
          </div>
        </form>
      </DummyModal>

      {/* Modal: Delete Item Confirmation */}
      <DummyModal
        open={Boolean(deleteItemTarget)}
        title={vi ? 'Xoá mục trên Google Drive?' : 'Delete from Google Drive?'}
        description={
          vi
            ? `Bạn có chắc muốn xoá "${deleteItemTarget?.name}" khỏi Google Drive?`
            : `Are you sure you want to delete "${deleteItemTarget?.name}" from Google Drive?`
        }
        onClose={() => setDeleteItemTarget(null)}
      >
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="text" onClick={() => setDeleteItemTarget(null)}>
            {vi ? 'Huỷ' : 'Cancel'}
          </Button>
          <Button variant="filled" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteLiveItem}>
            {vi ? 'Xoá' : 'Delete'}
          </Button>
        </div>
      </DummyModal>

      {/* Modal: Empty the account's Google trash */}
      <DummyModal
        open={Boolean(emptyTrashTarget)}
        title={vi ? 'Dọn sạch thùng rác Google?' : 'Empty the Google trash?'}
        description={vi
          ? `Mọi thứ trong thùng rác Google Drive của ${emptyTrashTarget?.email ?? ''} bị xoá vĩnh viễn, kể cả mục HCDrive không hiển thị. Không hoàn tác được.`
          : `Everything in the Google Drive trash of ${emptyTrashTarget?.email ?? ''} is deleted for good, including items HCDrive does not show. This cannot be undone.`}
        onClose={() => setEmptyTrashTarget(null)}
      >
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="text" onClick={() => setEmptyTrashTarget(null)}>{vi ? 'Huỷ' : 'Cancel'}</Button>
          <Button variant="filled" className="bg-red-600 hover:bg-red-700 text-white" disabled={emptyingTrash} onClick={emptyGoogleTrash}>
            {emptyingTrash ? (vi ? 'Đang dọn...' : 'Emptying...') : (vi ? 'Dọn sạch' : 'Empty trash')}
          </Button>
        </div>
      </DummyModal>

      {/* Modal: Disconnect Account Confirmation */}
      <DummyModal
        open={Boolean(disconnectAccountTarget)}
        title={vi ? 'Ngắt kết nối tài khoản?' : 'Disconnect Account?'}
        description={
          vi
            ? `Ngắt kết nối "${disconnectAccountTarget?.email}". Các tệp đã lưu trên tài khoản này vẫn được bảo toàn trên Google Drive.`
            : `Disconnect "${disconnectAccountTarget?.email}". Files stored on Google Drive remain safe.`
        }
        onClose={() => setDisconnectAccountTarget(null)}
      >
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="text" onClick={() => setDisconnectAccountTarget(null)}>
            {vi ? 'Huỷ' : 'Cancel'}
          </Button>
          <Button variant="filled" className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDisconnectAccount}>
            {vi ? 'Ngắt kết nối' : 'Disconnect'}
          </Button>
        </div>
      </DummyModal>
    </div>
  )
}

function AccountActionsMenu({ x, y, account, vi, onClose, onDetails, onProxy, onToggleShared, onDisconnect, onEmptyTrash }: {
  x: number
  y: number
  account: ConnectedAccount
  vi: boolean
  onClose: () => void
  onDetails: () => void
  onProxy: () => void
  onToggleShared: () => void
  onDisconnect: () => void
  onEmptyTrash?: () => void
}) {
  // Anchored at the ⋮ button's bottom-right; the hook flips/clamps it inside the viewport.
  const { menuRef, style } = useMenuPosition({ x, y, onClose })
  const item = 'flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] text-left cursor-pointer hover:bg-slate-100 dark:hover:bg-[#282a2c]'
  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default bg-transparent" aria-label="Close menu" onClick={onClose} />
      <div ref={menuRef} style={style} className="w-64 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#1e1f20] p-1.5 shadow-xl text-slate-700 dark:text-slate-200">
        <button type="button" className={item} onClick={onDetails}>
          <Info className="h-4 w-4 text-slate-500" />
          <span className="flex-1">{vi ? 'Xem thông tin' : 'Details'}</span>
        </button>
        {account.provider === 'google_drive' ? (
          <button type="button" className={item} onClick={onProxy}>
            <Globe className="h-4 w-4 text-slate-500" />
            <span className="flex-1">{vi ? 'Cài proxy' : 'Proxy settings'}</span>
            {account.hasProxy ? <span className="text-[11px] text-[#0b57d0] dark:text-[#a8c7fa]">{vi ? 'Đang bật' : 'On'}</span> : null}
          </button>
        ) : null}
        <button type="button" className={item} onClick={onToggleShared}>
          <Users className="h-4 w-4 text-slate-500" />
          <span className="flex-1">{account.isShared ? (vi ? 'Thôi dùng chung' : 'Stop sharing with everyone') : (vi ? 'Dùng chung cho mọi người' : 'Share with every user')}</span>
        </button>
        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        {onEmptyTrash ? (
          <button type="button" className={cn(item, 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40')} onClick={onEmptyTrash}>
            <Trash2 className="h-4 w-4" />
            <span className="flex-1">{vi ? 'Dọn thùng rác Google' : 'Empty Google trash'}</span>
          </button>
        ) : null}
        <button type="button" className={cn(item, 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40')} onClick={onDisconnect}>
          <Trash2 className="h-4 w-4" />
          <span className="flex-1">{vi ? 'Ngắt kết nối' : 'Disconnect'}</span>
        </button>
      </div>
    </>
  )
}
