import type { ElementType } from 'react'
import { ClipboardPaste, FolderPlus, FolderUp, Upload } from 'lucide-react'
import { useLanguage } from '@/context/LanguageContext'
import { useMenuPosition } from '@/hooks/useMenuPosition'
import { cn } from '@/lib/utils'

type Props = {
  x: number
  y: number
  open: boolean
  canPasteFolder?: boolean
  onClose: () => void
  onUpload: () => void
  onUploadFolder?: () => void
  onCreateFolder: () => void
  onPasteFolder?: () => void
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  iconColor,
}: {
  icon: ElementType
  label: string
  onClick: () => void
  iconColor?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-8 w-full items-center gap-3 rounded-md px-3 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#282a2c] transition-colors text-left cursor-pointer"
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          iconColor || 'text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200'
        )}
      />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

export function EmptyAreaContextMenu({
  x,
  y,
  open,
  canPasteFolder = false,
  onClose,
  onUpload,
  onUploadFolder,
  onCreateFolder,
  onPasteFolder,
}: Props) {
  const { lang } = useLanguage()
  const vi = lang === 'vi'
  const { menuRef, style } = useMenuPosition({ x, y, onClose })

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        aria-label="Close empty area menu"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        style={style}
        className="w-64 sm:w-72 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-[#1e1f20]/95 shadow-xl backdrop-blur-xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none"
      >
        <MenuItem
          icon={FolderPlus}
          label={vi ? 'Thư mục mới' : 'New folder'}
          onClick={() => {
            onClose()
            onCreateFolder()
          }}
          iconColor="text-blue-600 dark:text-blue-400"
        />

        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

        <MenuItem
          icon={Upload}
          label={vi ? 'Tải tệp lên' : 'File upload'}
          onClick={() => {
            onClose()
            onUpload()
          }}
        />

        {onUploadFolder && (
          <MenuItem
            icon={FolderUp}
            label={vi ? 'Tải thư mục lên' : 'Folder upload'}
            onClick={() => {
              onClose()
              onUploadFolder()
            }}
          />
        )}

        {canPasteFolder && onPasteFolder && (
          <>
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <MenuItem
              icon={ClipboardPaste}
              label={vi ? 'Dán thư mục vào đây' : 'Paste folder here'}
              onClick={() => {
                onClose()
                onPasteFolder()
              }}
              iconColor="text-emerald-600 dark:text-emerald-400"
            />
          </>
        )}
      </div>
    </>
  )
}
