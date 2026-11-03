import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useSnackbar } from '@/context/SnackbarContext'
import { Button } from '@/components/ui/button'
import { CaptchaWidget, type CaptchaProvider } from '@/components/auth/CaptchaWidget'
import { cn } from '@/lib/utils'

// Settings → Security (admin): captcha keys for sign-up / sign-in, and how HCDrive finds the client IP
// behind Cloudflare and nginx. Backend: modules/system/security.routes.ts.

type CaptchaSettings = {
  provider: CaptchaProvider
  recaptchaSiteKey: string
  hasRecaptchaSecret: boolean
  turnstileSiteKey: string
  hasTurnstileSecret: boolean
  onRegister: boolean
  onLogin: boolean
  fromEnv: boolean
  disabledByEnv: boolean
}

type NetworkInfo = {
  mode: 'auto' | 'off'
  envTrustProxy: string | null
  clientIp: string
  detected: { ip: string; viaCloudflare: boolean; viaProxy: boolean }
  request: { peer: string | null; host: string | null; forwardedFor: string | null; realIp: string | null; cfConnectingIp: string | null; cfRay: string | null; forwardedProto: string | null }
  seenSecondsAgo: { cloudflare: number | null; proxy: number | null; direct: number | null }
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 dark:border-slate-700 dark:bg-[#131314] dark:text-slate-100 font-mono'

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
      <div className="sm:w-56 shrink-0">
        <p className="font-medium text-slate-800 dark:text-slate-200">{label}</p>
        {hint ? <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p> : null}
      </div>
      <div className="flex-1 min-w-0 space-y-3">{children}</div>
    </div>
  )
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function SecuritySettings({ vi }: { vi: boolean }) {
  return (
    <div className="divide-y divide-slate-200/80 dark:divide-slate-800 text-xs">
      <CaptchaSection vi={vi} />
      <NetworkSection vi={vi} />
    </div>
  )
}

function CaptchaSection({ vi }: { vi: boolean }) {
  const { showSnackbar } = useSnackbar()
  const [saved, setSaved] = useState<CaptchaSettings | null>(null)
  const [provider, setProvider] = useState<CaptchaProvider>('none')
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState('')
  const [recaptchaSecret, setRecaptchaSecret] = useState('')
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileSecret, setTurnstileSecret] = useState('')
  const [onRegister, setOnRegister] = useState(true)
  const [onLogin, setOnLogin] = useState(false)
  const [testToken, setTestToken] = useState('')
  const [testReset, setTestReset] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function apply(data: CaptchaSettings) {
    setSaved(data)
    setProvider(data.provider)
    setRecaptchaSiteKey(data.recaptchaSiteKey)
    setTurnstileSiteKey(data.turnstileSiteKey)
    setRecaptchaSecret('')
    setTurnstileSecret('')
    setOnRegister(data.onRegister)
    setOnLogin(data.onLogin)
    setTestToken('')
  }

  useEffect(() => {
    apiFetch<CaptchaSettings>('/system/security/captcha').then(apply).catch((err) => setError(errorText(err, 'Could not load')))
  }, [])

  const siteKey = provider === 'recaptcha' ? recaptchaSiteKey.trim() : provider === 'turnstile' ? turnstileSiteKey.trim() : ''
  const typedSecret = provider === 'recaptcha' ? recaptchaSecret.trim() : provider === 'turnstile' ? turnstileSecret.trim() : ''
  const hasSecret = provider === 'recaptcha' ? saved?.hasRecaptchaSecret : provider === 'turnstile' ? saved?.hasTurnstileSecret : false
  const storedSiteKey = provider === 'recaptcha' ? saved?.recaptchaSiteKey : saved?.turnstileSiteKey
  // New keys must be proven with a solved test captcha before they can lock the sign-in page.
  const needsTest = provider !== 'none' && (provider !== saved?.provider || siteKey !== storedSiteKey || Boolean(typedSecret))

  async function save() {
    setError('')
    if (provider !== 'none') {
      if (!siteKey) return setError(vi ? 'Nhập Site key.' : 'Enter the site key.')
      if (!typedSecret && !hasSecret) return setError(vi ? 'Nhập Secret key.' : 'Enter the secret key.')
      if (needsTest && !testToken) return setError(vi ? 'Giải captcha thử bên dưới trước khi lưu.' : 'Solve the test captcha below first.')
    }
    setSaving(true)
    try {
      const data = await apiFetch<CaptchaSettings>('/system/security/captcha', {
        method: 'PUT',
        body: JSON.stringify({
          provider,
          recaptchaSiteKey: recaptchaSiteKey.trim(),
          recaptchaSecret: recaptchaSecret.trim() || undefined,
          turnstileSiteKey: turnstileSiteKey.trim(),
          turnstileSecret: turnstileSecret.trim() || undefined,
          onRegister,
          onLogin,
          testToken: needsTest ? testToken : undefined,
        }),
      })
      apply(data)
      showSnackbar(vi ? 'Đã lưu cài đặt captcha' : 'Captcha settings saved')
    } catch (err) {
      setError(errorText(err, vi ? 'Không lưu được' : 'Could not save'))
      setTestToken('')
      setTestReset((value) => value + 1)
    } finally {
      setSaving(false)
    }
  }

  const options: Array<{ id: CaptchaProvider; title: string; desc: string }> = [
    { id: 'none', title: vi ? 'Tắt' : 'Off', desc: vi ? 'Không dùng captcha.' : 'No captcha.' },
    { id: 'recaptcha', title: 'Google reCAPTCHA v2', desc: vi ? 'Ô "Tôi không phải người máy".' : 'The "I\'m not a robot" checkbox.' },
    { id: 'turnstile', title: 'Cloudflare Turnstile', desc: vi ? 'Thường không cần bấm gì, không theo dõi quảng cáo.' : 'Usually no clicks, no ad tracking.' },
  ]

  if (!saved && !error) {
    return <div className="py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }

  return (
    <>
      <Row
        label="Captcha"
        hint={vi ? 'Chặn bot tự động đăng ký / dò mật khẩu. Đăng nhập bằng Google không cần captcha.' : 'Stops bots signing up or guessing passwords. Google sign-in skips it.'}
      >
        {saved?.disabledByEnv ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {vi ? 'DISABLE_CAPTCHA đang bật trong biến môi trường: mọi kiểm tra captcha đang tắt dù cài đặt bên dưới.' : 'DISABLE_CAPTCHA is set in the environment: every captcha check is off whatever is set below.'}
          </p>
        ) : null}
        {saved?.fromEnv ? (
          <p className="text-slate-500">{vi ? 'Đang dùng RECAPTCHA_SECRET_KEY từ biến môi trường. Lưu ở đây sẽ thay thế nó.' : 'Using RECAPTCHA_SECRET_KEY from the environment. Saving here replaces it.'}</p>
        ) : null}
        <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {options.map((option) => (
            <label key={option.id} className={cn('cursor-pointer rounded-xl border p-3 transition', provider === option.id ? 'border-blue-500 bg-white ring-2 ring-blue-500/20 dark:bg-[#1e1f20]' : 'border-slate-200 bg-white/60 hover:border-slate-300 dark:border-slate-800 dark:bg-white/5')}>
              <span className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">{option.title}</span>
                <input type="radio" name="captchaProvider" className="accent-[#0b57d0]" checked={provider === option.id} onChange={() => { setProvider(option.id); setError(''); setTestToken('') }} />
              </span>
              <span className="mt-1 block text-[11px] text-slate-500">{option.desc}</span>
            </label>
          ))}
        </div>

        {provider === 'recaptcha' ? (
          <div className="space-y-2">
            <a href="https://www.google.com/recaptcha/admin/create" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">
              <ExternalLink className="h-3.5 w-3.5" />{vi ? 'Tạo khoá reCAPTCHA' : 'Create reCAPTCHA keys'}
            </a>
            <p className="text-[11px] text-slate-500">{vi ? 'Chọn "Thử thách (v2)" → "Hộp kiểm Tôi không phải người máy", thêm tên miền bạn mở HCDrive (cả IP LAN nếu có).' : 'Pick "Challenge (v2)" → "I\'m not a robot" checkbox and add the domains you open HCDrive on.'}</p>
            <label className="block text-slate-600 dark:text-slate-300">Site key<input value={recaptchaSiteKey} onChange={(event) => setRecaptchaSiteKey(event.target.value)} className={cn(inputClass, 'mt-1')} /></label>
            <label className="block text-slate-600 dark:text-slate-300">Secret key<input type="password" autoComplete="off" value={recaptchaSecret} onChange={(event) => setRecaptchaSecret(event.target.value)} placeholder={saved?.hasRecaptchaSecret ? (vi ? 'Đã lưu — để trống để giữ nguyên' : 'Saved — leave blank to keep') : ''} className={cn(inputClass, 'mt-1')} /></label>
          </div>
        ) : null}

        {provider === 'turnstile' ? (
          <div className="space-y-2">
            <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">
              <ExternalLink className="h-3.5 w-3.5" />{vi ? 'Tạo widget Turnstile' : 'Create a Turnstile widget'}
            </a>
            <p className="text-[11px] text-slate-500">{vi ? 'Thêm đúng hostname bạn mở HCDrive (ví dụ drive.tenmien.com). Turnstile không chạy trên địa chỉ IP trần; để thử trên máy có thể dùng khoá test của Cloudflare.' : 'Add the exact hostname you open HCDrive on. Turnstile does not run on a bare IP; Cloudflare\'s test keys work for trying it out.'}</p>
            <label className="block text-slate-600 dark:text-slate-300">Site key<input value={turnstileSiteKey} onChange={(event) => setTurnstileSiteKey(event.target.value)} className={cn(inputClass, 'mt-1')} /></label>
            <label className="block text-slate-600 dark:text-slate-300">Secret key<input type="password" autoComplete="off" value={turnstileSecret} onChange={(event) => setTurnstileSecret(event.target.value)} placeholder={saved?.hasTurnstileSecret ? (vi ? 'Đã lưu — để trống để giữ nguyên' : 'Saved — leave blank to keep') : ''} className={cn(inputClass, 'mt-1')} /></label>
          </div>
        ) : null}

        {provider !== 'none' ? (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300"><input type="checkbox" className="accent-[#0b57d0]" checked={onRegister} onChange={(event) => setOnRegister(event.target.checked)} />{vi ? 'Khi đăng ký tài khoản' : 'On sign-up'}</label>
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300"><input type="checkbox" className="accent-[#0b57d0]" checked={onLogin} onChange={(event) => setOnLogin(event.target.checked)} />{vi ? 'Khi đăng nhập bằng email + mật khẩu' : 'On email + password sign-in'}</label>
          </div>
        ) : null}

        {needsTest && siteKey ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
            <p className="mb-2 text-slate-600 dark:text-slate-300">{vi ? 'Giải captcha thử với khoá mới. HCDrive kiểm tra với Secret key trước khi lưu, để khoá sai không khoá luôn trang đăng nhập.' : 'Solve this test captcha with the new keys. HCDrive checks it against the secret before saving, so wrong keys cannot lock the sign-in page.'}</p>
            <CaptchaWidget key={`${provider}:${siteKey}`} provider={provider as Exclude<CaptchaProvider, 'none'>} siteKey={siteKey} onToken={setTestToken} resetKey={testReset} vi={vi} />
            {testToken ? <p className="mt-1 flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />{vi ? 'Đã giải — bấm Lưu.' : 'Solved — press Save.'}</p> : null}
          </div>
        ) : null}

        {error ? <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{vi ? 'Lưu' : 'Save'}</Button>
        </div>
        <p className="text-[11px] text-slate-500">{vi ? 'Lỡ bị khoá ngoài vì captcha: đặt DISABLE_CAPTCHA=true trong .env rồi khởi động lại container.' : 'Locked out by the captcha? Set DISABLE_CAPTCHA=true in .env and restart the container.'}</p>
      </Row>
    </>
  )
}

function Detected({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
      <div>
        <p className="font-medium text-slate-800 dark:text-slate-200">{label}</p>
        {detail ? <p className="text-[11px] text-slate-500">{detail}</p> : null}
      </div>
    </div>
  )
}

function NetworkSection({ vi }: { vi: boolean }) {
  const { showSnackbar } = useSnackbar()
  const [info, setInfo] = useState<NetworkInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    apiFetch<NetworkInfo>('/system/security/network')
      .then((data) => { setInfo(data); setError('') })
      .catch((err) => setError(errorText(err, 'Could not load')))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function setMode(mode: 'auto' | 'off') {
    try {
      await apiFetch('/system/security/network', { method: 'PUT', body: JSON.stringify({ mode }) })
      showSnackbar(vi ? 'Đã lưu' : 'Saved')
      load()
    } catch (err) {
      showSnackbar(errorText(err, vi ? 'Không lưu được' : 'Could not save'))
    }
  }

  const agoText = (seconds: number | null) => (seconds === null ? null : seconds < 90 ? (vi ? 'vừa xong' : 'just now') : vi ? `${Math.round(seconds / 60)} phút trước` : `${Math.round(seconds / 60)} min ago`)
  const cloudflareSeen = Boolean(info && (info.detected.viaCloudflare || info.seenSecondsAgo.cloudflare !== null))
  const proxySeen = Boolean(info && (info.detected.viaProxy || info.seenSecondsAgo.proxy !== null))
  const envLocked = Boolean(info?.envTrustProxy)

  return (
    <Row
      label={vi ? 'Proxy và IP người dùng' : 'Proxies and client IP'}
      hint={vi ? 'HCDrive tự nhận ra Cloudflare và reverse proxy (nginx, Docker) để lấy đúng IP người dùng cho giới hạn đăng nhập, danh sách phiên và captcha.' : 'HCDrive detects Cloudflare and reverse proxies (nginx, Docker) to get the real client IP for sign-in limits, sessions and captcha.'}
    >
      {error ? <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p> : null}
      {!info && !error ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
      {info ? (
        <>
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#1e1f20] grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <Detected
              ok={cloudflareSeen}
              label={cloudflareSeen ? (vi ? 'Đang chạy sau Cloudflare' : 'Behind Cloudflare') : vi ? 'Không thấy Cloudflare' : 'No Cloudflare seen'}
              detail={info.detected.viaCloudflare ? `CF-Ray ${info.request.cfRay ?? '—'}` : agoText(info.seenSecondsAgo.cloudflare) ? `${vi ? 'Lần cuối thấy' : 'Last seen'}: ${agoText(info.seenSecondsAgo.cloudflare)}` : null}
            />
            <Detected
              ok={proxySeen}
              label={proxySeen ? (vi ? 'Đang chạy sau reverse proxy (nginx…)' : 'Behind a reverse proxy (nginx…)') : vi ? 'Không thấy reverse proxy' : 'No reverse proxy seen'}
              detail={info.detected.viaProxy ? `${vi ? 'Proxy ở' : 'Proxy at'} ${info.request.peer}` : agoText(info.seenSecondsAgo.proxy) ? `${vi ? 'Lần cuối thấy' : 'Last seen'}: ${agoText(info.seenSecondsAgo.proxy)}` : null}
            />
            <Detected ok label={`${vi ? 'IP của bạn theo HCDrive' : 'Your IP as HCDrive sees it'}: ${info.clientIp}`} detail={`${vi ? 'Kết nối tới backend từ' : 'Connection to the backend from'} ${info.request.peer ?? '—'}`} />
            <Detected ok={info.request.forwardedProto === 'https'} label={info.request.forwardedProto === 'https' ? 'HTTPS' : vi ? 'Chưa thấy HTTPS qua proxy' : 'No HTTPS seen through a proxy'} detail={info.request.forwardedProto ? `X-Forwarded-Proto: ${info.request.forwardedProto}` : null} />
          </div>

          {envLocked ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {vi ? `TRUST_PROXY=${info.envTrustProxy} trong biến môi trường đang quyết định việc tin proxy; xoá nó để HCDrive tự nhận diện.` : `TRUST_PROXY=${info.envTrustProxy} in the environment decides which proxies are trusted; remove it to let HCDrive detect them.`}
            </p>
          ) : (
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                <input type="radio" name="proxyMode" className="mt-0.5 accent-[#0b57d0]" checked={info.mode === 'auto'} onChange={() => setMode('auto')} />
                <span><span className="font-medium">{vi ? 'Tự nhận diện (khuyên dùng)' : 'Detect automatically (recommended)'}</span><span className="block text-[11px] text-slate-500">{vi ? 'Chỉ tin X-Forwarded-For / X-Real-IP / CF-Connecting-IP khi chúng đến từ địa chỉ của Cloudflare hoặc mạng nội bộ (nginx, Docker).' : 'Trusts X-Forwarded-For / X-Real-IP / CF-Connecting-IP only from Cloudflare or private-network addresses (nginx, Docker).'}</span></span>
              </label>
              <label className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                <input type="radio" name="proxyMode" className="mt-0.5 accent-[#0b57d0]" checked={info.mode === 'off'} onChange={() => setMode('off')} />
                <span><span className="font-medium">{vi ? 'Không tin header proxy' : 'Trust no proxy headers'}</span><span className="block text-[11px] text-slate-500">{vi ? 'Khi người dùng kết nối thẳng vào HCDrive, không qua proxy nào.' : 'When users reach HCDrive directly, with no proxy.'}</span></span>
              </label>
            </div>
          )}

          <details className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-[#1e1f20]">
            <summary className="cursor-pointer text-slate-600 dark:text-slate-300">{vi ? 'Header của request này và cấu hình nginx gợi ý' : 'Headers of this request and a suggested nginx config'}</summary>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
              {Object.entries({ 'Peer': info.request.peer, 'Host': info.request.host, 'X-Forwarded-For': info.request.forwardedFor, 'X-Real-IP': info.request.realIp, 'CF-Connecting-IP': info.request.cfConnectingIp, 'CF-Ray': info.request.cfRay, 'X-Forwarded-Proto': info.request.forwardedProto }).map(([name, value]) => (
                <div key={name} className="contents"><dt className="text-slate-400">{name}</dt><dd className="break-all">{value ?? '—'}</dd></div>
              ))}
            </dl>
            <pre className="mt-3 overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-slate-700 dark:bg-black/40 dark:text-slate-300">{`location / {
    proxy_pass http://hcdrive:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
    client_max_body_size 0;
}`}</pre>
          </details>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={load} disabled={busy}><RefreshCw className={cn('mr-1.5 h-4 w-4', busy && 'animate-spin')} />{vi ? 'Kiểm tra lại' : 'Check again'}</Button>
          </div>
        </>
      ) : null}
    </Row>
  )
}
