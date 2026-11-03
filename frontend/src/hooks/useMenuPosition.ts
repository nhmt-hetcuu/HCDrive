import { useLayoutEffect, useRef, useState, useEffect } from 'react'

export type MenuPositionOptions = {
  x: number
  y: number
  onClose?: () => void
  padding?: number
}

export function useMenuPosition({ x, y, onClose, padding = 8 }: MenuPositionOptions) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
    zIndex: 50,
    top: 0,
    left: 0,
  })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const winW = window.innerWidth
    const winH = window.innerHeight

    // Mobile sheet style (viewport < 640px)
    if (winW < 640) {
      setStyle({
        position: 'fixed',
        visibility: 'visible',
        zIndex: 50,
        left: '0.75rem',
        right: '0.75rem',
        bottom: '0.75rem',
        maxHeight: 'calc(100vh - 24px)',
        overflowY: 'auto',
      })
      return
    }

    let posX = x
    let posY = y

    // Flip left if overflowing right edge
    if (posX + rect.width > winW - padding) {
      posX = x - rect.width
    }
    // Flip up if overflowing bottom edge
    if (posY + rect.height > winH - padding) {
      posY = y - rect.height
    }

    // Clamp inside viewport
    if (posX < padding) posX = padding
    if (posX + rect.width > winW - padding) {
      posX = Math.max(padding, winW - rect.width - padding)
    }

    if (posY < padding) posY = padding
    if (posY + rect.height > winH - padding) {
      posY = Math.max(padding, winH - rect.height - padding)
    }

    setStyle({
      position: 'fixed',
      visibility: 'visible',
      zIndex: 50,
      left: `${posX}px`,
      top: `${posY}px`,
      maxHeight: `calc(100vh - ${padding * 2}px)`,
      overflowY: 'auto',
    })
  }, [x, y, padding])

  useEffect(() => {
    if (!onClose) return

    function handleScroll() {
      onClose?.()
    }
    function handleResize() {
      onClose?.()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }

    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    window.addEventListener('resize', handleResize, { passive: true })
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true })
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return { menuRef, style }
}
