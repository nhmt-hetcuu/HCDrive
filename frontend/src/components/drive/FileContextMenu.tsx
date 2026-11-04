import type { ElementType } from 'react'
import {
  Download,
  Edit3,
  Eye,
  FolderInput,
  Info,
  Link2,
  Star,
  Trash2,
  UserPlus,
  ExternalLink,
  Copy,
  Files,
  FileDown,
  CornerUpRight,
  History,
  MessageSquare,
  Lock,
} from 'lucide-react'
import { isGoogleDoc, isGoogleFile, startDriveAction, type DriveAction } from '@/lib/drive-actions'
import type { FileItem } from '@/data/drive-data'
import { useLanguage } from '@/context/LanguageContext'
import { useMenuPosition } from '@/hooks/useMenuPosition'
import { cn } from '@/lib/utils'

type Props = {
  x: number
  y: number
  file: FileItem | null
  onClose: () => void
  onView: () => void
  onDownload: () => void
  // Actions a page cannot do (e.g. renaming a file someone shared with you) are left out of the menu.
  onRename?: () => void
  onMove?: () => void
  onDetails: () => void
  onShare: () => void
  onCopyLink: () => void
  onInvite?: () => void
  onDelete?: () => void
  /** Label for the last, red item; defaults to "Move to trash". */
  deleteLabel?: string
  onStar?: () => void
  onCopyToDrive?: () => void
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
  kbd,
}: {
  icon: ElementType
  label: string
  onClick: () => void
  danger?: boolean
  kbd?: string
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
    </button>
  )
}

export function FileContextMenu({
  x,
  y,
  file,
  onClose,
  onView,
  onDownload,
  onRename,
  onMove,
  onDetails,
  onShare,
  onCopyLink,
  onInvite,
  onDelete,
  deleteLabel,
  onStar,
  onCopyToDrive,
}: Props) {
  const { t, lang } = useLanguage()
  const vi = lang === 'vi'
  const { menuRef, style } = useMenuPosition({ x, y, onClose })

  if (!file) return null
  const googleFile = isGoogleFile(file)
  // Google Drive features (handled by DriveFeatureHost) close the menu and open their own dialog.
  const drive = (action: DriveAction) => () => {
    onClose()
    startDriveAction({ action, file })
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        aria-label="Close file menu"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        style={style}
        className="w-64 sm:w-72 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-[#1e1f20]/95 shadow-xl backdrop-blur-xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none"
      >
        {/* Nhóm 1: Xem trước, Mở trên Google Drive */}
        <MenuItem icon={Eye} label={t('action.preview', 'Xem trước')} onClick={onView} kbd="↵" />
        {file.providerFileId && (
          <MenuItem
            icon={ExternalLink}
            label={t('action.open_google_drive', 'Mở trên Google Drive')}
            onClick={() => window.open(`https://drive.google.com/file/d/${file.providerFileId}/view`, '_blank')}
          />
        )}

        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

        {/* Nhóm 2: Tải xuống, Đổi tên */}
        <MenuItem icon={Download} label={t('action.download', 'Tải xuống')} onClick={onDownload} />
        {googleFile && isGoogleDoc(file) && <MenuItem icon={FileDown} label={vi ? 'Tải xuống dưới dạng…' : 'Download as…'} onClick={drive('export')} />}
        {onRename && <MenuItem icon={Edit3} label={t('action.rename', 'Đổi tên')} onClick={onRename} kbd="F2" />}
        {googleFile && <MenuItem icon={Files} label={vi ? 'Tạo bản sao' : 'Make a copy'} onClick={drive('copy')} />}
        {onCopyToDrive && (
          <MenuItem
            icon={Copy}
            label={vi ? 'Sao chép sang Drive khác…' : 'Copy to another Drive…'}
            onClick={onCopyToDrive}
          />
        )}

        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

        {/* Nhóm 3: Chia sẻ, Liên kết */}
        {onInvite && <MenuItem icon={UserPlus} label={t('action.invite', 'Chia sẻ...')} onClick={onInvite} />}
        <MenuItem icon={Link2} label={t('action.share', 'Nhận đường liên kết')} onClick={onShare} />
        <MenuItem icon={Copy} label={t('action.copy_link', 'Sao chép link')} onClick={onCopyLink} />

        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

        {/* Nhóm 4: Di chuyển, Gắn dấu sao, Chi tiết */}
        {onMove && <MenuItem icon={FolderInput} label={t('action.move', 'Di chuyển')} onClick={onMove} />}
        {googleFile && <MenuItem icon={CornerUpRight} label={vi ? 'Thêm lối tắt vào Drive' : 'Add shortcut to Drive'} onClick={drive('shortcut')} />}
        {onStar && (
          <MenuItem
            icon={Star}
            label={
              file.starred
                ? vi ? 'Xoá khỏi mục có gắn dấu sao' : 'Remove from Starred'
                : vi ? 'Thêm vào mục có gắn dấu sao' : 'Add to Starred'
            }
            onClick={onStar}
          />
        )}
        <MenuItem icon={Info} label={t('action.details', 'Thông tin về tệp')} onClick={onDetails} />
        {googleFile && (
          <>
            <MenuItem icon={MessageSquare} label={vi ? 'Bình luận' : 'Comments'} onClick={drive('comments')} />
            <MenuItem icon={History} label={vi ? 'Quản lý phiên bản' : 'Manage versions'} onClick={drive('versions')} />
            <MenuItem icon={Lock} label={vi ? 'Khoá / mở khoá tệp' : 'Lock / unlock'} onClick={drive('lock')} />
          </>
        )}

        {onDelete && (
          <>
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

            {/* Nhóm 5: Chuyển vào thùng rác */}
            <MenuItem
              icon={Trash2}
              label={deleteLabel ?? (vi ? 'Chuyển vào thùng rác' : 'Move to trash')}
              onClick={onDelete}
              danger
              kbd={deleteLabel ? undefined : 'Del'}
            />
          </>
        )}
      </div>
    </>
  )
}
