import { useState } from 'react'
import {
  CalendarClock,
  Database,
  ExternalLink,
  Folder,
  HardDrive,
  Info,
  Mail,
  Share2,
  Tag,
  Users,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { DriveDetailsSection } from '@/components/drive/DriveDetailsSection'
import { formatBytes, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Tag
  label: string
  value?: string | null
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 text-xs">
      <Icon className="mt-0.5 h-4 w-4 text-slate-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="mt-0.5 break-words font-semibold text-slate-700 dark:text-slate-200">{value || '-'}</p>
      </div>
    </div>
  )
}

export function DetailsPanel({
  open,
  file,
  folder,
  selectedCount = 0,
  totalSelectedBytes = 0,
  onClose,
  onShare,
  lang,
}: {
  open: boolean
  file: FileItem | null
  folder: FolderItem | null
  selectedCount?: number
  totalSelectedBytes?: number | bigint
  onClose: () => void
  onShare?: () => void
  lang: 'vi' | 'en'
}) {
  const [activeTab, setActiveTab] = useState<'details' | 'activity'>('details')
  const vi = lang === 'vi'

  if (!open) return null

  const isMultiple = selectedCount > 1
  const isFile = Boolean(file && !folder && !isMultiple)
  const isFolder = Boolean(folder && !file && !isMultiple)
  const isEmpty = !isFile && !isFolder && !isMultiple

  const visual = file ? getFileVisual(file.mimeType) : null
  // thumbnailLink: the HCDrive thumbnail proxy URL when the page has one (works without a Google sign-in).
  const thumbUrl = file?.thumbnailLink
    ? `${file.thumbnailLink}${file.thumbnailLink.includes('?') ? '&' : '?'}size=600`
    : file?.providerFileId
      ? `https://drive.google.com/thumbnail?id=${file.providerFileId}&sz=w600`
      : undefined

  return (
    <aside className="w-full sm:w-[340px] xl:w-[360px] shrink-0 border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#1e1f20] flex flex-col h-full animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Info className="h-4 w-4 text-slate-500 shrink-0" />
          <h2 className="text-sm font-bold truncate text-slate-900 dark:text-slate-100">
            {isFile ? file!.name : isFolder ? folder!.name : isMultiple ? (vi ? `${selectedCount} mục đã chọn` : `${selectedCount} items`) : (vi ? 'Thông tin chi tiết' : 'Details')}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200/80 dark:border-slate-800 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('details')}
          className={cn(
            'flex-1 py-2.5 text-center transition border-b-2',
            activeTab === 'details'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          )}
        >
          {vi ? 'Chi tiết' : 'Details'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('activity')}
          className={cn(
            'flex-1 py-2.5 text-center transition border-b-2',
            activeTab === 'activity'
              ? 'border-blue-600 text-blue-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          )}
        >
          {vi ? 'Hoạt động' : 'Activity'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'details' ? (
          <>
            {/* Case 1: Single File Selected */}
            {isFile && file && (
              <div className="space-y-4">
                {/* Large Thumbnail Preview */}
                <div className="w-full h-44 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 overflow-hidden flex items-center justify-center relative">
                  {thumbUrl || file.mimeType?.startsWith('image/') ? (
                    <img
                      src={thumbUrl}
                      alt={file.name}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        e.currentTarget.nextElementSibling?.classList.remove('hidden')
                      }}
                    />
                  ) : null}

                  <div className={cn('flex flex-col items-center justify-center', (thumbUrl || file.mimeType?.startsWith('image/')) ? 'hidden' : '')}>
                    {visual && (
                      <div className={cn('p-4 rounded-2xl', visual.bg)}>
                        <visual.icon className={cn('h-12 w-12', visual.color)} />
                      </div>
                    )}
                    <span className="mt-2 text-xs font-semibold text-slate-500 uppercase">
                      {visual?.label[vi ? 'vi' : 'en']}
                    </span>
                  </div>
                </div>

                {/* Who has access */}
                <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-900/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-blue-600" />
                      {vi ? 'Quyền truy cập' : 'Who has access'}
                    </span>
                    {onShare && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onShare}
                        className="h-7 px-2 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                      >
                        <Share2 className="h-3 w-3 mr-1" />
                        {vi ? 'Quản lý' : 'Manage'}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {file.accountEmail ? `${vi ? 'Chủ sở hữu: ' : 'Owner: '}${file.accountEmail}` : file.access}
                  </p>
                </div>

                {/* File Properties Table */}
                <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 p-3 space-y-1">
                  <DetailRow icon={Tag} label={vi ? 'Tên tệp' : 'File name'} value={file.name} />
                  <DetailRow icon={Database} label={vi ? 'Dung lượng' : 'Size'} value={file.sizeBytes ? formatBytes(file.sizeBytes) : (file.size || '-')} />
                  <DetailRow icon={CalendarClock} label={vi ? 'Lần sửa đổi cuối' : 'Modified'} value={file.createdAt ? formatDate(file.createdAt) : (file.date || '-')} />
                  <DetailRow icon={Mail} label={vi ? 'Tài khoản lưu trữ' : 'Storage Account'} value={file.accountEmail ?? file.access ?? '-'} />
                  <DetailRow icon={HardDrive} label={vi ? 'Nguồn lưu trữ' : 'Provider'} value={file.accountProvider ?? 'Google Drive'} />
                  <DetailRow icon={Folder} label={vi ? 'Vị trí thư mục' : 'Virtual Folder'} value={file.folderName ?? (vi ? 'Gốc (Drive của tôi)' : 'Root (My Drive)')} />
                  <DetailRow icon={Tag} label="MIME Type" value={file.mimeType ?? 'Unknown'} />
                  <DriveDetailsSection file={file} vi={vi} />
                </div>

                {/* Open in Google Drive Link */}
                {file.webViewLink && (
                  <a
                    href={file.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-blue-600 dark:text-blue-400 transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>{vi ? 'Mở trực tiếp trên Google Drive' : 'Open in Google Drive'}</span>
                  </a>
                )}
              </div>
            )}

            {/* Case 2: Single Folder Selected */}
            {isFolder && folder && (
              <div className="space-y-4">
                <div className="w-full h-32 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center">
                  <Folder className={cn('h-14 w-14', folder.color ? folder.color : 'text-slate-500')} />
                  <span className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {vi ? 'Thư mục' : 'Folder'}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 p-3 space-y-1">
                  <DetailRow icon={Tag} label={vi ? 'Tên thư mục' : 'Folder name'} value={folder.name} />
                  <DetailRow icon={CalendarClock} label={vi ? 'Cập nhật' : 'Updated'} value={folder.updated.replace('Updated ', '')} />
                  {folder.accounts && folder.accounts.length > 0 && (
                    <DetailRow
                      icon={Mail}
                      label={vi ? 'Tài khoản chứa' : 'Pooled in Accounts'}
                      value={folder.accounts.map((a) => a.email).join(', ')}
                    />
                  )}
                </div>

                {onShare && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onShare}
                    className="w-full h-10 rounded-xl text-xs font-semibold justify-center"
                  >
                    <Share2 className="h-3.5 w-3.5 mr-1.5" />
                    {vi ? 'Chia sẻ thư mục này' : 'Share this folder'}
                  </Button>
                )}
              </div>
            )}

            {/* Case 3: Multiple Items Selected */}
            {isMultiple && (
              <div className="space-y-4 text-center py-6">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600">
                  <Database className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    {vi ? `Đã chọn ${selectedCount} mục` : `${selectedCount} items selected`}
                  </h3>
                  {Number(totalSelectedBytes) > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      {vi ? `Tổng dung lượng: ${formatBytes(totalSelectedBytes)}` : `Total size: ${formatBytes(totalSelectedBytes)}`}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Case 4: Nothing Selected */}
            {isEmpty && (
              <div className="flex flex-col items-center justify-center h-64 text-center p-4">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
                  <Info className="h-8 w-8" />
                </div>
                <p className="text-xs font-medium text-slate-500 max-w-[200px]">
                  {vi ? 'Chọn một tệp hoặc thư mục để xem thông tin chi tiết.' : 'Select a file or folder to view its details.'}
                </p>
              </div>
            )}
          </>
        ) : (
          /* Activity Tab */
          <div className="py-4 text-center">
            <p className="text-xs text-slate-400">
              {vi ? 'Chưa có hoạt động gần đây.' : 'No recent activity.'}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
