import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { CaptchaWidget, captchaFor, type CaptchaConfig } from '@/components/auth/CaptchaWidget'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { apiFetch } from '@/lib/api'
import { setAuthSession, takeReturnPath, type AuthUser } from '@/lib/auth'
import { useLanguage } from '@/context/LanguageContext'
import { cn } from '@/lib/utils'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }

export function LoginPage() {
  const navigate = useNavigate()
  const { lang, setLang } = useLanguage()
  const vi = lang === 'vi'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Set by apiFetch when the session was signed out, e.g. from another browser.
  const [error, setError] = useState(() =>
    new URLSearchParams(window.location.search).get('expired') === '1'
      ? (vi ? 'Phiên đăng nhập đã kết thúc hoặc bị đăng xuất từ thiết bị khác. Hãy đăng nhập lại.' : 'Your session ended or was signed out from another device. Please sign in again.')
      : ''
  )
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null)
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig | null>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaReset, setCaptchaReset] = useState(0)
  const captcha = captchaFor(captchaConfig, 'login')

  const [oauthModalOpen, setOauthModalOpen] = useState(false)
  const [selectedMethod, setSelectedMethod] = useState<'rclone' | 'custom'>('rclone')
  const [hasCustomOauth, setHasCustomOauth] = useState(false)

  // Floating label focus states
  const [emailFocused, setEmailFocused] = useState(false)
  const [passwordFocused, setPasswordFocused] = useState(false)

  useEffect(() => {
    apiFetch<{ allowRegistration: boolean; captcha?: CaptchaConfig }>('/auth/config', { skipAuth: true })
      .then((data) => {
        setAllowRegistration(data.allowRegistration)
        setCaptchaConfig(data.captcha ?? null)
      })
      .catch(() => setAllowRegistration(true))

    apiFetch<{ hasCustom: boolean; defaultMethod: 'rclone' | 'custom' }>('/auth/google/methods', { skipAuth: true })
      .then((data) => {
        setHasCustomOauth(data.hasCustom)
        setSelectedMethod(data.defaultMethod)
      })
      .catch(() => undefined)
  }, [])

  function continueWithGoogle() {
    if (hasCustomOauth) {
      setOauthModalOpen(true)
    } else {
      redirectToGoogle('rclone')
    }
  }

  async function redirectToGoogle(method: 'rclone' | 'custom') {
    setOauthModalOpen(false)
    setGoogleLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ url: string }>(`/auth/google/url?method=${method}`, { skipAuth: true })
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : vi ? 'Đăng nhập Google thất bại' : 'Google login failed')
      setGoogleLoading(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (captcha && !captchaToken) {
      setError(vi ? 'Vui lòng hoàn thành xác thực captcha' : 'Please complete the captcha.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({ email, password, captchaToken: captcha ? captchaToken : undefined }),
      })
      setAuthSession(data.accessToken, data.refreshToken, data.user)
      navigate(takeReturnPath('/home'))
    } catch (err) {
      setError(err instanceof Error ? err.message : vi ? 'Đăng nhập không thành công' : 'Login failed')
      // A captcha token is single-use: a failed attempt needs a new one.
      if (captcha) {
        setCaptchaToken('')
        setCaptchaReset((value) => value + 1)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen w-full flex flex-col justify-between bg-[#f8fafd] dark:bg-[#1f1f1f] text-slate-800 dark:text-slate-200 p-4 sm:p-8 select-none">
      <div className="flex-1 flex items-center justify-center">
        {/* Google M3 Sign-in Card: 1040px 2-column container */}
        <div className="w-full max-w-[1040px] min-h-[460px] rounded-[28px] bg-white dark:bg-[#131314] border border-slate-200/80 dark:border-slate-800 p-8 sm:p-12 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
          {/* Left Column: Brand & Hero */}
          <div className="flex flex-col justify-between">
            <div>
              <BrandLogo size="md" />
              <h1 className="mt-6 text-3xl sm:text-4xl font-normal text-slate-900 dark:text-white tracking-tight">
                {vi ? 'Đăng nhập' : 'Sign in'}
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {vi ? 'Tiếp tục tới HCDrive' : 'to continue to HCDrive'}
              </p>
            </div>

            <div className="hidden md:block text-xs text-slate-400">
              <p>Google Drive 2024 Design Standard</p>
            </div>
          </div>

          {/* Right Column: Outlined Form with Floating Labels */}
          <div className="flex flex-col justify-center">
            <form onSubmit={submit} className="space-y-6">
              {/* Email/Username Outlined Input with Floating Label */}
              <div className="relative">
                <input
                  type="text"
                  id="login-email"
                  autoComplete="username"
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
                  htmlFor="login-email"
                  className={cn(
                    'absolute left-4 top-4 text-slate-500 dark:text-slate-400 transition-all pointer-events-none origin-left',
                    emailFocused || email
                      ? 'transform -translate-y-2.5 scale-75 text-[#0b57d0] dark:text-[#a8c7fa] font-medium'
                      : 'text-sm'
                  )}
                >
                  {vi ? 'Email hoặc tên người dùng' : 'Email or username'}
                </label>
              </div>

              {/* Password Outlined Input with Floating Label */}
              <div className="relative">
                <input
                  type="password"
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
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
                  htmlFor="login-password"
                  className={cn(
                    'absolute left-4 top-4 text-slate-500 dark:text-slate-400 transition-all pointer-events-none origin-left',
                    passwordFocused || password
                      ? 'transform -translate-y-2.5 scale-75 text-[#0b57d0] dark:text-[#a8c7fa] font-medium'
                      : 'text-sm'
                  )}
                >
                  {vi ? 'Nhập mật khẩu của bạn' : 'Enter your password'}
                </label>
              </div>

              {captcha && (
                <CaptchaWidget provider={captcha.provider} siteKey={captcha.siteKey} onToken={setCaptchaToken} resetKey={captchaReset} vi={vi} />
              )}

              {/* Error Message: Google style (Icon ⓘ + Danger text, no color box) */}
              {error && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Actions Row: Create Account & Next button */}
              <div className="pt-2 flex items-center justify-between">
                {allowRegistration !== false ? (
                  <Link
                    to="/register"
                    className="text-xs sm:text-sm font-medium text-[#0b57d0] dark:text-[#a8c7fa] hover:underline"
                  >
                    {vi ? 'Tạo tài khoản' : 'Create account'}
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">
                    {vi ? 'Đăng ký đang đóng' : 'Registration closed'}
                  </span>
                )}

                <Button
                  variant="filled"
                  type="submit"
                  disabled={loading}
                  className="rounded-full px-6 h-10 text-xs sm:text-sm"
                >
                  {loading ? (vi ? 'Đang xác thực...' : 'Signing in...') : (vi ? 'Tiếp theo' : 'Next')}
                </Button>
              </div>
            </form>

            {/* Google Divider & Button */}
            <div className="mt-8 pt-6 border-t border-slate-200/80 dark:border-slate-800">
              <Button
                variant="outline"
                type="button"
                disabled={googleLoading}
                onClick={continueWithGoogle}
                className="w-full h-11 rounded-full gap-2 text-xs sm:text-sm border-slate-300 dark:border-slate-700 font-medium"
              >
                <GoogleLogo />
                <span>{googleLoading ? (vi ? 'Đang chuyển hướng...' : 'Redirecting...') : (vi ? 'Đăng nhập bằng Google' : 'Sign in with Google')}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer: Language selector & Help links */}
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

      {/* Google OAuth Method Selector Modal */}
      {oauthModalOpen && (
        <DummyModal
          open={oauthModalOpen}
          title={vi ? 'Chọn phương thức xác thực Google' : 'Choose Google OAuth Method'}
          description={vi ? 'Đăng nhập bằng Rclone OAuth chuẩn hoặc ứng dụng Google OAuth cá nhân.' : 'Sign in using verified Rclone Desktop OAuth or custom OAuth credentials.'}
          onClose={() => setOauthModalOpen(false)}
        >
          <div className="grid gap-3 pt-2">
            <label
              className={cn(
                'p-4 rounded-2xl border cursor-pointer transition flex items-start gap-3',
                selectedMethod === 'rclone'
                  ? 'border-[#0b57d0] bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-[#0b57d0]'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
              )}
            >
              <input
                type="radio"
                name="oauth_method"
                checked={selectedMethod === 'rclone'}
                onChange={() => setSelectedMethod('rclone')}
                className="mt-1 accent-[#0b57d0]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">
                    Rclone Desktop OAuth
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                    {vi ? 'Khuyên dùng' : 'Recommended'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                  {vi ? 'Đã được Google xác minh, đăng nhập 1-click tiện lợi.' : 'Google-verified app, seamless 1-click login.'}
                </p>
              </div>
            </label>

            <label
              className={cn(
                'p-4 rounded-2xl border cursor-pointer transition flex items-start gap-3',
                selectedMethod === 'custom'
                  ? 'border-[#0b57d0] bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-[#0b57d0]'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
              )}
            >
              <input
                type="radio"
                name="oauth_method"
                checked={selectedMethod === 'custom'}
                onChange={() => setSelectedMethod('custom')}
                className="mt-1 accent-[#0b57d0]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white">
                    {vi ? 'Google OAuth cá nhân (Custom App)' : 'Custom Google OAuth App'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                  {vi ? 'Sử dụng Client ID & Secret bạn đã cấu hình trong phần Cài đặt.' : 'Uses your configured Client ID & Secret in system settings.'}
                </p>
              </div>
            </label>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 mt-2">
              <Button type="button" variant="text" size="sm" onClick={() => setOauthModalOpen(false)}>
                {vi ? 'Huỷ' : 'Cancel'}
              </Button>
              <Button type="button" variant="filled" size="sm" onClick={() => redirectToGoogle(selectedMethod)}>
                {vi ? 'Tiếp tục đăng nhập' : 'Continue to sign in'}
              </Button>
            </div>
          </div>
        </DummyModal>
      )}
    </main>
  )
}
