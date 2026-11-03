import { Keyboard, Lightbulb, Shield, CheckCircle2 } from 'lucide-react'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'

// `shortcutsOnly`: the "Keyboard shortcuts" item of the settings menu (and Ctrl + /) shows just the keys.
export function HelpModal({ open, onClose, lang, shortcutsOnly = false }: { open: boolean; onClose: () => void; lang: 'vi' | 'en'; shortcutsOnly?: boolean }) {
  const vi = lang === 'vi'
  const kbd = 'px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-semibold'
  const cell = 'flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800'

  return (
    <DummyModal
      open={open}
      onClose={onClose}
      title={shortcutsOnly ? (vi ? 'Phím tắt' : 'Keyboard shortcuts') : vi ? 'Trợ giúp & Phím tắt HCDrive' : 'HCDrive Help & Shortcuts'}
      description={shortcutsOnly ? (vi ? 'Mở bảng này bất cứ lúc nào bằng Ctrl + /.' : 'Open this list any time with Ctrl + /.') : vi ? 'Hướng dẫn thao tác nhanh và mẹo sử dụng không gian lưu trữ gộp.' : 'Quick guide and shortcuts for unified storage.'}
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 text-sm text-slate-700 dark:text-slate-300">
        <div>
          <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100 mb-2">
            <Keyboard className="h-4 w-4 text-[#0b57d0] dark:text-[#a8c7fa]" />
            <span>{vi ? 'Phím tắt bàn phím' : 'Keyboard shortcuts'}</span>
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span>{vi ? 'Mở / Xem trước' : 'Open / Preview'}</span>
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-semibold">Enter</kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span>{vi ? 'Bỏ chọn / Đóng' : 'Deselect / Close'}</span>
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-semibold">Esc</kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span>{vi ? 'Đổi tên' : 'Rename'}</span>
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-semibold">F2</kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span>{vi ? 'Chuyển vào thùng rác' : 'Move to Trash'}</span>
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-semibold">Del</kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span>{vi ? 'Chọn tất cả' : 'Select all'}</span>
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-semibold">Ctrl + A</kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span>{vi ? 'Chọn dải tệp' : 'Range select'}</span>
              <kbd className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-semibold">Shift + Click</kbd>
            </div>
            <div className={cell}>
              <span>{vi ? 'Cắt / dán thư mục' : 'Cut / paste folder'}</span>
              <kbd className={kbd}>Ctrl + X / V</kbd>
            </div>
            <div className={cell}>
              <span>{vi ? 'Xem phím tắt' : 'Show shortcuts'}</span>
              <kbd className={kbd}>Ctrl + /</kbd>
            </div>
          </div>
        </div>

        {shortcutsOnly ? null : (<>
        <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
          <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100 mb-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <span>{vi ? 'Mẹo sử dụng không gian lưu trữ' : 'Storage usage tips'}</span>
          </h4>
          <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{vi ? 'Gộp nhiều tài khoản Google Drive thành một Drive thống nhất với cấu trúc thư mục tự động hòa trộn.' : 'Pool multiple Google Drive accounts into a unified drive with automatic folder merging.'}</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{vi ? 'Tệp được truyền thẳng trực tiếp đến Google Drive / S3, không lưu tạm dữ liệu trên ổ cứng HCDrive.' : 'Files stream directly to Google Drive / S3 without permanent storage on the HCDrive server.'}</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{vi ? 'Bấm nút "Đồng bộ" bất kỳ lúc nào để cập nhật tệp/thư mục vừa sửa trực tiếp trên Google Drive.' : 'Click "Sync" anytime to fetch files or folders modified directly on Google Drive.'}</span>
            </li>
          </ul>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
          <h4 className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100 mb-2">
            <Shield className="h-4 w-4 text-emerald-500" />
            <span>{vi ? 'Bảo mật & Quyền riêng tư' : 'Security & Privacy'}</span>
          </h4>
          <p className="text-xs text-slate-500 leading-relaxed">
            {vi ? 'Mọi token truy cập Google Drive được mã hoá AES-256-GCM trong cơ sở dữ liệu. Chia sẻ tệp có thể điều khiển trực tiếp quyền Google Drive hoặc link chia sẻ nội bộ HCDrive.' : 'All Google Drive tokens are encrypted using AES-256-GCM. Sharing allows direct Google Drive permission management or HCDrive public links.'}
          </p>
        </div>
        </>)}
      </div>

      <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800 mt-2">
        <Button variant="default" size="sm" onClick={onClose}>
          {vi ? 'Đã hiểu' : 'Got it'}
        </Button>
      </div>
    </DummyModal>
  )
}
