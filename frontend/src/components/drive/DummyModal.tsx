import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function DummyModal({
  open,
  title,
  description,
  children,
  onClose,
  className,
}: {
  open: boolean
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const ariaLabel = typeof title === 'string' ? title : 'Modal'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm cursor-default"
        aria-label="Close modal"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-[28px] sm:rounded-[28px] border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#1e1f20] text-slate-900 dark:text-slate-100 p-6 shadow-2xl animate-in zoom-in-95 duration-150 sm:max-w-md',
          className
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-normal tracking-tight text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close modal"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}
