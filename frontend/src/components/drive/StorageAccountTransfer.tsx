import { useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

type ImportResult = { index: number; provider: string; label: string; status: 'imported' | 'updated' | 'failed'; message?: string }

// "Export JSON" / "Import JSON" on the storage accounts page: every storage account the user owns
// (Google refresh tokens, S3 keys, proxies) as one file, and that file (or an rclone token) back in.
export function StorageAccountTransfer({ vi, canExport, canImport, onImported }: { vi: boolean; canExport: boolean; canImport: boolean; onImported: () => void }) {
  const [exportOpen, setExportOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [results, setResults] = useState<ImportResult[] | null>(null)

  async function runExport(event: FormEvent) {
    event.preventDefault()
    setExporting(true)
    setExportError('')
    try {
      const data = await apiFetch<{ accounts: unknown[] }>('/connected-accounts/export', { method: 'POST', body: JSON.stringify({ password: password || undefined }) })
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `hcdrive-storage-accounts-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportOpen(false)
      setPassword('')
    } catch (error) {
      setExportError(error instanceof Error ? error.message : vi ? 'Xuất thất bại' : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function runImport(file: File) {
    setImporting(true)
    setImportError('')
    setResults(null)
    try {
      let payload: unknown
      try {
        payload = JSON.parse(await file.text())
      } catch {
        throw new Error(vi ? 'Tệp không phải JSON hợp lệ.' : 'The file is not valid JSON.')
      }
      const data = await apiFetch<{ imported: number; failed: number; results: ImportResult[] }>('/connected-accounts/import', { method: 'POST', body: JSON.stringify(payload) })
      setResults(data.results)
      if (data.imported > 0) onImported()
    } catch (error) {
      setImportError(error instanceof Error ? error.message : vi ? 'Nhập thất bại' : 'Import failed')
      setResults([])
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const statusLabel: Record<ImportResult['status'], string> = vi
    ? { imported: 'Đã thêm', updated: 'Đã cập nhật', failed: 'Lỗi' }
    : { imported: 'Added', updated: 'Updated', failed: 'Failed' }

  return (
    <>
      {canExport ? (
        <Button variant="outline" size="sm" onClick={() => { setExportError(''); setExportOpen(true) }} className="gap-1.5 text-xs font-medium rounded-full" title={vi ? 'Tải các tài khoản của bạn về một tệp JSON' : 'Download your accounts as a JSON file'}>
          <Download className="h-4 w-4" />
          <span>{vi ? 'Xuất JSON' : 'Export JSON'}</span>
        </Button>
      ) : null}
      {canImport ? (
        <>
          <Button variant="outline" size="sm" disabled={importing} onClick={() => fileInputRef.current?.click()} className="gap-1.5 text-xs font-medium rounded-full" title={vi ? 'Thêm tài khoản từ tệp JSON đã xuất hoặc token rclone' : 'Add accounts from an exported JSON file or an rclone token'}>
            <Upload className="h-4 w-4" />
            <span>{importing ? (vi ? 'Đang nhập...' : 'Importing...') : (vi ? 'Nhập JSON' : 'Import JSON')}</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) runImport(file)
            }}
          />
        </>
      ) : null}

      <DummyModal
        open={exportOpen}
        title={vi ? 'Xuất tài khoản lưu trữ ra JSON' : 'Export storage accounts to JSON'}
        description={vi ? 'Gồm mọi tài khoản bạn sở hữu: refresh token Google, OAuth riêng, khoá S3 và proxy.' : 'Every account you own: Google refresh tokens, your OAuth client, S3 keys and proxies.'}
        onClose={() => setExportOpen(false)}
      >
        <form onSubmit={runExport} className="grid gap-3">
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {vi
              ? 'Ai có tệp này đều vào được Drive và bucket S3 của bạn. Cất ở nơi an toàn, đừng gửi qua chat hay email.'
              : 'Whoever has this file can open your Drives and S3 buckets. Keep it somewhere safe; do not send it over chat or email.'}
          </p>
          <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
            {vi ? 'Mật khẩu HCDrive' : 'HCDrive password'}
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus />
            <span className="font-normal text-slate-400">{vi ? 'Bỏ trống nếu tài khoản được tạo bằng đăng nhập Google (chưa có mật khẩu).' : 'Leave empty if the account was created by Google sign-in (no password).'}</span>
          </label>
          {exportError ? <p className="text-xs text-red-600 dark:text-red-400">{exportError}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="text" type="button" onClick={() => setExportOpen(false)}>{vi ? 'Huỷ' : 'Cancel'}</Button>
            <Button variant="filled" type="submit" disabled={exporting}>{exporting ? (vi ? 'Đang xuất...' : 'Exporting...') : (vi ? 'Tải tệp JSON' : 'Download JSON')}</Button>
          </div>
        </form>
      </DummyModal>

      <DummyModal
        open={results !== null}
        title={vi ? 'Kết quả nhập JSON' : 'Import results'}
        description={results && results.length > 0 ? (vi ? `${results.filter((r) => r.status !== 'failed').length}/${results.length} tài khoản đã vào HCDrive` : `${results.filter((r) => r.status !== 'failed').length} of ${results.length} accounts imported`) : undefined}
        onClose={() => setResults(null)}
      >
        <div className="grid gap-3 text-xs">
          {importError ? <p className="text-red-600 dark:text-red-400">{importError}</p> : null}
          {results && results.length > 0 ? (
            <ul className="max-h-[50vh] divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto rounded-lg border border-slate-200/80 dark:border-slate-800">
              {results.map((result) => (
                <li key={result.index} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800 dark:text-slate-200">{result.label}</p>
                    <p className="text-slate-400">{result.provider === 's3' ? 'S3' : 'Google Drive'}{result.message ? ` · ${result.message}` : ''}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', result.status === 'failed' ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300')}>
                    {statusLabel[result.status]}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-slate-400">
            {vi
              ? 'Nhận tệp HCDrive đã xuất, hoặc token rclone ({"access_token": ..., "refresh_token": ...}). Token Google chỉ dùng được với đúng OAuth client đã cấp nó.'
              : 'Accepts an HCDrive export or an rclone token ({"access_token": ..., "refresh_token": ...}). A Google token only works with the OAuth client that issued it.'}
          </p>
          <div className="flex justify-end"><Button variant="filled" onClick={() => setResults(null)}>{vi ? 'Đóng' : 'Close'}</Button></div>
        </div>
      </DummyModal>
    </>
  )
}
