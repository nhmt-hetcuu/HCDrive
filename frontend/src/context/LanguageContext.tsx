import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Language = 'vi' | 'en'

type Translations = Record<string, string>

const vi: Translations = {
  // Navigation
  'menu.home': 'Trang chủ',
  'menu.all_files': 'Drive của tôi',
  'menu.accounts': 'Tài khoản lưu trữ',
  'menu.quota_tracker': 'Bộ nhớ',
  'menu.storage': 'Bộ nhớ',
  'menu.manage_storage': 'Quản lý bộ nhớ',
  'menu.shared': 'Được chia sẻ với tôi',
  'menu.shared_with_me': 'Được chia sẻ với tôi',
  'menu.recent': 'Gần đây',
  'menu.starred': 'Có gắn dấu sao',
  'menu.trash': 'Thùng rác',
  'menu.activity': 'Nhật ký',
  'menu.settings': 'Cài đặt',
  'menu.api_keys': 'Khoá API',
  'menu.users': 'Quản lý người dùng',
  'menu.logout': 'Đăng xuất',

  // Header & Search
  'search.placeholder': 'Tìm kiếm tài liệu...',
  'search.filters': 'Bộ lọc nâng cao',
  'search.clear': 'Xoá tất cả',
  'search.file_type': 'Loại tệp',
  'search.all_types': 'Tất cả loại',
  'search.image': 'Hình ảnh',
  'search.video': 'Video',
  'search.pdf': 'PDF',
  'search.doc': 'Tài liệu',
  'search.archive': 'Tệp nén',
  'search.date_range': 'Khoảng thời gian',
  'search.to': 'đến',
  'search.apply': 'Áp dụng',
  'search.cancel': 'Huỷ',

  // Actions
  'action.upload': 'Tải lên',
  'action.new_folder': 'Thư mục mới',
  'action.create': 'Tạo',
  'action.save': 'Lưu',
  'action.rename': 'Đổi tên',
  'action.move': 'Di chuyển',
  'action.delete': 'Xoá',
  'action.restore': 'Khôi phục',
  'action.delete_permanently': 'Xoá vĩnh viễn',
  'action.download': 'Tải về',
  'action.preview': 'Xem trước',
  'action.share': 'Chia sẻ',
  'action.copy_link': 'Sao chép link',
  'action.link_copied': 'Đã chép link',
  'action.sync': 'Đồng bộ',
  'action.disconnect': 'Ngắt kết nối',
  'action.close': 'Đóng',
  'action.confirm': 'Xác nhận',
  'action.set_proxy': 'Cài Proxy',
  'action.invite': 'Mời thành viên',
  'action.details': 'Chi tiết',
  'action.open_google_drive': 'Xem trên Google Drive',
  'action.open': 'Mở',
  'action.cut': 'Cắt / Di chuyển',

  // Table Headers
  'table.name': 'Tên tệp',
  'table.folder': 'Thư mục',
  'table.owner': 'Chủ sở hữu',
  'table.last_opened': 'Mở gần đây',
  'table.starred_on': 'Ngày gắn sao',
  'table.archived_date': 'Ngày lưu trữ',
  'table.last_modified': 'Sửa đổi lần cuối',
  'table.size': 'Kích thước',
  'table.access': 'Quyền truy cập',
  'table.select_all': 'Chọn tất cả',

  // Common UI
  'common.storage': 'Dung lượng',
  'common.used': 'Đã dùng',
  'common.free': 'Còn trống',
  'common.total': 'Tổng cộng',
  'common.name': 'Tên',
  'common.size': 'Kích thước',
  'common.modified': 'Sửa đổi',
  'common.loading': 'Đang tải...',
  'common.no_files': 'Không có tệp nào.',
  'common.unlimited': 'Không giới hạn',

  // Trash Page
  'trash.title': 'Thùng rác',
  'trash.subtitle': 'Các tệp và thư mục đã bị xoá tạm thời.',
  'trash.restore_selected': 'Khôi phục mục đã chọn',
  'trash.delete_selected': 'Xoá vĩnh viễn',
  'trash.empty': 'Thùng rác trống',
  'trash.items_count': 'mục trong thùng rác',

  // Shared Page
  'shared.title': 'Được chia sẻ',
  'shared.subtitle': 'Tệp và thư mục được chia sẻ với bạn hoặc bạn đã chia sẻ.',
  'shared.with_you': 'Được chia sẻ với bạn',
  'shared.by_you': 'Tài nguyên bạn đã chia sẻ',
  'shared.no_with_you': 'Chưa có tệp nào được chia sẻ với bạn.',
  'shared.no_by_you': 'Bạn chưa chia sẻ tệp nào.',
  'shared.revoke': 'Thu hồi',

  // Settings
  'settings.title': 'Cài đặt',
  'settings.subtitle': 'Quản lý tài khoản, kết nối Google/S3, proxy và hệ thống.',
  'settings.profile': 'Hồ sơ người dùng',
  'settings.language': 'Ngôn ngữ (Language)',
  'settings.connected_accounts': 'Tài khoản lưu trữ đã kết nối',
  'settings.connect_drive': 'Kết nối Google Drive',
  'settings.connect_s3': 'Kết nối S3',
  'settings.google_oauth': 'Cấu hình Google OAuth',
  'settings.google_link_verify': 'Xác minh Google Drive qua Link',
  'settings.google_link_verify_sub': 'Tạo link xác minh Google trực tiếp, không cần PowerShell hay Google Cloud',
  'settings.backup_restore': 'Sao lưu & Phục hồi cơ sở dữ liệu',
  'settings.download_backup': 'Tải bản sao lưu (Backup)',
  'settings.restore_backup': 'Phục hồi dữ liệu (Restore)',
  'settings.system_update': 'Cập nhật hệ thống',

  // Quota & Account Explorer
  'quota.explore_files': 'Xem tệp bên trong',
  'quota.upload_to_account': 'Tải tệp vào tài khoản này',
  'quota.account_files': 'Danh sách tệp trong tài khoản',
  'quota.auto_pooling': 'Tự động phân bổ / Gộp dung lượng (Mặc định)',
  'quota.no_account_files': 'Chưa có tệp nào được lưu trên tài khoản này.',

  // Upload status
  'upload.complete': 'Tải lên hoàn tất',
  'upload.partial': 'Tải lên hoàn tất có lỗi',
  'upload.failed': 'Tải lên thất bại',
  'upload.processing': 'Đang xử lý trên máy chủ...',
  'upload.uploading': 'Đang tải tệp lên...',
}

const en: Translations = {
  // Navigation
  'menu.home': 'Home',
  'menu.all_files': 'My Drive',
  'menu.accounts': 'Storage accounts',
  'menu.quota_tracker': 'Storage',
  'menu.storage': 'Storage',
  'menu.manage_storage': 'Manage storage',
  'menu.shared': 'Shared with me',
  'menu.shared_with_me': 'Shared with me',
  'menu.recent': 'Recent',
  'menu.starred': 'Starred',
  'menu.trash': 'Recycle Bin',
  'menu.activity': 'Activity Log',
  'menu.settings': 'Settings',
  'menu.api_keys': 'API Keys',
  'menu.users': 'User Management',
  'menu.logout': 'Sign out',

  // Header & Search
  'search.placeholder': 'Search Documents...',
  'search.filters': 'Advanced Search Filters',
  'search.clear': 'Clear All',
  'search.file_type': 'File Type',
  'search.all_types': 'All Types',
  'search.image': 'Image',
  'search.video': 'Video',
  'search.pdf': 'PDF',
  'search.doc': 'Document',
  'search.archive': 'Archive',
  'search.date_range': 'Date Range',
  'search.to': 'to',
  'search.apply': 'Apply Filters',
  'search.cancel': 'Cancel',

  // Actions
  'action.upload': 'Upload',
  'action.new_folder': 'New Folder',
  'action.create': 'Create',
  'action.save': 'Save',
  'action.rename': 'Rename',
  'action.move': 'Move',
  'action.delete': 'Delete',
  'action.restore': 'Restore',
  'action.delete_permanently': 'Delete Permanently',
  'action.download': 'Download',
  'action.preview': 'Preview',
  'action.share': 'Share',
  'action.copy_link': 'Copy Link',
  'action.link_copied': 'Link Copied',
  'action.sync': 'Sync',
  'action.disconnect': 'Disconnect',
  'action.close': 'Close',
  'action.confirm': 'Confirm',
  'action.set_proxy': 'Set Proxy',
  'action.invite': 'Invite Member',
  'action.details': 'Details',
  'action.open_google_drive': 'Open on Google Drive',
  'action.open': 'Open',
  'action.cut': 'Cut / Move',

  // Table Headers
  'table.name': 'Name',
  'table.folder': 'Folder',
  'table.owner': 'Owner',
  'table.last_opened': 'Last Opened',
  'table.starred_on': 'Starred On',
  'table.archived_date': 'Archived Date',
  'table.last_modified': 'Last Modified',
  'table.size': 'Size',
  'table.access': 'Access',
  'table.select_all': 'Select all files',

  // Common UI
  'common.storage': 'Storage',
  'common.used': 'Used',
  'common.free': 'Free',
  'common.total': 'Total',
  'common.name': 'Name',
  'common.size': 'Size',
  'common.modified': 'Last Modified',
  'common.loading': 'Loading...',
  'common.no_files': 'No files found.',
  'common.unlimited': 'Unlimited',

  // Trash Page
  'trash.title': 'Recycle Bin',
  'trash.subtitle': 'Temporarily deleted files and folders.',
  'trash.restore_selected': 'Restore selected',
  'trash.delete_selected': 'Delete permanently',
  'trash.empty': 'Recycle bin is empty',
  'trash.items_count': 'items in bin',

  // Shared Page
  'shared.title': 'Shared With You',
  'shared.subtitle': 'Files and folders shared with you or shared by you.',
  'shared.with_you': 'Shared with you',
  'shared.by_you': 'Resources you shared',
  'shared.no_with_you': 'No files shared with you yet.',
  'shared.no_by_you': 'No files shared yet.',
  'shared.revoke': 'Revoke',

  // Settings
  'settings.title': 'Settings',
  'settings.subtitle': 'Manage your accounts, Google/S3 connections, proxies and database.',
  'settings.profile': 'User Profile',
  'settings.language': 'Language',
  'settings.connected_accounts': 'Connected Storage Accounts',
  'settings.connect_drive': 'Connect Google Drive',
  'settings.connect_s3': 'Connect S3',
  'settings.google_oauth': 'Google OAuth Credentials',
  'settings.google_link_verify': 'Google Drive Link Verification',
  'settings.google_link_verify_sub': 'Direct 1-click Google OAuth verification without PowerShell or Google Cloud',
  'settings.backup_restore': 'Backup & Restore Database',
  'settings.download_backup': 'Download Backup',
  'settings.restore_backup': 'Restore Backup',
  'settings.system_update': 'System Update',

  // Quota & Account Explorer
  'quota.explore_files': 'Explore Files',
  'quota.upload_to_account': 'Upload to this Drive',
  'quota.account_files': 'Files in this account',
  'quota.auto_pooling': 'Automatic Pooling (Default)',
  'quota.no_account_files': 'No files stored in this account yet.',

  // Upload status
  'upload.complete': 'Upload complete',
  'upload.partial': 'Upload completed with errors',
  'upload.failed': 'Upload failed',
  'upload.processing': 'Processing on server...',
  'upload.uploading': 'Uploading files...',
}

const dictionaries: Record<Language, Translations> = { vi, en }

type LanguageContextType = {
  lang: Language
  setLang: (lang: Language) => void
  toggleLang: () => void
  t: (key: string, fallback?: string) => string
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

const STORAGE_KEY = 'hcdrive:language'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('9drive:language')
    if (saved === 'vi' || saved === 'en') return saved
    return 'vi'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  function setLang(newLang: Language) {
    setLangState(newLang)
  }

  function toggleLang() {
    setLangState((curr) => (curr === 'vi' ? 'en' : 'vi'))
  }

  function t(key: string, fallback?: string): string {
    return dictionaries[lang]?.[key] ?? dictionaries['en']?.[key] ?? fallback ?? key
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
