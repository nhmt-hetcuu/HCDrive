import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { apiFetch, formatBytes } from '@/lib/api'
import { useSnackbar } from '@/context/SnackbarContext'
import { cn } from '@/lib/utils'

// How uploads pick a storage account (backend: selectAccount in upload.routes.ts). The order of the
// list is used by "Priority" (fill the first account, then the next) and by "Round robin".

type RoutingMode = 'most_available' | 'round_robin' | 'priority'
type RoutingPolicy = { mode: RoutingMode; priorityAccountIds: string[]; roundRobinCursor: number }
type RoutableAccount = {
  id: string
  email: string
  displayName?: string | null
  provider: string
  storageAccount?: { usedBytes: string; totalBytes: string | null; availableBytes: string | null } | null
}

export function UploadRoutingPanel({ accounts, vi }: { accounts: RoutableAccount[]; vi: boolean }) {
  const { showSnackbar } = useSnackbar()
  const [policy, setPolicy] = useState<RoutingPolicy | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch<{ policy: RoutingPolicy }>('/storage/routing-policy').then((data) => setPolicy(data.policy)).catch(() => undefined)
  }, [])

  async function save(next: Pick<RoutingPolicy, 'mode' | 'priorityAccountIds'>) {
    setSaving(true)
    try {
      const data = await apiFetch<{ policy: RoutingPolicy }>('/storage/routing-policy', { method: 'PATCH', body: JSON.stringify(next) })
      setPolicy(data.policy)
      showSnackbar(vi ? 'Đã lưu cách phân bổ tải lên' : 'Upload routing saved')
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : vi ? 'Không lưu được' : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  // Accounts in the saved order, then the ones not ordered yet (new accounts) at the end.
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const ordered = (policy?.priorityAccountIds ?? []).map((id) => byId.get(id)).filter((account): account is RoutableAccount => Boolean(account))
  const listed = new Set(ordered.map((account) => account.id))
  const orderedAccounts = [...ordered, ...accounts.filter((account) => !listed.has(account.id))]

  function move(index: number, direction: -1 | 1) {
    if (!policy) return
    const ids = orderedAccounts.map((account) => account.id)
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    const [id] = ids.splice(index, 1)
    ids.splice(target, 0, id)
    save({ mode: policy.mode, priorityAccountIds: ids }).catch(() => undefined)
  }

  const modes: Array<{ id: RoutingMode; title: string; desc: string }> = [
    { id: 'most_available', title: vi ? 'Nhiều chỗ trống nhất' : 'Most available', desc: vi ? 'Mỗi tệp vào tài khoản còn trống nhiều nhất.' : 'Each file goes to the account with the most free space.' },
    { id: 'round_robin', title: vi ? 'Xoay vòng' : 'Round robin', desc: vi ? 'Lần lượt từng tài khoản theo thứ tự bên dưới.' : 'Takes turns, in the order below.' },
    { id: 'priority', title: vi ? 'Theo thứ tự ưu tiên' : 'Priority order', desc: vi ? 'Lấp đầy tài khoản đầu danh sách rồi mới sang tài khoản kế.' : 'Fills the first account, then the next.' },
  ]
  const usesOrder = policy?.mode === 'priority' || policy?.mode === 'round_robin'

  return (
    <div className="p-5 rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-[#f0f4f9]/30 dark:bg-[#282a2d]/30 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{vi ? 'Phân bổ tải lên' : 'Upload routing'}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {vi
            ? 'Cách HCDrive chọn tài khoản lưu trữ cho tệp mới. Tải vào một thư mục thì ưu tiên tài khoản của thư mục đó; tài khoản hết chỗ hoặc đang bị Google giới hạn request được bỏ qua, chuyển sang tài khoản kế.'
            : 'How HCDrive picks a storage account for new files. Uploads into a folder prefer that folder\'s account; accounts that are full or rate limited by Google are skipped.'}
        </p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {modes.map((option) => (
          <label
            key={option.id}
            className={cn(
              'p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between',
              policy?.mode === option.id
                ? 'bg-white dark:bg-[#1e1f20] border-blue-500 ring-2 ring-blue-500/20'
                : 'bg-white/60 dark:bg-white/5 border-slate-200/80 dark:border-slate-800 hover:border-slate-300',
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{option.title}</span>
              <input
                type="radio"
                name="uploadRoutingMode"
                disabled={!policy || saving}
                checked={policy?.mode === option.id}
                onChange={() => save({ mode: option.id, priorityAccountIds: orderedAccounts.map((account) => account.id) })}
                className="accent-[#0b57d0]"
              />
            </div>
            <span className="text-[11px] text-slate-400 block">{option.desc}</span>
          </label>
        ))}
      </div>

      {accounts.length > 0 ? (
        <div className={cn('space-y-1.5', !usesOrder && 'opacity-60')}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {vi ? 'Thứ tự ưu tiên' : 'Priority order'}
            {!usesOrder ? <span className="ml-2 font-normal normal-case tracking-normal">{vi ? '(dùng cho Xoay vòng và Theo thứ tự ưu tiên)' : '(used by Round robin and Priority order)'}</span> : null}
          </p>
          <ol className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#1e1f20]">
            {orderedAccounts.map((account, index) => (
              <li key={account.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="w-5 text-center font-semibold text-slate-400">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800 dark:text-slate-200">{account.displayName && account.provider === 's3' ? account.displayName : account.email}</p>
                  <p className="text-[11px] text-slate-400">
                    {account.provider === 's3' ? 'S3' : 'Google Drive'}
                    {account.storageAccount ? ` · ${vi ? 'còn trống' : 'free'} ${account.storageAccount.availableBytes ? formatBytes(account.storageAccount.availableBytes) : (vi ? 'không giới hạn' : 'unlimited')}` : ''}
                  </p>
                </div>
                <button type="button" disabled={saving || index === 0} onClick={() => move(index, -1)} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-[#282a2c] disabled:opacity-30 cursor-pointer" aria-label={vi ? 'Lên' : 'Up'} title={vi ? 'Lên' : 'Up'}>
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" disabled={saving || index === orderedAccounts.length - 1} onClick={() => move(index, 1)} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-[#282a2c] disabled:opacity-30 cursor-pointer" aria-label={vi ? 'Xuống' : 'Down'} title={vi ? 'Xuống' : 'Down'}>
                  <ArrowDown className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
