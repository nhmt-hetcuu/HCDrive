import { useState, type ElementType } from 'react'
import {
  Copy,
  Download,
  Edit3,
  FolderOpen,
  Palette,
  Scissors,
  Share2,
  Trash2,
  UserPlus,
  ChevronRight,
  Check,
} from 'lucide-react'
import type { FolderItem } from '@/data/drive-data'
import { useLanguage } from '@/context/LanguageContext'
import { useMenuPosition } from '@/hooks/useMenuPosition'
import { folderColorOptions, normalizeFolderColor } from '@/components/drive/FolderVisual'
import { cn } from '@/lib/utils'

type Props = {
  x: number
  y: number
  folder: FolderItem | null
  onClose: () => void
  onOpen?: () => void
  onDownload?: () => void
  // Left out of the menu when a page cannot do them (e.g. Home lists folders but does not manage them).
  onCut?: () => void
  onRename?: () => void
  onInvite: () => void
  onShare?: () => void
  onCopyLink: () => void
  onDelete?: () => void
  onChangeColor?: (color: string) => void
  onCopyToDrive?: () => void
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
  kbd,
  hasSubmenu = false,
}: {
  icon: ElementType
  label: string
  onClick: () => void
  danger?: boolean
  kbd?: string
  hasSubmenu?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-8 w-full items-center gap-3 rounded-md px-3 text-[13px] font-medium transition-colors text-left cursor-pointer',
        danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#282a2c]'
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          danger
            ? 'text-red-500'
            : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200'
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      {kbd && (
        <kbd className="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 font-mono">
          {kbd}
        </kbd>
      )}
      {hasSubmenu && <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
    </button>
  )
}

export function FolderContextMenu({
  x,
  y,
  folder,
  onClose,
  onOpen,
  onDownload,
  onCut,
  onRename,
  onInvite,
  onShare,
  onCopyLink,
  onDelete,
  onChangeColor,
  onCopyToDrive,
}: Props) {
  const { t, lang } = useLanguage()
  const vi = lang === 'vi'
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const { menuRef, style } = useMenuPosition({ x, y, onClose })

  if (!folder) return null
  const currentColor = normalizeFolderColor(folder.color)

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        aria-label="Close folder menu"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        style={style}
        className="w-64 sm:w-72 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-[#1e1f20]/95 shadow-xl backdrop-blur-xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none"
      >
        {/* Nhóm 1: Mở thư mục, Tải xuống, Di chuyển / Cắt */}
        {onOpen && (
          <MenuItem
            icon={FolderOpen}
            label={vi ? 'Mở thư mục' : 'Open folder'}
            onClick={onOpen}
          />
        )}
        {onDownload && (
          <MenuItem
            icon={Download}
            label={t('action.download', 'Tải xuống')}
            onClick={onDownload}
          />
        )}
        {onCut && (
          <MenuItem
            icon={Scissors}
            label={t('action.cut', 'Di chuyển / Cắt')}
            onClick={onCut}
            kbd="⌘X"
          />
        )}
        {onCopyToDrive && (
          <MenuItem
            icon={Copy}
            label={vi ? 'Sao chép sang Drive khác…' : 'Copy to another Drive…'}
            onClick={onCopyToDrive}
          />
        )}

        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

        {/* Nhóm 2: Chia sẻ, Sao chép link */}
        <MenuItem
          icon={UserPlus}
          label={t('action.invite', 'Chia sẻ...')}
          onClick={onInvite}
        />
        {onShare && (
          <MenuItem
            icon={Share2}
            label={t('action.share', 'Nhận đường liên kết')}
            onClick={onShare}
          />
        )}
        <MenuItem
          icon={Copy}
          label={t('action.copy_link', 'Sao chép liên kết')}
          onClick={onCopyLink}
        />

        {onRename || onChangeColor ? <div className="my-1 border-t border-slate-100 dark:border-slate-800" /> : null}

        {/* Nhóm 3: Đổi tên, Đổi màu */}
        {onRename && (
          <MenuItem
            icon={Edit3}
            label={t('action.rename', 'Đổi tên')}
            onClick={onRename}
            kbd="F2"
          />
        )}

        {/* Color picker item / flyout */}
        {onChangeColor && <div className="relative">
          <MenuItem
            icon={Palette}
            label={vi ? 'Thay đổi màu sắc' : 'Change color'}
            onClick={() => setColorPickerOpen(!colorPickerOpen)}
            hasSubmenu
          />

          {colorPickerOpen && (
            <div className="mt-1 p-2 rounded-xl bg-slate-50 dark:bg-[#282a2c] border border-slate-200/80 dark:border-slate-700 shadow-inner grid grid-cols-4 gap-2">
              {folderColorOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChangeColor(c)
                    setColorPickerOpen(false)
                  }}
                  className="h-6 w-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 cursor-pointer shadow-xs"
                  style={{ backgroundColor: c }}
                  title={c}
                >
                  {currentColor.toLowerCase() === c.toLowerCase() && (
                    <Check className="h-3.5 w-3.5 text-white drop-shadow" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>}

        {onDelete && (
          <>
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

            {/* Nhóm 4: Xoá */}
            <MenuItem
              icon={Trash2}
              label={vi ? 'Chuyển vào thùng rác' : 'Move to trash'}
              onClick={onDelete}
              danger
              kbd="Del"
            />
          </>
        )}
      </div>
    </>
  )
}
