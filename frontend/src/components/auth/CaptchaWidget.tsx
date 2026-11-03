import { useEffect, useRef, useState } from 'react'

// Google reCAPTCHA v2 (checkbox) or Cloudflare Turnstile, picked by the admin in Settings → Security.
// The page sends the token it hands to onToken; the backend checks it (utils/captcha.ts).

export type CaptchaProvider = 'none' | 'recaptcha' | 'turnstile'
export type CaptchaConfig = { provider: CaptchaProvider; siteKey: string | null; onRegister: boolean; onLogin: boolean }

type RenderOptions = { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback'?: () => void; theme?: string }

declare global {
  interface Window {
    grecaptcha?: { render: (el: HTMLElement, options: RenderOptions) => number; reset: (id?: number) => void; ready?: (cb: () => void) => void }
    turnstile?: { render: (el: HTMLElement, options: RenderOptions) => string; reset: (id?: string) => void; remove: (id: string) => void }
  }
}

const SCRIPTS: Record<Exclude<CaptchaProvider, 'none'>, string> = {
  recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
}

/** The widget a sign-in / sign-up form needs, or null. An env-only reCAPTCHA setup keeps its site key in VITE_RECAPTCHA_SITE_KEY. */
export function captchaFor(config: CaptchaConfig | null, action: 'register' | 'login') {
  if (!config || config.provider === 'none' || !(action === 'register' ? config.onRegister : config.onLogin)) return null
  const siteKey = config.siteKey || (config.provider === 'recaptcha' ? import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim() : '')
  return siteKey ? { provider: config.provider, siteKey } : null
}

const loading = new Map<string, Promise<void>>()

function loadScript(provider: Exclude<CaptchaProvider, 'none'>) {
  const ready = () => (provider === 'recaptcha' ? Boolean(window.grecaptcha?.render) : Boolean(window.turnstile?.render))
  if (ready()) return Promise.resolve()
  let promise = loading.get(provider)
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPTS[provider]
      script.async = true
      script.defer = true
      script.onerror = () => {
        loading.delete(provider)
        reject(new Error('captcha script failed to load'))
      }
      script.onload = () => {
        // grecaptcha.render appears a moment after the script itself has loaded.
        const started = Date.now()
        const wait = () => (ready() ? resolve() : Date.now() - started > 10_000 ? reject(new Error('captcha not ready')) : window.setTimeout(wait, 50))
        wait()
      }
      document.head.appendChild(script)
    })
    loading.set(provider, promise)
  }
  return promise
}

/** The captcha box. Change `resetKey` to get a fresh challenge (after a failed submit). */
export function CaptchaWidget({ provider, siteKey, onToken, resetKey = 0, vi = true }: { provider: Exclude<CaptchaProvider, 'none'>; siteKey: string; onToken: (token: string) => void; resetKey?: number; vi?: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let widgetId: string | number | null = null
    const host = boxRef.current
    setFailed(false)
    onTokenRef.current('')
    loadScript(provider)
      .then(() => {
        if (cancelled || !host) return
        // A fresh child per render: both libraries refuse to render twice into the same element.
        const box = document.createElement('div')
        host.replaceChildren(box)
        const options: RenderOptions = {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        }
        widgetId = provider === 'recaptcha' ? window.grecaptcha!.render(box, options) : window.turnstile!.render(box, options)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (provider === 'turnstile' && typeof widgetId === 'string') window.turnstile?.remove(widgetId)
      host?.replaceChildren()
    }
  }, [provider, siteKey, resetKey])

  return (
    <div>
      {/* Both widgets are about 300px wide: scroll instead of widening a narrow column. */}
      <div ref={boxRef} className="min-h-[65px] max-w-full overflow-x-auto" />
      {failed ? (
        <p className="mt-1 text-[13px] text-red-600 dark:text-red-400">
          {vi ? 'Không tải được captcha. Kiểm tra kết nối mạng hoặc trình chặn quảng cáo rồi tải lại trang.' : 'The captcha did not load. Check your connection or ad blocker, then reload.'}
        </p>
      ) : null}
    </div>
  )
}
