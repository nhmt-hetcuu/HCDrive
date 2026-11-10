import { useState, useEffect, type FormEvent } from 'react'
import { Check, CheckCircle, Cookie, Copy, ExternalLink, Globe, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { apiFetch } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { cn } from '@/lib/utils'

export type OAuthMethod = 'rclone' | 'custom' | 'cookie'

type OAuthMethodInfo = {
  hasCustom: boolean
  customClientId?: string | null
  defaultMethod: OAuthMethod
  methods: Array<{ id: OAuthMethod; name: string; description: string; badge?: string; available: boolean }>
}

interface GoogleConnectModalProps {
  open: boolean
  initialMethod?: OAuthMethod
  onClose: () => void
  onSuccess?: () => void
}

export function GoogleConnectModal({ open, initialMethod, onClose, onSuccess }: GoogleConnectModalProps) {
  const { lang } = useLanguage()
  const [methodsData, setMethodsData] = useState<OAuthMethodInfo | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<OAuthMethod>('rclone')
  const [loadingMethods, setLoadingMethods] = useState(true)

  // Step state: 'select' -> 'verify' | 'cookie'
  const [step, setStep] = useState<'select' | 'verify' | 'cookie'>('select')
  const [verifyUrl, setVerifyUrl] = useState('')
  const [launching, setLaunching] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Code exchange state
  const [pasteCode, setPasteCode] = useState('')
  const [exchangingCode, setExchangingCode] = useState(false)

  // Cookie connection state
  const [cookieInput, setCookieInput] = useState('')
  const [cookieEmail, setCookieEmail] = useState('')
  const [cookieDisplayName, setCookieDisplayName] = useState('')
  const [connectingCookie, setConnectingCookie] = useState(false)

  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    if (!open) {
      setStep('select')
      setVerifyUrl('')
      setPasteCode('')
      setCookieInput('')
      setCookieEmail('')
      setCookieDisplayName('')
      setErrorMsg('')
      setSuccessMsg('')
      return
    }

    if (initialMethod === 'cookie') {
      setSelectedMethod('cookie')
      setStep('cookie')
    } else if (initialMethod) {
      setSelectedMethod(initialMethod)
      setStep('select')
    }

    setLoadingMethods(true)
    apiFetch<OAuthMethodInfo>('/connected-accounts/google/auth-methods')
      .then((data) => {
        setMethodsData(data)
        if (!initialMethod) {
          setSelectedMethod(data.hasCustom ? 'custom' : 'rclone')
        }
      })
      .catch(() => {
        if (!initialMethod) setSelectedMethod('rclone')
      })
      .finally(() => setLoadingMethods(false))

    // Listen for window message from Google callback popup
    function handlePopupMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'GOOGLE_CONNECTED' && event.data?.status === 'success') {
        setSuccessMsg(lang === 'vi' ? 'Kết nối tài khoản Google Drive thành công!' : 'Google Drive connected successfully!')
        setTimeout(() => {
          onSuccess?.()
          onClose()
        }, 1200)
      }
    }

    window.addEventListener('message', handlePopupMessage)
    return () => window.removeEventListener('message', handlePopupMessage)
  }, [open, initialMethod, lang])

  async function handleProceed() {
    if (selectedMethod === 'cookie') {
      setStep('cookie')
      setErrorMsg('')
      setSuccessMsg('')
      return
    }

    setLaunching(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const data = await apiFetch<{ url: string }>(`/connected-accounts/google/connect-url?method=${selectedMethod}`)
      setVerifyUrl(data.url)
      setStep('verify')

      // TỰ ĐỘNG MỞ TAB / POPUP MỚI NGAY LẬP TỨC
      const popup = window.open(data.url, 'google-drive-oauth', 'width=560,height=720')
      if (!popup) {
        setErrorMsg(lang === 'vi' ? 'Trình duyệt đã chặn popup tự động. Vui lòng bấm "Mở Tab Mới" bên dưới.' : 'Popup was blocked by browser. Please click "Open Tab" below.')
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Không thể tạo link xác thực Google.')
    } finally {
      setLaunching(false)
    }
  }

  async function handleExchange(e: FormEvent) {
    e.preventDefault()
    if (!pasteCode.trim()) return

    setExchangingCode(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const res = await apiFetch<{ status: string; email: string }>('/connected-accounts/google/exchange-code', {
        method: 'POST',
        body: JSON.stringify({
          code: pasteCode.trim(),
          method: selectedMethod,
        }),
      })

      setSuccessMsg(lang === 'vi' ? `Kết nối thành công Google Drive (${res.email})!` : `Connected Google Drive (${res.email}) successfully!`)
      setPasteCode('')
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 1200)
    } catch (err: any) {
      setErrorMsg(err.message || (lang === 'vi' ? 'Xác nhận mã code thất bại. Vui lòng kiểm tra lại đường link hoặc mã.' : 'Code exchange failed. Please verify the code or URL.'))
    } finally {
      setExchangingCode(false)
    }
  }

  async function handleConnectCookie(e: FormEvent) {
    e.preventDefault()
    if (!cookieInput.trim()) {
      setErrorMsg(lang === 'vi' ? 'Vui lòng nhập chuỗi Cookie.' : 'Please enter the Cookie string.')
      return
    }

    setConnectingCookie(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      const res = await apiFetch<{ success: boolean; account: { email: string; displayName?: string } }>('/connected-accounts/google/cookie', {
        method: 'POST',
        body: JSON.stringify({
          cookie: cookieInput.trim(),
          email: cookieEmail.trim() || undefined,
          displayName: cookieDisplayName.trim() || undefined,
        }),
      })

      setSuccessMsg(
        lang === 'vi'
          ? `Kết nối thành công Google Drive (${res.account.displayName || res.account.email})!`
          : `Connected Google Drive account (${res.account.displayName || res.account.email}) successfully!`
      )
      setCookieInput('')
      setCookieEmail('')
      setCookieDisplayName('')
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 1200)
    } catch (err: any) {
      setErrorMsg(err.message || (lang === 'vi' ? 'Kết nối bằng Cookie thất bại. Vui lòng kiểm tra lại Cookie.' : 'Cookie connection failed. Please check the Cookie.'))
    } finally {
      setConnectingCookie(false)
    }
  }

  return (
    <DummyModal
      open={open}
      title={
        step === 'cookie'
          ? (lang === 'vi' ? 'Kết nối Google Drive bằng Cookie' : 'Connect Google Drive with Cookie')
          : (lang === 'vi' ? 'Kết nối tài khoản Google Drive' : 'Connect Google Drive Account')
      }
      description={
        step === 'cookie'
          ? (lang === 'vi' ? 'Dán Cookie phiên đăng nhập Google Drive từ trình duyệt để vượt quyền riêng tư và stream video.' : 'Paste Google Drive session cookie from browser.')
          : step === 'select'
          ? (lang === 'vi' ? 'Chọn phương thức xác thực Google Drive phù hợp nhu cầu của bạn.' : 'Choose authentication method for Google Drive.')
          : (lang === 'vi' ? 'Tab đăng nhập đã được mở. Sau khi đăng nhập, dán mã hoặc đường link vào đây để xác nhận.' : 'Login tab is open. After approving, paste the code or redirected URL below.')
      }
      onClose={onClose}
    >
      <div className="grid gap-3.5">
        {successMsg ? (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 p-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        ) : null}

        {errorMsg ? (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 p-3 text-xs font-semibold text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        ) : null}

        {/* STEP 1: Select Method */}
        {step === 'select' && (
          <div className="grid gap-3">
            {loadingMethods ? (
              <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span>{lang === 'vi' ? 'Đang kiểm tra phương thức...' : 'Checking available methods...'}</span>
              </div>
            ) : (
              methodsData?.methods.map((m) => {
                const isSelected = selectedMethod === m.id
                const isCookie = m.id === 'cookie'
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      if (m.available) setSelectedMethod(m.id)
                    }}
                    className={cn(
                      "p-3.5 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3",
                      isSelected
                        ? (isCookie
                            ? "border-amber-500 bg-amber-50/60 dark:bg-amber-950/40"
                            : "border-blue-600 bg-blue-50/60 dark:bg-blue-950/40")
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900",
                      !m.available && "opacity-50 cursor-not-allowed hover:border-slate-200"
                    )}
                  >
                    <input
                      type="radio"
                      name="google_oauth_method_choice"
                      checked={isSelected}
                      onChange={() => setSelectedMethod(m.id)}
                      disabled={!m.available}
                      className={cn("mt-1 h-4 w-4", isCookie ? "accent-amber-600" : "accent-blue-600")}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isCookie ? <Cookie className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" /> : null}
                        <span className="font-bold text-sm text-slate-900 dark:text-white">{m.name}</span>
                        {m.badge ? (
                          <span className={cn(
                            "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                            isCookie
                              ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800"
                              : m.id === 'rclone'
                              ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800"
                              : "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800"
                          )}>
                            {m.badge}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {m.description}
                      </p>
                    </div>
                  </div>
                )
              })
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 mt-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                {lang === 'vi' ? 'Huỷ' : 'Cancel'}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleProceed}
                disabled={launching || loadingMethods}
                className={cn(
                  "font-bold gap-1.5",
                  selectedMethod === 'cookie' ? "bg-amber-600 hover:bg-amber-700 text-white" : ""
                )}
              >
                {launching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : selectedMethod === 'cookie' ? (
                  <Cookie className="h-4 w-4" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                <span>
                  {selectedMethod === 'cookie'
                    ? (lang === 'vi' ? 'Tiếp tục nhập Cookie' : 'Proceed to enter Cookie')
                    : (lang === 'vi' ? 'Mở Tab Google & Tiếp tục' : 'Open Tab & Continue')}
                </span>
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Simultaneous New Tab & Link Verification Box (OAuth) */}
        {step === 'verify' && (
          <div className="grid gap-3.5">
            <div className="rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 p-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-blue-600" />
                    {lang === 'vi' ? 'Tab đăng nhập Google đã được mở' : 'Google Login Tab Opened'}
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {lang === 'vi' ? 'Nếu tab chưa tự mở, bạn có thể bấm nút bên cạnh:' : 'If tab did not open, click the button:'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-bold gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(verifyUrl)
                      setCopiedLink(true)
                      setTimeout(() => setCopiedLink(false), 2000)
                    }}
                  >
                    {copiedLink ? <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedLink ? (lang === 'vi' ? 'Đã copy' : 'Copied') : (lang === 'vi' ? 'Copy Link' : 'Copy')}</span>
                  </Button>
                  <a
                    href={verifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>{lang === 'vi' ? 'Mở lại Tab' : 'Re-open Tab'}</span>
                  </a>
                </div>
              </div>
            </div>

            <form onSubmit={handleExchange} className="grid gap-2">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {lang === 'vi'
                  ? 'Sau khi bấm Cho phép, dán mã code hoặc toàn bộ đường link trình duyệt vào đây:'
                  : 'After approving on Google, paste the code or redirected URL here:'}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className="h-10 flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-xs focus:border-blue-600 focus:outline-none"
                  placeholder={lang === 'vi' ? 'Dán mã code 4/0A... hoặc link callback...' : 'Paste code 4/0A... or callback URL...'}
                  value={pasteCode}
                  onChange={(e) => setPasteCode(e.target.value)}
                  required
                />
                <Button
                  type="submit"
                  disabled={exchangingCode || !pasteCode.trim()}
                  size="sm"
                  className="h-10 px-4 shrink-0 font-bold gap-1.5"
                >
                  {exchangingCode ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span>{exchangingCode ? (lang === 'vi' ? 'Đang kết nối...' : 'Connecting...') : (lang === 'vi' ? 'Xác Nhận & Kết Nối' : 'Confirm & Connect')}</span>
                </Button>
              </div>
            </form>

            <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <button
                type="button"
                className="text-slate-500 hover:text-blue-600 font-semibold"
                onClick={() => setStep('select')}
              >
                ← {lang === 'vi' ? 'Chọn lại phương thức' : 'Change method'}
              </button>
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                {lang === 'vi' ? 'Đóng' : 'Close'}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Connect via Cookie */}
        {step === 'cookie' && (
          <form onSubmit={handleConnectCookie} className="grid gap-3.5">
            <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 p-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300 mb-1">
                <Cookie className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>{lang === 'vi' ? 'Hướng dẫn lấy Cookie Google Drive' : 'How to get Google Drive Cookie'}</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                <li>{lang === 'vi' ? 'Mở Google Drive (drive.google.com) trên trình duyệt đã đăng nhập tài khoản.' : 'Open Google Drive (drive.google.com) in browser where you are logged in.'}</li>
                <li>{lang === 'vi' ? 'Bấm F12 -> tab Network -> tải lại trang -> bấm vào request "drive.google.com".' : 'Press F12 -> Network tab -> reload -> click any request like "drive.google.com".'}</li>
                <li>{lang === 'vi' ? 'Trong Request Headers, copy toàn bộ giá trị của Cookie dán vào ô bên dưới.' : 'In Request Headers, copy the full value of Cookie and paste below.'}</li>
              </ol>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'vi' ? 'Email hoặc Tên gợi nhớ (Tùy chọn)' : 'Email or Account Label (Optional)'}
              </label>
              <input
                type="text"
                placeholder="vd: myaccount@gmail.com hoặc Drive Khóa học"
                value={cookieEmail}
                onChange={(e) => setCookieEmail(e.target.value)}
                className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                {lang === 'vi' ? 'Hệ thống sẽ tự động phát hiện email từ Cookie nếu bạn để trống.' : 'The system will automatically detect your email from Cookie if left empty.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                <span>{lang === 'vi' ? 'Chuỗi Cookie Google Drive' : 'Google Drive Cookie String'} <span className="text-red-500">*</span></span>
              </label>
              <textarea
                rows={4}
                required
                placeholder="SID=...; HSID=...; SSID=...; SAPISID=...; ..."
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                className="w-full text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{lang === 'vi' ? 'Cookie được mã hóa AES-256 an toàn trong cơ sở dữ liệu và chỉ dùng máy chủ HCDrive để tải/stream.' : 'Cookie is securely encrypted with AES-256 and only used by HCDrive server.'}</span>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-amber-600 font-semibold"
                onClick={() => setStep('select')}
              >
                ← {lang === 'vi' ? 'Chọn lại phương thức' : 'Change method'}
              </button>
              <Button
                type="submit"
                size="sm"
                disabled={connectingCookie || !cookieInput.trim()}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white rounded-full px-5 text-xs font-medium"
              >
                {connectingCookie ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{lang === 'vi' ? 'Đang kiểm tra & kết nối...' : 'Verifying & connecting...'}</span>
                  </>
                ) : (
                  <>
                    <Cookie className="h-3.5 w-3.5" />
                    <span>{lang === 'vi' ? 'Kiểm tra & Kết nối' : 'Verify & Connect'}</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </DummyModal>
  )
}
