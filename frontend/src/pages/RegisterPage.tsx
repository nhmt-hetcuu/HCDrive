import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { CaptchaWidget, captchaFor, type CaptchaConfig } from '@/components/auth/CaptchaWidget'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { apiFetch } from '@/lib/api'
import { setAuthSession, takeReturnPath, type AuthUser } from '@/lib/auth'
import { useLanguage } from '@/context/LanguageContext'
import { cn } from '@/lib/utils'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }

export function RegisterPage() {
  const navigate = useNavigate()
  const { lang, setLang } = useLanguage()
  const vi = lang === 'vi'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null)
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const captcha = captchaFor(captchaConfig, 'register')

  // Floating label focus states
  const [nameFocused, setNameFocused] = useState(false)
  const [emailFocused, setEmailFocused] = useState(false)
  const [passwordFocused, setPasswordFocused] = useState(false)

  useEffect(() => {
    apiFetch<{ allowRegistration: boolean; captcha?: CaptchaConfig }>('/auth/config', { skipAuth: true })
      .then((data) => {
        setAllowRegistration(data.allowRegistration)
        setCaptchaConfig(data.captcha ?? null)
      })
      .catch(() => setAllowRegistration(true))
  }, [])

  async function continueWithGoogle() {
    setGoogleLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ url: string }>('/auth/google/url', { skipAuth: true })
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : vi ? 'Đăng ký Google thất bại' : 'Google register failed')
      setGoogleLoading(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    if (captcha && !captchaToken) {
      setError(vi ? 'Vui lòng hoàn thành xác thực captcha' : 'Please complete the captcha.')
      setLoading(false)
      return
    }
    try {
      const data = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({ name, email, password, captchaToken }),
      })
      setAuthSession(data.accessToken, data.refreshToken, data.user)
      navigate(takeReturnPath('/home'))
    } catch (err) {
      setError(err instanceof Error ? err.message : vi ? 'Đăng ký thất bại' : 'Register failed')
      setCaptchaReset((value) => value + 1)
      setCaptchaToken('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen w-full flex flex-col justify-between bg-[#f8fafd] dark:bg-[#1f1f1f] text-slate-800 dark:text-slate-200 p-4 sm:p-8 select-none">
      <div className="flex-1 flex items-center justify-center">
        {/* Google M3 Card: 1040px 2-column container */}
        <div className="w-full max-w-[1040px] min-h-[500px] rounded-[28px] bg-white dark:bg-[#131314] border border-slate-200/80 dark:border-slate-800 p-8 sm:p-12 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
          {/* Left Column: Brand & Hero */}
          <div className="flex flex-col justify-between">
            <div>
              <BrandLogo size="md" />
              <h1 className="mt-6 text-3xl sm:text-4xl font-normal text-slate-900 dark:text-white tracking-tight">
                {vi ? 'Tạo tài khoản HCDrive' : 'Create an HCDrive Account'}
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {vi ? 'Bắt đầu sử dụng cổng lưu trữ đám mây hợp nhất' : 'Enter your name and details to get started'}
              </p>
            </div>

            <div className="hidden md:block text-xs text-slate-400">
              <p>Google Drive 2024 Design Standard</p>
            </div>
          </div>

          {/* Right Column: Outlined Form with Floating Labels */}
          <div className="flex flex-col justify-center">
            {allowRegistration === false ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-6 text-center">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  {vi ? 'Đăng ký tự do hiện đang đóng' : 'Public registration is closed'}
                </p>
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  {vi
                    ? 'Quản trị viên đã tạm khoá chức năng tạo tài khoản mới. Vui lòng liên hệ Admin để được cấp tài khoản.'
                    : 'Administrator has disabled new user registrations. Please contact your admin for access.'}
                </p>
                <Link
                  to="/login"
                  className="mt-6 inline-block font-medium text-xs text-[#0b57d0] dark:text-[#a8c7fa] hover:underline"
                >
                  {vi ? '← Quay lại đăng nhập' : '← Back to sign in'}
                </Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-5">
                {/* Name */}
                <div className="relative">
                  <input
                    type="text"
                    id="register-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => setNameFocused(false)}
                    required
                    className={cn(
                      'peer w-full h-14 px-4 pt-2 rounded-lg border bg-transparent text-sm text-slate-900 dark:text-white transition-all outline-none',
                      'border-slate-300 dark:border-slate-700 focus:border-[#0b57d0] dark:focus:border-[#a8c7fa] focus:ring-1 focus:ring-[#0b57d0] dark:focus:ring-[#a8c7fa]'
                    )}
                    placeholder=" "
                  />
                  <label
                    htmlFor="register-name"
                    className={cn(
                      'absolute left-4 top-4 text-slate-500 dark:text-slate-400 transition-all pointer-events-none origin-left',
                      nameFocused || name
                        ? 'transform -translate-y-2.5 scale-75 text-[#0b57d0] dark:text-[#a8c7fa] font-medium'
                        : 'text-sm'
                    )}
                  >
                    {vi ? 'Họ và tên' : 'Full name'}
                  </label>
                </div>

                {/* Email */}
                <div className="relative">
                  <input
                    type="email"
                    id="register-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    required
                    className={cn(
                      'peer w-full h-14 px-4 pt-2 rounded-lg border bg-transparent text-sm text-slate-900 dark:text-white transition-all outline-none',
                      error
                        ? 'border-red-600 focus:border-red-600 focus:ring-1 focus:ring-red-600'
                        : 'border-slate-300 dark:border-slate-700 focus:border-[#0b57d0] dark:focus:border-[#a8c7fa] focus:ring-1 focus:ring-[#0b57d0] dark:focus:ring-[#a8c7fa]'
                    )}
                    placeholder=" "
                  />
                  <label
                    htmlFor="register-email"
                    className={cn(
                      'absolute left-4 top-4 text-slate-500 dark:text-slate-400 transition-all pointer-events-none origin-left',
                      emailFocused || email
                        ? 'transform -translate-y-2.5 scale-75 text-[#0b57d0] dark:text-[#a8c7fa] font-medium'
                        : 'text-sm'
                    )}
                  >
                    {vi ? 'Địa chỉ email' : 'Email address'}
                  </label>
                </div>

                {/* Password */}
                <div className="relative">
                  <input
                    type="password"
                    id="register-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    required
                    className={cn(
                      'peer w-full h-14 px-4 pt-2 rounded-lg border bg-transparent text-sm text-slate-900 dark:text-white transition-all outline-none',
                      'border-slate-300 dark:border-slate-700 focus:border-[#0b57d0] dark:focus:border-[#a8c7fa] focus:ring-1 focus:ring-[#0b57d0] dark:focus:ring-[#a8c7fa]'
                    )}
                    placeholder=" "
                  />
                  <label
                    htmlFor="register-password"
                    className={cn(
                      'absolute left-4 top-4 text-slate-500 dark:text-slate-400 transition-all pointer-events-none origin-left',
                      passwordFocused || password
                        ? 'transform -translate-y-2.5 scale-75 text-[#0b57d0] dark:text-[#a8c7fa] font-medium'
                        : 'text-sm'
                    )}
                  >
                    {vi ? 'Mật khẩu (tối thiểu 8 ký tự)' : 'Password (at least 8 characters)'}
                  </label>
                </div>

                {/* Captcha (reCAPTCHA or Turnstile) when the admin turned it on */}
                {captcha && (
                  <CaptchaWidget provider={captcha.provider} siteKey={captcha.siteKey} onToken={setCaptchaToken} resetKey={captchaReset} vi={vi} />
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Actions Row */}
                <div className="pt-2 flex items-center justify-between">
                  <Link
                    to="/login"
                    className="text-xs sm:text-sm font-medium text-[#0b57d0] dark:text-[#a8c7fa] hover:underline"
                  >
                    {vi ? 'Đăng nhập thay vào đó' : 'Sign in instead'}
                  </Link>

                  <Button
                    variant="filled"
                    type="submit"
                    disabled={loading}
                    className="rounded-full px-6 h-10 text-xs sm:text-sm"
                  >
                    {loading ? (vi ? 'Đang tạo...' : 'Creating...') : (vi ? 'Tạo tài khoản' : 'Next')}
                  </Button>
                </div>

                {/* Google Button */}
                <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800">
                  <Button
                    variant="outline"
                    type="button"
                    disabled={googleLoading}
                    onClick={continueWithGoogle}
                    className="w-full h-11 rounded-full gap-2 text-xs sm:text-sm border-slate-300 dark:border-slate-700 font-medium"
                  >
                    <GoogleLogo />
                    <span>{googleLoading ? (vi ? 'Đang chuyển hướng...' : 'Redirecting...') : (vi ? 'Đăng ký bằng tài khoản Google' : 'Sign up with Google')}</span>
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full max-w-[1040px] mx-auto mt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
        <div className="flex items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as 'vi' | 'en')}
            className="bg-transparent border-0 text-slate-600 dark:text-slate-400 text-xs cursor-pointer focus:outline-none"
          >
            <option value="vi">Tiếng Việt</option>
            <option value="en">English (United States)</option>
          </select>
        </div>

        <div className="flex items-center gap-6">
          <a href="#" className="hover:underline">{vi ? 'Trợ giúp' : 'Help'}</a>
          <a href="#" className="hover:underline">{vi ? 'Bảo mật' : 'Privacy'}</a>
          <a href="#" className="hover:underline">{vi ? 'Điều khoản' : 'Terms'}</a>
        </div>
      </footer>
    </main>
  )
}
