import { Link, useNavigate } from 'react-router-dom'
import { FileQuestion, ArrowLeft, Home } from 'lucide-react'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/LanguageContext'

export function NotFoundPage() {
  const navigate = useNavigate()
  const { lang, setLang } = useLanguage()
  const vi = lang === 'vi'

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-[#f8fafd] dark:bg-[#1f1f1f] text-slate-800 dark:text-slate-200 p-4 sm:p-8 select-none">
      {/* Header */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between">
        <Link to="/home" className="flex items-center gap-2">
          <BrandLogo size="md" />
        </Link>
        <div className="flex items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as 'vi' | 'en')}
            aria-label={vi ? 'Chọn ngôn ngữ' : 'Select language'}
            className="bg-transparent border border-slate-300 dark:border-slate-700 rounded-full px-3 py-1 text-slate-600 dark:text-slate-400 text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#0b57d0]"
          >
            <option value="vi">Tiếng Việt</option>
            <option value="en">English (US)</option>
          </select>
        </div>
      </header>

      {/* Main Content: Google Error Style */}
      <main className="flex-1 flex items-center justify-center py-12">
        <div className="w-full max-w-xl text-center flex flex-col items-center">
          <div className="h-24 w-24 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-6 shadow-inner">
            <FileQuestion className="h-12 w-12 stroke-[1.5]" />
          </div>

          <h1 className="text-3xl sm:text-4xl font-normal text-slate-900 dark:text-white tracking-tight">
            {vi ? '404. Đã xảy ra lỗi.' : "404. That's an error."}
          </h1>

          <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-md leading-relaxed">
            {vi
              ? 'URL được yêu cầu không tìm thấy trên máy chủ HCDrive hoặc tệp/thư mục này đã bị xoá. Đó là tất cả những gì chúng tôi biết.'
              : "The requested URL was not found on this server or the file/folder has been deleted. That's all we know."}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              className="rounded-full px-5 h-10 text-xs sm:text-sm font-medium border-slate-300 dark:border-slate-700 gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{vi ? 'Quay lại' : 'Go back'}</span>
            </Button>

            <Link to="/home">
              <Button
                variant="filled"
                className="rounded-full px-6 h-10 text-xs sm:text-sm font-medium gap-2"
              >
                <Home className="h-4 w-4" />
                <span>{vi ? 'Về trang chủ HCDrive' : 'Go to HCDrive Home'}</span>
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
        <div className="flex items-center gap-4">
          <span>HCDrive Cloud Storage Gateway</span>
          <span>·</span>
          <span>Google Drive 2024 Design Standard</span>
        </div>

        <div className="flex items-center gap-6">
          <Link to="/home" className="hover:underline">{vi ? 'Trang chủ' : 'Home'}</Link>
          <a href="#" className="hover:underline">{vi ? 'Bảo mật' : 'Privacy'}</a>
          <a href="#" className="hover:underline">{vi ? 'Điều khoản' : 'Terms'}</a>
        </div>
      </footer>
    </div>
  )
}
