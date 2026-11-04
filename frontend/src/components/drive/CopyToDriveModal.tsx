import { useState, useEffect } from 'react'
import { Copy, HardDrive, Loader2 } from 'lucide-react'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'

export type CopyToDriveItem = {
  type: 'file' | 'folder'
  id: string
  name: string
  currentAccountId?: string
}

type ConnectedAccountItem = {
  id: string
  email: string
  displayName?: string | null
  provider: string
}

type FolderOption = {
  id: string
  name: string
  parentId: string | null
}

export function CopyToDriveModal({
  open,
  onClose,
  item,
  connectedAccounts,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  item: CopyToDriveItem | null
  connectedAccounts: ConnectedAccountItem[]
  onSuccess?: () => void
}) {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const vi = lang === 'vi'

  const [targetAccountId, setTargetAccountId] = useState('')
  const [targetFolderId, setTargetFolderId] = useState('')
  const [copyName, setCopyName] = useState('')
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [accountFolders, setAccountFolders] = useState<FolderOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!open || !item) return
    setCopyName(item.name)
    setErrorMsg('')
    setTargetFolderId('')

    // Prefer an account different from current account if available
    const otherAccount = connectedAccounts.find((a) => a.id !== item.currentAccountId)
    const initialAccount = otherAccount || connectedAccounts[0]
    if (initialAccount) {
      setTargetAccountId(initialAccount.id)
    }
  }, [open, item, connectedAccounts])

  // Load folders when targetAccountId changes
  useEffect(() => {
    if (!open || !targetAccountId) return
    setLoadingFolders(true)
    apiFetch<{ folders: FolderOption[] }>(`/folders?all=1&accountId=${encodeURIComponent(targetAccountId)}`)
      .then((res) => {
        setAccountFolders(res.folders || [])
      })
      .catch(() => {
        // Fallback to all folders
        apiFetch<{ folders: FolderOption[] }>('/folders?all=1')
          .then((res) => setAccountFolders(res.folders || []))
          .catch(() => setAccountFolders([]))
      })
      .finally(() => setLoadingFolders(false))
  }, [open, targetAccountId])

  async function handleCopy(e: React.FormEvent) {
    e.preventDefault()
    if (!item || !targetAccountId) return
    setSubmitting(true)
    setErrorMsg('')

    try {
      if (item.type === 'file') {
        await apiFetch(`/files/${item.id}/copy-to`, {
          method: 'POST',
          body: JSON.stringify({
            targetAccountId,
            targetFolderId: targetFolderId || null,
            name: copyName.trim() || undefined,
          }),
        })
      } else {
        await apiFetch(`/folders/${item.id}/copy-to`, {
          method: 'POST',
          body: JSON.stringify({
            targetAccountId,
            targetParentFolderId: targetFolderId || null,
            name: copyName.trim() || undefined,
          }),
        })
      }

      const targetAccount = connectedAccounts.find((a) => a.id === targetAccountId)
      const targetLabel = targetAccount?.displayName || targetAccount?.email || ''
      showSnackbar(
        vi
          ? `Đã sao chép "${item.name}" sang ${targetLabel} thành công!`
          : `Copied "${item.name}" to ${targetLabel} successfully!`
      )

      onClose()
      onSuccess?.()
    } catch (err: any) {
      setErrorMsg(err.message || (vi ? 'Sao chép thất bại. Vui lòng thử lại.' : 'Copy failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!item) return null

  return (
    <DummyModal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Copy className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          {vi ? 'Sao chép sang Drive khác' : 'Copy to another Drive'}
        </span>
      }
      description={
        vi
          ? `Sao chép ${item.type === 'folder' ? 'thư mục' : 'tệp'} "${item.name}" sang tài khoản lưu trữ khác.`
          : `Copy ${item.type === 'folder' ? 'folder' : 'file'} "${item.name}" to another connected account.`
      }
      className="sm:max-w-lg"
    >
      <form onSubmit={handleCopy} className="mt-4 space-y-4">
        {errorMsg && (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/50 p-3 text-xs font-medium text-red-600 dark:text-red-400">
            {errorMsg}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            {vi ? 'Tên bản sao' : 'Copy name'}
          </label>
          <Input
            value={copyName}
            onChange={(e) => setCopyName(e.target.value)}
            disabled={submitting}
            placeholder={item.name}
            required
            className="h-10 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            {vi ? 'Tài khoản đích' : 'Destination Account'}
          </label>
          <select
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
            disabled={submitting}
            required
            className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#282a2c] px-3 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {connectedAccounts.map((account) => {
              const isCurrent = account.id === item.currentAccountId
              return (
                <option key={account.id} value={account.id}>
                  {account.displayName || account.email} (
                  {account.provider === 'google_drive' ? 'Google Drive' : 'S3 Storage'}
                  {isCurrent ? ` - ${vi ? 'Nguồn hiện tại' : 'Current source'}` : ''})
                </option>
              )
            })}
          </select>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            {vi
              ? 'Tệp hoặc thư mục sẽ được truyền trực tiếp sang tài khoản này.'
              : 'Files will be streamed directly into this account.'}
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            {vi ? 'Thư mục đích' : 'Destination Folder'}
          </label>
          <div className="relative">
            <select
              value={targetFolderId}
              onChange={(e) => setTargetFolderId(e.target.value)}
              disabled={submitting || loadingFolders}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#282a2c] px-3 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            >
              <option value="">
                {vi ? '📁 Thư mục gốc Drive (9drive / Root)' : '📁 Root Drive (9drive / Root)'}
              </option>
              {accountFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  📁 {f.name}
                </option>
              ))}
            </select>
            {loadingFolders && (
              <div className="absolute right-3 top-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 p-3 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2.5">
          <HardDrive className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="leading-relaxed">
            {vi ? (
              <span>
                Quá trình sao chép giữa các tài khoản sẽ truyền luồng dữ liệu an toàn (stream) trực tiếp qua backend mà không lưu tệp vào ổ đĩa máy chủ.
              </span>
            ) : (
              <span>
                Cross-account copy streams file content securely through the backend directly to the destination without saving to local server disk.
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl px-4 text-xs font-semibold"
          >
            {vi ? 'Hủy' : 'Cancel'}
          </Button>
          <Button
            type="submit"
            disabled={submitting || !targetAccountId}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 text-xs font-semibold flex items-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting
              ? vi
                ? 'Đang sao chép…'
                : 'Copying…'
              : vi
                ? 'Bắt đầu sao chép'
                : 'Start Copy'}
          </Button>
        </div>
      </form>
    </DummyModal>
  )
}
