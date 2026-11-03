import { useEffect, useState } from 'react'
import {
  RotateCcw,
  Trash2,
  Trash,
  Folder as FolderIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { DriveToolbar } from '@/components/drive/DriveToolbar'
import { getFileVisual } from '@/components/drive/DriveGridView'
import { apiFetch, formatBytes, formatDriveDate } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { cn } from '@/lib/utils'

type TrashFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  provider: string
  deletedAt: string
  folder?: { id: string; name: string } | null
  connectedAccount?: {
    email: string
    provider: string
  }
}

export function TrashPage() {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const vi = lang === 'vi'

  const [files, setFiles] = useState<TrashFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')

  // Modals
  const [emptyTrashModalOpen, setEmptyTrashModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [targetDeleteIds, setTargetDeleteIds] = useState<string[]>([])
  const [restoreModalOpen, setRestoreModalOpen] = useState(false)
  const [targetRestoreFile, setTargetRestoreFile] = useState<TrashFile | null>(null)

  async function loadTrash() {
    setLoading(true)
    try {
      const data = await apiFetch<{ files: TrashFile[] }>('/files/trash')
      setFiles(data.files || [])
    } catch (error) {
      showSnackbar(vi ? 'Không thể tải thùng rác' : 'Failed to load trash')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTrash().catch(() => undefined)
    // Files trashed on drive.google.com reach this list through the sync; the server skips it when
    // one ran in the last couple of minutes.
    apiFetch<{ results: { created: number; updated: number; deleted: number }[] }>('/files/sync-google', { method: 'POST', body: JSON.stringify({}) })
      .then((res) => {
        if (res.results.some((r) => r.created > 0 || r.updated > 0 || r.deleted > 0)) {
          return apiFetch<{ files: TrashFile[] }>('/files/trash').then((data) => setFiles(data.files || []))
        }
      })
      .catch(() => undefined)
  }, [])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === files.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)))
    }
  }

  // Both actions take the items off the list at once and talk to Google in the background; a
  // failure puts the list back from the server.
  function dropFromList(ids: string[]) {
    const gone = new Set(ids)
    setFiles((prev) => prev.filter((f) => !gone.has(f.id)))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }

  async function handleRestore(ids: string[]) {
    if (ids.length === 0) return
    setRestoreModalOpen(false)
    dropFromList(ids)
    showSnackbar(vi ? `Đang khôi phục ${ids.length} mục...` : `Restoring ${ids.length} item(s)...`)
    try {
      await apiFetch('/files/batch/restore', {
        method: 'POST',
        body: JSON.stringify({ fileIds: ids }),
      })
      showSnackbar(
        vi ? `Đã khôi phục ${ids.length} mục` : `Restored ${ids.length} item(s)`
      )
      window.dispatchEvent(new Event('hcdrive:storage-changed'))
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      showSnackbar(vi ? 'Khôi phục tệp thất bại' : 'Failed to restore files')
      loadTrash().catch(() => undefined)
    }
  }

  function promptPermanentDelete(ids: string[]) {
    setTargetDeleteIds(ids)
    setDeleteModalOpen(true)
  }

  async function confirmPermanentDelete() {
    const ids = targetDeleteIds
    if (ids.length === 0) return
    setDeleteModalOpen(false)
    setEmptyTrashModalOpen(false)
    dropFromList(ids)
    showSnackbar(vi ? `Đang xoá vĩnh viễn ${ids.length} tệp...` : `Deleting ${ids.length} file(s)...`)
    try {
      const result = await apiFetch<{ deleted: number; failed: Array<{ fileId: string; message: string }> }>('/files/batch/permanent', {
        method: 'DELETE',
        body: JSON.stringify({ fileIds: ids }),
      })
      if (result.failed?.length) {
        showSnackbar(vi ? `Đã xoá ${result.deleted} tệp, ${result.failed.length} tệp không xoá được` : `Deleted ${result.deleted}, ${result.failed.length} could not be deleted`)
        loadTrash().catch(() => undefined)
      } else {
        showSnackbar(vi ? `Đã xoá vĩnh viễn ${result.deleted} tệp` : `Permanently deleted ${result.deleted} file(s)`)
      }
      window.dispatchEvent(new Event('hcdrive:storage-changed'))
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : vi ? 'Xoá vĩnh viễn thất bại' : 'Permanent delete failed')
      loadTrash().catch(() => undefined)
    }
  }

  function handleDoubleClick(file: TrashFile) {
    setTargetRestoreFile(file)
    setRestoreModalOpen(true)
  }

  return (
    <div className="flex h-full flex-col min-w-0 select-none">
      {/* 1. Drive Toolbar */}
      <DriveToolbar
        title={vi ? 'Thùng rác' : 'Trash'}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        lang={lang}
      />

      {/* 2. Google Drive Trash Banner */}
      <div className="px-4 sm:px-6 pt-1 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-full bg-[#f0f4f9] dark:bg-[#282a2d] border border-slate-200/60 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
          <span>
            {vi
              ? 'Các mục trong thùng rác vẫn chiếm dung lượng cho tới khi bạn xoá vĩnh viễn.'
              : 'Items in trash take up storage space until deleted permanently.'}
          </span>
          {files.length > 0 && (
            <Button
              variant="text"
              size="sm"
              onClick={() => setEmptyTrashModalOpen(true)}
              className="text-xs h-7 px-3 text-[#0b57d0] dark:text-[#a8c7fa] font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              {vi ? 'Dọn sạch thùng rác' : 'Empty trash'}
            </Button>
          )}
        </div>
      </div>

      {/* 3. Multi-selection Bar */}
      {selectedIds.size > 0 && (
        <div className="px-4 sm:px-6 pb-2">
          <div className="flex items-center justify-between px-4 py-2 rounded-full bg-[#c2e7ff] dark:bg-[#004a77] text-slate-800 dark:text-slate-100 text-xs font-medium">
            <span>
              {vi ? `Đã chọn ${selectedIds.size} mục` : `Selected ${selectedIds.size} item(s)`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="text"
                size="sm"
                onClick={() => handleRestore(Array.from(selectedIds))}
                className="h-7 px-2.5 text-xs text-slate-800 dark:text-slate-100 gap-1.5 hover:bg-black/10 dark:hover:bg-white/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{vi ? 'Khôi phục' : 'Restore'}</span>
              </Button>
              <Button
                variant="text"
                size="sm"
                onClick={() => promptPermanentDelete(Array.from(selectedIds))}
                className="h-7 px-2.5 text-xs text-red-700 dark:text-red-300 gap-1.5 hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{vi ? 'Xoá vĩnh viễn' : 'Delete forever'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Main Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2">
        {loading ? (
          <div className="space-y-3 animate-pulse pt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto">
            <div className="w-40 h-40 mb-4 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800/60">
              <Trash className="w-20 h-20 text-slate-400 stroke-[1.25]" />
            </div>
            <h3 className="text-lg font-normal text-slate-800 dark:text-slate-100 mb-1">
              {vi ? 'Thùng rác trống' : 'Trash is empty'}
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {vi
                ? 'Không có mục nào trong thùng rác.'
                : 'Items moved to trash will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto select-none">
            <table className="w-full min-w-[680px] text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="w-10 py-3 pl-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded cursor-pointer accent-[#0b57d0]"
                      checked={selectedIds.size === files.length && files.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="py-3 font-semibold min-w-[200px]">{vi ? 'Tên' : 'Name'}</th>
                  <th className="py-3 font-semibold">{vi ? 'Ngày chuyển vào thùng rác' : 'Date trashed'}</th>
                  <th className="py-3 font-semibold hidden md:table-cell">{vi ? 'Vị trí ban đầu' : 'Original location'}</th>
                  <th className="py-3 font-semibold hidden lg:table-cell">{vi ? 'Chủ sở hữu' : 'Owner'}</th>
                  <th className="py-3 font-semibold">{vi ? 'Kích cỡ' : 'Size'}</th>
                  <th className="py-3 pr-3 text-right font-semibold w-24" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {files.map((file) => {
                  const isSelected = selectedIds.has(file.id)
                  const visual = getFileVisual(file.mimeType)
                  const Icon = visual.icon
                  return (
                    <tr
                      key={`trash-${file.id}`}
                      onClick={() => toggleSelect(file.id)}
                      onDoubleClick={() => handleDoubleClick(file)}
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
                      <td className="py-2.5 pr-4 min-w-[200px]">
                        <div className="flex items-center gap-3 min-w-0">
                          <Icon className={cn('h-4.5 w-4.5 shrink-0', visual.color)} />
                          <span className="truncate font-medium text-xs sm:text-sm" title={file.name}>
                            {file.name}
                          </span>
                        </div>
                      </td>

                      {/* Date trashed */}
                      <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                        {formatDriveDate(file.deletedAt, lang)}
                      </td>

                      {/* Original location */}
                      <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs hidden md:table-cell">
                        <div className="flex items-center gap-1.5 truncate">
                          <FolderIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="truncate" title={file.folder?.name || (vi ? 'Drive của tôi' : 'My Drive')}>
                            {file.folder?.name || (vi ? 'Drive của tôi' : 'My Drive')}
                          </span>
                        </div>
                      </td>

                      {/* Owner */}
                      <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs hidden lg:table-cell">
                        <span className="truncate block" title={file.connectedAccount?.email || 'Tôi'}>
                          {file.connectedAccount?.email ? file.connectedAccount.email.split('@')[0] : 'Tôi'}
                        </span>
                      </td>

                      {/* Size */}
                      <td className="py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                        {formatBytes(file.sizeBytes)}
                      </td>

                      {/* Row Hover Quick Actions */}
                      <td className="py-2.5 pr-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRestore([file.id])
                            }}
                            className="p-1.5 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                            title={vi ? 'Khôi phục' : 'Restore'}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              promptPermanentDelete([file.id])
                            }}
                            className="p-1.5 rounded-full text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            title={vi ? 'Xoá vĩnh viễn' : 'Delete forever'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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

      {/* 5. Modal: Double-click Restore Confirmation */}
      <DummyModal
        open={restoreModalOpen}
        title={vi ? 'Khôi phục tệp?' : 'Restore file?'}
        description={
          vi
            ? `Tệp "${targetRestoreFile?.name}" đang ở trong thùng rác. Bạn cần khôi phục để có thể mở và xem tệp.`
            : `File "${targetRestoreFile?.name}" is in trash. You need to restore it to view.`
        }
        onClose={() => setRestoreModalOpen(false)}
      >
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="text" onClick={() => setRestoreModalOpen(false)}>
            {vi ? 'Huỷ' : 'Cancel'}
          </Button>
          <Button
            variant="filled"
            onClick={() => {
              if (targetRestoreFile) handleRestore([targetRestoreFile.id])
            }}
          >
            {vi ? 'Khôi phục' : 'Restore'}
          </Button>
        </div>
      </DummyModal>

      {/* 6. Modal: Permanent Delete Confirmation */}
      <DummyModal
        open={deleteModalOpen}
        title={vi ? 'Xoá vĩnh viễn?' : 'Delete permanently?'}
        description={
          vi
            ? `Thao tác này sẽ xoá vĩnh viễn ${targetDeleteIds.length} mục đã chọn và giải phóng dung lượng lưu trữ trên Google Drive. Bạn không thể hoàn tác hành động này.`
            : `This will permanently delete ${targetDeleteIds.length} item(s) and free up storage on Google Drive. This cannot be undone.`
        }
        onClose={() => setDeleteModalOpen(false)}
      >
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="text" onClick={() => setDeleteModalOpen(false)}>
            {vi ? 'Huỷ' : 'Cancel'}
          </Button>
          <Button
            variant="filled"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={confirmPermanentDelete}
          >
            {vi ? 'Xoá vĩnh viễn' : 'Delete forever'}
          </Button>
        </div>
      </DummyModal>

      {/* 7. Modal: Empty Trash Confirmation */}
      <DummyModal
        open={emptyTrashModalOpen}
        title={vi ? 'Dọn sạch thùng rác?' : 'Empty trash?'}
        description={
          vi
            ? `Tất cả ${files.length} mục trong thùng rác sẽ bị xoá vĩnh viễn khỏi Google Drive. Bạn không thể hoàn tác thao tác này.`
            : `All ${files.length} items in trash will be permanently deleted from Google Drive. This cannot be undone.`
        }
        onClose={() => setEmptyTrashModalOpen(false)}
      >
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="text" onClick={() => setEmptyTrashModalOpen(false)}>
            {vi ? 'Huỷ' : 'Cancel'}
          </Button>
          <Button
            variant="filled"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => {
              setTargetDeleteIds(files.map((f) => f.id))
              confirmPermanentDelete()
            }}
          >
            {vi ? 'Dọn sạch thùng rác' : 'Empty trash'}
          </Button>
        </div>
      </DummyModal>
    </div>
  )
}
