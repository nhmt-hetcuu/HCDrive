import { Download, FolderInput, Share2, Star, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SelectionBar({
  selectedCount,
  onClearSelection,
  onShare,
  onDownload,
  onMove,
  onDelete,
  onStar,
  canShare = true,
  isSingleItem = false,
  lang,
}: {
  selectedCount: number
  onClearSelection: () => void
  onShare?: () => void
  onDownload?: () => void
  onMove?: () => void
  onDelete?: () => void
  onStar?: () => void
  canShare?: boolean
  isSingleItem?: boolean
  lang: 'vi' | 'en'
}) {
  const vi = lang === 'vi'

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-full bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff] shadow-sm animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClearSelection}
          className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition"
          title={vi ? 'Bỏ chọn tất cả' : 'Clear selection'}
          aria-label="Clear selection"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="font-semibold text-xs sm:text-sm">
          {vi ? `${selectedCount} mục đã chọn` : `${selectedCount} item${selectedCount > 1 ? 's' : ''} selected`}
        </span>
      </div>

      <div className="flex items-center gap-1 sm:gap-1.5">
        {onShare && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!canShare}
            onClick={onShare}
            className="h-8 px-2.5 text-xs font-semibold rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            title={vi ? 'Chia sẻ' : 'Share'}
          >
            <Share2 className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">{vi ? 'Chia sẻ' : 'Share'}</span>
          </Button>
        )}

        {onDownload && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDownload}
            className="h-8 px-2.5 text-xs font-semibold rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            title={vi ? (isSingleItem ? 'Tải xuống' : 'Tải ZIP') : (isSingleItem ? 'Download' : 'Download ZIP')}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">{vi ? (isSingleItem ? 'Tải xuống' : 'Tải ZIP') : (isSingleItem ? 'Download' : 'Download ZIP')}</span>
          </Button>
        )}

        {onMove && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onMove}
            className="h-8 px-2.5 text-xs font-semibold rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            title={vi ? 'Di chuyển' : 'Move'}
          >
            <FolderInput className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">{vi ? 'Di chuyển' : 'Move'}</span>
          </Button>
        )}

        {onStar && isSingleItem && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onStar}
            className="h-8 px-2.5 text-xs font-semibold rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            title={vi ? 'Dấu sao' : 'Star'}
          >
            <Star className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">{vi ? 'Dấu sao' : 'Star'}</span>
          </Button>
        )}

        {onDelete && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="h-8 px-2.5 text-xs font-semibold rounded-full text-red-700 dark:text-red-300 hover:bg-red-500/20"
            title={vi ? 'Xoá' : 'Delete'}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">{vi ? 'Xoá' : 'Delete'}</span>
          </Button>
        )}
      </div>
    </div>
  )
}
