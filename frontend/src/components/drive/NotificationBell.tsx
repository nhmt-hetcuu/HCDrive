import { useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  X,
  Layers,
} from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useMenuPosition } from '@/hooks/useMenuPosition'
import { cn } from '@/lib/utils'

export type NotificationItem = {
  id: string
  type: 'account_error' | 'storage_full' | 'upload_error'
  title: string
  description?: string | null
  severity: 'error' | 'warning' | 'info'
  account?: any
  actionLabel?: string
  onAction?: () => void
}

export function NotificationBell({
  accounts = [],
  onRefresh,
  lang = 'vi',
}: {
  accounts: any[]
  onRefresh?: () => void
  lang?: string
}) {
  const navigate = useNavigate()
  const vi = lang === 'vi'
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)

  // Compute all active error and warning notifications
  const notifications = useMemo(() => {
    const list: NotificationItem[] = []

    for (const acc of accounts) {
      if (acc.status === 'error' || acc.lastError) {
        list.push({
          id: `acc-err-${acc.id}`,
          type: 'account_error',
          severity: 'warning',
          title: vi
            ? `Lỗi tài khoản: ${acc.email}`
            : `Account error: ${acc.email}`,
          description: acc.lastError || (vi ? 'Không thể kết nối hoặc đồng bộ với tài khoản lưu trữ này.' : 'Failed to sync with this storage account.'),
          account: acc,
          actionLabel: vi ? 'Xem tài khoản' : 'View Account',
          onAction: () => {
            setOpen(false)
            navigate('/accounts')
          },
        })
      }

      // Storage full warning
      if (acc.storageAccount?.availableBytes === '0') {
        list.push({
          id: `storage-full-${acc.id}`,
          type: 'storage_full',
          severity: 'warning',
          title: vi ? `Dung lượng đầy: ${acc.email}` : `Storage full: ${acc.email}`,
          description: vi ? 'Tài khoản này đã hết dung lượng lưu trữ khả dụng.' : 'This storage account has run out of space.',
          account: acc,
          actionLabel: vi ? 'Quản lý' : 'Manage',
          onAction: () => {
            setOpen(false)
            navigate('/storage')
          },
        })
      }
    }

    return list
  }, [accounts, vi, navigate])

  const activeNotifications = notifications.filter((n) => !dismissedIds.has(n.id))
  const errorCount = activeNotifications.filter((n) => n.severity === 'error').length
  const totalCount = activeNotifications.length

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setAnchor({ x: rect.right, y: rect.bottom + 8 })
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  function handleDismiss(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setDismissedIds((prev) => new Set([...prev, id]))
  }

  async function handleRefreshClick() {
    setRefreshing(true)
    try {
      await onRefresh?.()
    } finally {
      setTimeout(() => setRefreshing(false), 500)
    }
  }

  return (
    <>
      <Tooltip
        content={
          totalCount > 0
            ? vi
              ? `Có ${totalCount} thông báo (${errorCount} lỗi)`
              : `${totalCount} alerts (${errorCount} errors)`
            : vi
            ? 'Thông báo hệ thống (Không có lỗi)'
            : 'Notifications (No errors)'
        }
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleOpen}
          className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-full transition-colors cursor-pointer',
            totalCount > 0
              ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-[#282a2c]'
          )}
          aria-label={vi ? 'Thông báo lỗi' : 'Error notifications'}
        >
          <Bell className="h-5 w-5" />
          {totalCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-[#1e1f20] animate-pulse">
              {totalCount > 9 ? '9+' : totalCount}
            </span>
          )}
        </button>
      </Tooltip>

      {open && anchor && (
        <NotificationPopover
          anchor={anchor}
          notifications={activeNotifications}
          onClose={() => setOpen(false)}
          onDismiss={handleDismiss}
          onDismissAll={() => {
            const allIds = new Set(dismissedIds)
            activeNotifications.forEach((n) => allIds.add(n.id))
            setDismissedIds(allIds)
          }}
          onRefresh={handleRefreshClick}
          refreshing={refreshing}
          vi={vi}
        />
      )}
    </>
  )
}

function NotificationPopover({
  anchor,
  notifications,
  onClose,
  onDismiss,
  onDismissAll,
  onRefresh,
  refreshing,
  vi,
}: {
  anchor: { x: number; y: number }
  notifications: NotificationItem[]
  onClose: () => void
  onDismiss: (id: string, e: React.MouseEvent) => void
  onDismissAll: () => void
  onRefresh: () => void
  refreshing: boolean
  vi: boolean
}) {
  const { menuRef, style } = useMenuPosition({ x: anchor.x, y: anchor.y, onClose, padding: 12 })
  const navigate = useNavigate()

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998] cursor-default bg-transparent"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={menuRef}
        style={{ ...style, zIndex: 9999 }}
        className="w-[min(380px,calc(100vw-24px))] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1f20] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-xs sm:text-sm">
                {vi ? 'Thông báo lỗi & Trạng thái' : 'Alerts & System Status'}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
              title={vi ? 'Kiểm tra lại' : 'Refresh'}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body Notification List */}
        <div className="overflow-y-auto p-3 space-y-2.5 flex-1 min-h-0">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-2.5">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-200">
                {vi ? 'Hệ thống hoạt động bình thường' : 'All systems normal'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-[240px]">
                {vi
                  ? 'Tất cả tài khoản và Cookie Google Drive đang hoạt động ổn định và được duy trì tự động.'
                  : 'All storage accounts and Google Drive cookies are healthy and active.'}
              </p>
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'rounded-xl border p-3 transition shadow-xs flex flex-col gap-2',
                  item.severity === 'error'
                    ? 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30'
                    : 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {item.severity === 'error' ? (
                      <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <h4
                        className={cn(
                          'font-semibold text-xs truncate',
                          item.severity === 'error'
                            ? 'text-red-900 dark:text-red-200'
                            : 'text-amber-900 dark:text-amber-200'
                        )}
                        title={item.title}
                      >
                        {item.title}
                      </h4>
                      {item.description && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => onDismiss(item.id, e)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded cursor-pointer shrink-0"
                    title={vi ? 'Ẩn thông báo' : 'Dismiss'}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {item.actionLabel && item.onAction && (
                  <div className="flex justify-end pt-1">
                    <Button
                      size="sm"
                      variant="filled"
                      onClick={item.onAction}
                      className={cn(
                        'h-7 px-2.5 text-[11px] font-medium rounded-lg flex items-center gap-1 shadow-xs cursor-pointer',
                        item.severity === 'error'
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-amber-600 hover:bg-amber-700 text-white'
                      )}
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{item.actionLabel}</span>
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 px-3.5 py-2.5 bg-slate-50/70 dark:bg-[#18191a] shrink-0 text-xs">
          <button
            type="button"
            onClick={() => {
              onClose()
              navigate('/accounts')
            }}
            className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-[#0b57d0] dark:hover:text-[#a8c7fa] font-medium transition cursor-pointer"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{vi ? 'Quản lý tài khoản' : 'Manage accounts'}</span>
          </button>
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={onDismissAll}
              className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer"
            >
              {vi ? 'Xóa tất cả' : 'Clear all'}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
