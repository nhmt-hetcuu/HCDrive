import { useEffect, useState, useMemo } from 'react'
import {
  ShieldAlert,
  ShieldCheck,
  Clock,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Trash2,
  Sparkles,
  Info,
  Loader2,
} from 'lucide-react'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { getStoredUser } from '@/lib/auth'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import type { FileItem } from '@/data/drive-data'

export type TemporaryGrant = {
  id: string
  targetEmail: string
  duration: '1h' | '24h'
  createdAt: number
  expiresAt: number
  editUrl: string
  googleExpirationSet: boolean
  remainingSeconds: number
}

interface TemporaryEditModalProps {
  open: boolean
  file: FileItem | null
  onClose: () => void
}

export function TemporaryEditModal({ open, file, onClose }: TemporaryEditModalProps) {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const vi = lang === 'vi'

  const user = useMemo(() => getStoredUser(), [])
  const [targetEmail, setTargetEmail] = useState('')
  const [duration, setDuration] = useState<'1h' | '24h'>('1h')
  const [loading, setLoading] = useState(false)
  const [fetchingGrants, setFetchingGrants] = useState(false)
  const [activeGrants, setActiveGrants] = useState<TemporaryGrant[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [ownerInfo, setOwnerInfo] = useState<{ editUrl: string; message: string } | null>(null)

  const fileId = file?.id || file?.providerFileId

  // Initial load of email and active grants
  useEffect(() => {
    if (!open || !file) return
    setErrorMsg(null)
    setOwnerInfo(null)

    // Default target email to user's app email or file account email
    const defaultEmail = user?.email || file.accountEmail || ''
    setTargetEmail(defaultEmail)

    if (fileId) {
      loadGrants(fileId)
    }
  }, [open, file, fileId, user])

  // Periodic tick for remainingSeconds countdown
  useEffect(() => {
    if (!open || activeGrants.length === 0) return
    const timer = setInterval(() => {
      setActiveGrants((prev) =>
        prev
          .map((g) => ({
            ...g,
            remainingSeconds: Math.max(0, Math.floor((g.expiresAt - Date.now()) / 1000)),
          }))
          .filter((g) => g.remainingSeconds > 0)
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [open, activeGrants.length])

  async function loadGrants(id: string) {
    setFetchingGrants(true)
    try {
      const res = await apiFetch<{ grants: TemporaryGrant[] }>(`/files/${id}/temporary-edit-grant`)
      setActiveGrants(res.grants || [])
    } catch {
      setActiveGrants([])
    } finally {
      setFetchingGrants(false)
    }
  }

  async function handleGrant() {
    if (!fileId || !targetEmail.trim()) return
    setLoading(true)
    setErrorMsg(null)
    setOwnerInfo(null)

    try {
      const res = await apiFetch<any>(`/files/${fileId}/temporary-edit-grant`, {
        method: 'POST',
        body: JSON.stringify({
          targetEmail: targetEmail.trim(),
          duration,
        }),
      })

      if (res.status === 'owner') {
        setOwnerInfo({
          editUrl: res.editUrl,
          message:
            res.message ||
            (vi
              ? 'Tài khoản của bạn là chủ sở hữu tệp này trên Google Drive. Bạn có toàn quyền mở và chỉnh sửa trực tiếp.'
              : 'Your account is the owner of this file on Google Drive with full edit access.'),
        })
        showSnackbar(vi ? 'Tài khoản là chủ sở hữu, mở chỉnh sửa trực tiếp' : 'Owner account, edit link ready')
      } else {
        showSnackbar(
          vi
            ? `Đã cấp quyền chỉnh sửa trong vòng ${duration === '24h' ? '24 giờ' : '1 tiếng'}`
            : `Temporary edit granted for ${duration}`
        )
        await loadGrants(fileId)
      }
    } catch (err: any) {
      const msg = err?.message || (vi ? 'Không thể cấp quyền chỉnh sửa.' : 'Failed to grant temporary edit.')
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke(grant?: TemporaryGrant) {
    if (!fileId) return
    setLoading(true)
    try {
      await apiFetch(`/files/${fileId}/temporary-edit-grant`, {
        method: 'DELETE',
        body: JSON.stringify({
          targetEmail: grant?.targetEmail,
          permissionId: (grant as any)?.permissionId,
        }),
      })
      showSnackbar(vi ? 'Đã thu hồi quyền chỉnh sửa' : 'Temporary edit revoked')
      await loadGrants(fileId)
    } catch (err: any) {
      showSnackbar(err?.message || (vi ? 'Không thể thu hồi quyền' : 'Failed to revoke'))
    } finally {
      setLoading(false)
    }
  }

  function handleCopyUrl(url: string) {
    navigator.clipboard.writeText(url)
    setCopied(true)
    showSnackbar(vi ? 'Đã sao chép liên kết chỉnh sửa' : 'Edit link copied')
    setTimeout(() => setCopied(false), 2000)
  }

  function formatRemaining(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) {
      return `${h}h ${m}m ${s}s`
    }
    return `${m}m ${s}s`
  }

  return (
    <DummyModal
      open={open}
      onClose={onClose}
      className="sm:max-w-xl"
      title={
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-medium text-slate-900 dark:text-slate-100">
              {vi ? 'Tự cấp quyền chỉnh sửa tạm thời' : 'Temporary Google Edit Permission'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-sm">
              {file?.name || 'Google Drive File'}
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-4 pt-2">
        {/* Security Rule Warning Note */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="space-y-0.5">
            <p className="font-medium">
              {vi ? 'Quy tắc an toàn bảo mật bắt buộc:' : 'Security protection rule:'}
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              {vi
                ? 'Hệ thống tự động CHẶN tính năng này nếu tệp hoặc bất kỳ thư mục cha nào đang chia sẻ cho mọi người ("Bất kỳ ai có đường liên kết") nhằm chống can thiệp dữ liệu công khai.'
                : 'Blocked automatically if this file or any parent folder is shared with "anyone with the link" to safeguard shared resources.'}
            </p>
          </div>
        </div>

        {/* Error message banner */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 animate-in fade-in">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div className="space-y-1">
              <p className="font-medium">{vi ? 'Không thể thực hiện:' : 'Action restricted:'}</p>
              <p>{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Storage Owner Information */}
        {ownerInfo && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200 space-y-3 animate-in fade-in">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="font-semibold">{vi ? 'Quyền sở hữu tệp' : 'File Owner'}</span>
            </div>
            <p>{ownerInfo.message}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={ownerInfo.editUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition"
              >
                <span>{vi ? 'Mở chỉnh sửa ngay trên Google' : 'Open in Google Docs'}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => handleCopyUrl(ownerInfo.editUrl)}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {vi ? 'Sao chép link' : 'Copy link'}
              </Button>
            </div>
          </div>
        )}

        {/* Active Grants List */}
        {activeGrants.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-blue-500" />
                {vi ? 'Quyền chỉnh sửa đang hoạt động' : 'Active temporary grants'}
              </span>
              <span className="text-[11px] text-slate-400">
                {activeGrants.length} {vi ? 'tài khoản' : 'account(s)'}
              </span>
            </div>

            <div className="space-y-2">
              {activeGrants.map((grant) => (
                <div
                  key={grant.id}
                  className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {grant.targetEmail}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 text-[10px] font-semibold uppercase">
                        {grant.duration}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-mono text-[11px] font-semibold">
                      <Clock className="h-3 w-3 animate-spin text-amber-500" />
                      <span>{formatRemaining(grant.remainingSeconds)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/80">
                    <a
                      href={grant.editUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-[11px] transition"
                    >
                      <span>{vi ? 'Mở chỉnh sửa' : 'Open Editor'}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px] gap-1"
                      onClick={() => handleCopyUrl(grant.editUrl)}
                    >
                      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      {vi ? 'Sao chép' : 'Copy'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={loading}
                      className="h-7 px-2 text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 ml-auto gap-1"
                      onClick={() => handleRevoke(grant)}
                    >
                      <Trash2 className="h-3 w-3" />
                      {vi ? 'Thu hồi sớm' : 'Revoke'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grant Form */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 space-y-3.5">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {vi ? 'Cấp quyền mới cho tài khoản Google:' : 'Grant edit access to Google account:'}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {vi ? 'Địa chỉ Gmail / Google Workspace' : 'Google Email Address'}
            </label>
            <input
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="example@gmail.com"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {file?.accountEmail && file.accountEmail !== targetEmail && (
              <button
                type="button"
                onClick={() => setTargetEmail(file.accountEmail || '')}
                className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                <span>{vi ? 'Dùng email lưu trữ:' : 'Use storage email:'}</span>
                <span className="font-mono">{file.accountEmail}</span>
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {vi ? 'Thời hạn hiệu lực' : 'Duration'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDuration('1h')}
                className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition ${
                  duration === '1h'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <span className="text-xs font-semibold">{vi ? '1 tiếng (1 Giờ)' : '1 Hour (1h)'}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {vi ? 'Phù hợp chỉnh sửa nhanh' : 'Quick edit session'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setDuration('24h')}
                className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition ${
                  duration === '24h'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <span className="text-xs font-semibold">{vi ? '24 tiếng (1 Ngày)' : '24 Hours (24h)'}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {vi ? 'Phù hợp cộng tác dài' : 'Extended collaboration'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading} className="text-xs h-8">
              {vi ? 'Đóng' : 'Close'}
            </Button>
            <Button
              size="sm"
              disabled={loading || !targetEmail.trim() || fetchingGrants}
              onClick={handleGrant}
              className="gap-1.5 text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{vi ? 'Đang cấp quyền...' : 'Granting...'}</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{vi ? 'Cấp quyền chỉnh sửa' : 'Grant Permission'}</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Footer info note */}
        <div className="flex items-start gap-2 text-[11px] text-slate-400 dark:text-slate-500 px-1">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            {vi
              ? 'HCDrive tự động theo dõi và thu hồi quyền ngay sau khi hết thời hạn (áp dụng cho cả Gmail cá nhân và Workspace).'
              : 'HCDrive continuously tracks and automatically revokes permissions upon expiration (compatible with both personal Gmail and Google Workspace).'}
          </span>
        </div>
      </div>
    </DummyModal>
  )
}
