import { useState, useCallback, useEffect, useRef } from 'react'

export type IdentifiableItem = {
  id?: string | null
  [key: string]: any
}

export type UseFileBrowserOptions<T extends IdentifiableItem> = {
  items: T[]
  onOpenItem?: (item: T) => void
  onDeleteSelected?: (ids: string[]) => void
  onRenameItem?: (item: T) => void
  onPreviewItem?: (item: T) => void
  onCopyLink?: (item: T) => void
}

export function useFileBrowser<T extends IdentifiableItem>({
  items,
  onOpenItem,
  onDeleteSelected,
  onRenameItem,
  onPreviewItem,
  onCopyLink,
}: UseFileBrowserOptions<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeItem, setActiveItem] = useState<T | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: T | null }>({
    x: 0,
    y: 0,
    item: null,
  })
  const lastSelectedIndexRef = useRef<number | null>(null)

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setActiveItem(null)
    lastSelectedIndexRef.current = null
  }, [])

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    const validIds = items.map((i) => i.id).filter(Boolean) as string[]
    if (validIds.length === 0) return

    setSelectedIds((prev) => {
      const allSelected = validIds.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(validIds)
    })
  }, [items])

  const selectSingle = useCallback((item: T, index?: number) => {
    if (!item.id) return
    setSelectedIds(new Set([item.id]))
    setActiveItem(item)
    if (index !== undefined) {
      lastSelectedIndexRef.current = index
    }
  }, [])

  const handleItemClick = useCallback(
    (e: React.MouseEvent, item: T, index?: number) => {
      if (!item.id) return

      if (e.shiftKey && lastSelectedIndexRef.current !== null && index !== undefined) {
        // Range selection
        const start = Math.min(lastSelectedIndexRef.current, index)
        const end = Math.max(lastSelectedIndexRef.current, index)
        const rangeIds = items
          .slice(start, end + 1)
          .map((i) => i.id)
          .filter(Boolean) as string[]

        setSelectedIds((prev) => {
          const next = new Set(prev)
          for (const id of rangeIds) next.add(id)
          return next
        })
        setActiveItem(item)
        return
      }

      if (e.metaKey || e.ctrlKey) {
        // Multi-select toggle
        toggleSelection(item.id)
        setActiveItem(item)
        if (index !== undefined) lastSelectedIndexRef.current = index
        return
      }

      // Normal click
      selectSingle(item, index)
    },
    [items, toggleSelection, selectSingle]
  )

  const handleItemDoubleClick = useCallback(
    (e: React.MouseEvent, item: T) => {
      e.preventDefault()
      e.stopPropagation()
      onOpenItem?.(item)
    },
    [onOpenItem]
  )

  const openContextMenu = useCallback((e: React.MouseEvent, item: T) => {
    e.preventDefault()
    e.stopPropagation()
    if (item.id && !selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]))
    }
    setActiveItem(item)
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }, [selectedIds])

  const closeContextMenu = useCallback(() => {
    setContextMenu({ x: 0, y: 0, item: null })
  }, [])

  // Keyboard shortcut listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore if focus is in an input or textarea or contenteditable element
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'Escape') {
        clearSelection()
        closeContextMenu()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const validIds = items.map((i) => i.id).filter(Boolean) as string[]
        setSelectedIds(new Set(validIds))
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0 && onDeleteSelected) {
          e.preventDefault()
          onDeleteSelected(Array.from(selectedIds))
        }
        return
      }

      const singleId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null
      const singleItem = singleId ? items.find((i) => i.id === singleId) ?? activeItem : null

      if (!singleItem) return

      if (e.key === 'F2' && onRenameItem) {
        e.preventDefault()
        onRenameItem(singleItem)
      } else if (e.key === ' ' && onPreviewItem) {
        e.preventDefault()
        onPreviewItem(singleItem)
      } else if (e.key === 'Enter' && onOpenItem) {
        e.preventDefault()
        onOpenItem(singleItem)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && onCopyLink) {
        e.preventDefault()
        onCopyLink(singleItem)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    items,
    selectedIds,
    activeItem,
    clearSelection,
    closeContextMenu,
    onDeleteSelected,
    onRenameItem,
    onPreviewItem,
    onOpenItem,
    onCopyLink,
  ])

  return {
    selectedIds,
    setSelectedIds,
    activeItem,
    setActiveItem,
    contextMenu,
    setContextMenu,
    openContextMenu,
    closeContextMenu,
    clearSelection,
    toggleSelection,
    toggleAll,
    selectSingle,
    handleItemClick,
    handleItemDoubleClick,
  }
}
