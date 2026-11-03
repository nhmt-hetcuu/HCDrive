import { createContext, useContext, useState, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type SnackbarAction = {
  label: string
  onClick: () => void
}

export type SnackbarOptions = {
  message: string
  action?: SnackbarAction
  duration?: number
}

type SnackbarContextType = {
  showSnackbar: (message: string, options?: { action?: SnackbarAction; duration?: number }) => void
  hideSnackbar: () => void
}

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined)

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{
    id: number
    message: string
    action?: SnackbarAction
  } | null>(null)

  const timerRef = useRef<number | null>(null)
  const counterRef = useRef(0)

  function hideSnackbar() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setActive(null)
  }

  function showSnackbar(
    message: string,
    options?: { action?: SnackbarAction; duration?: number }
  ) {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    const id = ++counterRef.current
    setActive({
      id,
      message,
      action: options?.action,
    })

    const duration = options?.duration ?? 4000
    timerRef.current = window.setTimeout(() => {
      setActive((current) => (current?.id === id ? null : current))
    }, duration)
  }

  return (
    <SnackbarContext.Provider value={{ showSnackbar, hideSnackbar }}>
      {children}
      {active && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-6 z-50 flex items-center gap-3.5 rounded-full bg-[#303030] dark:bg-[#e3e3e3] px-4 py-3 text-xs text-[#e3e3e3] dark:text-[#1f1f1f] shadow-2xl animate-in slide-in-from-bottom-3 duration-200 max-w-[calc(100vw-3rem)]"
        >
          <span className="font-normal truncate max-w-sm">{active.message}</span>

          {active.action && (
            <button
              type="button"
              onClick={() => {
                active.action?.onClick()
                hideSnackbar()
              }}
              className="font-bold text-[#a8c7fa] dark:text-[#0b57d0] hover:underline px-1 whitespace-nowrap cursor-pointer transition"
            >
              {active.action.label}
            </button>
          )}

          <button
            type="button"
            onClick={hideSnackbar}
            className="p-0.5 rounded-full hover:bg-white/10 dark:hover:bg-black/10 text-white/70 dark:text-black/70 hover:text-white dark:hover:text-black cursor-pointer transition ml-1"
            aria-label="Close notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </SnackbarContext.Provider>
  )
}

export function useSnackbar() {
  const context = useContext(SnackbarContext)
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider')
  }
  return context
}
