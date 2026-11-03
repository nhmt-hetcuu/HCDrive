import { useState, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  delay?: number
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  className,
  delay = 500,
}: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  function show() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setVisible(true)
    }, delay)
  }

  function hide() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }

  const sideClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  return (
    <div
      className="relative inline-flex items-center justify-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && content ? (
        <div
          role="tooltip"
          className={cn(
            'absolute pointer-events-none z-[100] px-2 py-1 text-[12px] font-normal leading-tight text-white bg-[#3c4043] rounded shadow-md whitespace-nowrap animate-in fade-in zoom-in-95 duration-100',
            sideClasses[side],
            className,
          )}
        >
          {content}
        </div>
      ) : null}
    </div>
  )
}
