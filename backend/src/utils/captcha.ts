import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { decryptText, encryptText } from './crypto.js'

// Captcha for sign-up and (optionally) sign-in: Google reCAPTCHA v2 or Cloudflare Turnstile.
// Keys are set by an admin in Settings → Security and kept in system_settings (secrets encrypted).
// RECAPTCHA_SECRET_KEY / RECAPTCHA_SITE_KEY in the environment still work when nothing is saved.
// DISABLE_CAPTCHA=true turns every check off, for an admin locked out by a wrong key.

export type CaptchaProvider = 'none' | 'recaptcha' | 'turnstile'
export type CaptchaAction = 'register' | 'login'

const KEYS = {
  provider: 'captcha_provider',
  recaptchaSiteKey: 'captcha_recaptcha_site_key',
  recaptchaSecret: 'captcha_recaptcha_secret',
  turnstileSiteKey: 'captcha_turnstile_site_key',
  turnstileSecret: 'captcha_turnstile_secret',
  onRegister: 'captcha_on_register',
  onLogin: 'captcha_on_login',
} as const

const VERIFY_URL: Record<Exclude<CaptchaProvider, 'none'>, string> = {
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
}

type StoredCaptcha = {
  provider: CaptchaProvider
  recaptchaSiteKey: string
  recaptchaSecret: string
  turnstileSiteKey: string
  turnstileSecret: string
  onRegister: boolean
  onLogin: boolean
  fromEnv: boolean
}

let cache: { value: StoredCaptcha; until: number } | null = null

function decryptOrEmpty(value: string | undefined) {
  if (!value) return ''
  try {
    return decryptText(value)
  } catch {
    return ''
  }
}

export async function loadCaptchaSettings(): Promise<StoredCaptcha> {
  if (cache && cache.until > Date.now()) return cache.value
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(KEYS) } } })
  const get = (key: string) => rows.find((row) => row.key === key)?.value
  const saved = get(KEYS.provider) as CaptchaProvider | undefined
  const value: StoredCaptcha = {
    provider: saved ?? (env.RECAPTCHA_SECRET_KEY ? 'recaptcha' : 'none'),
    recaptchaSiteKey: get(KEYS.recaptchaSiteKey) ?? env.RECAPTCHA_SITE_KEY ?? '',
    recaptchaSecret: decryptOrEmpty(get(KEYS.recaptchaSecret)) || env.RECAPTCHA_SECRET_KEY || '',
    turnstileSiteKey: get(KEYS.turnstileSiteKey) ?? '',
    turnstileSecret: decryptOrEmpty(get(KEYS.turnstileSecret)),
    onRegister: get(KEYS.onRegister) !== 'false',
    onLogin: get(KEYS.onLogin) === 'true',
    fromEnv: !saved && Boolean(env.RECAPTCHA_SECRET_KEY),
  }
  cache = { value, until: Date.now() + 30_000 }
  return value
}

function activeKeys(settings: StoredCaptcha) {
  if (settings.provider === 'recaptcha') return { siteKey: settings.recaptchaSiteKey, secret: settings.recaptchaSecret }
  if (settings.provider === 'turnstile') return { siteKey: settings.turnstileSiteKey, secret: settings.turnstileSecret }
  return { siteKey: '', secret: '' }
}

/** What the sign-in / sign-up pages need: which widget to show, its public site key, and where. */
export async function publicCaptchaConfig() {
  const settings = await loadCaptchaSettings()
  const { siteKey, secret } = activeKeys(settings)
  const enabled = !isCaptchaDisabledByEnv() && settings.provider !== 'none' && Boolean(secret)
  return {
    provider: enabled ? settings.provider : ('none' as CaptchaProvider),
    // An env-only reCAPTCHA setup may leave the site key to VITE_RECAPTCHA_SITE_KEY in the frontend build.
    siteKey: enabled ? siteKey || null : null,
    onRegister: enabled && settings.onRegister,
    onLogin: enabled && settings.onLogin,
  }
}

function isCaptchaDisabledByEnv() {
  return env.DISABLE_CAPTCHA === 'true' || env.DISABLE_CAPTCHA === '1'
}

type VerifyResult = { success?: boolean; 'error-codes'?: string[] }

async function callVerify(provider: Exclude<CaptchaProvider, 'none'>, secret: string, token: string, remoteIp?: string) {
  const form = new URLSearchParams({ secret, response: token })
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp)
  const response = await fetch(VERIFY_URL[provider], { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) })
  return (await response.json()) as VerifyResult
}

/** True when the request passes (or no captcha is required for this action). */
export async function verifyCaptcha(action: CaptchaAction, token: string | undefined, remoteIp?: string) {
  const config = await publicCaptchaConfig()
  const required = action === 'register' ? config.onRegister : config.onLogin
  if (!required || config.provider === 'none') return true
  if (!token) return false
  const settings = await loadCaptchaSettings()
  try {
    const result = await callVerify(config.provider, activeKeys(settings).secret, token, remoteIp)
    return Boolean(result.success)
  } catch {
    return false
  }
}

/**
 * Checks a key pair before it is saved: the token comes from the widget the admin just solved with
 * the new site key, so a wrong site key or secret cannot lock everyone out of signing in.
 */
export async function checkCaptchaKeys(provider: Exclude<CaptchaProvider, 'none'>, secret: string, token: string, remoteIp?: string) {
  try {
    const result = await callVerify(provider, secret, token, remoteIp)
    if (result.success) return { ok: true as const }
    const codes = result['error-codes'] ?? []
    if (codes.some((code) => code.includes('secret'))) return { ok: false as const, reason: 'secret' as const, codes }
    return { ok: false as const, reason: 'token' as const, codes }
  } catch (error) {
    return { ok: false as const, reason: 'network' as const, codes: [error instanceof Error ? error.message : String(error)] }
  }
}

/** Admin view: never returns a secret, only whether one is stored. */
export async function adminCaptchaSettings() {
  const settings = await loadCaptchaSettings()
  return {
    provider: settings.provider,
    recaptchaSiteKey: settings.recaptchaSiteKey,
    hasRecaptchaSecret: Boolean(settings.recaptchaSecret),
    turnstileSiteKey: settings.turnstileSiteKey,
    hasTurnstileSecret: Boolean(settings.turnstileSecret),
    onRegister: settings.onRegister,
    onLogin: settings.onLogin,
    fromEnv: settings.fromEnv,
    disabledByEnv: isCaptchaDisabledByEnv(),
  }
}

export async function saveCaptchaSettings(next: {
  provider: CaptchaProvider
  recaptchaSiteKey?: string
  recaptchaSecret?: string
  turnstileSiteKey?: string
  turnstileSecret?: string
  onRegister: boolean
  onLogin: boolean
}) {
  const writes: Array<[string, string]> = [
    [KEYS.provider, next.provider],
    [KEYS.onRegister, String(next.onRegister)],
    [KEYS.onLogin, String(next.onLogin)],
  ]
  if (next.recaptchaSiteKey !== undefined) writes.push([KEYS.recaptchaSiteKey, next.recaptchaSiteKey])
  if (next.turnstileSiteKey !== undefined) writes.push([KEYS.turnstileSiteKey, next.turnstileSiteKey])
  // An empty secret field means "keep the stored one".
  if (next.recaptchaSecret) writes.push([KEYS.recaptchaSecret, encryptText(next.recaptchaSecret)])
  if (next.turnstileSecret) writes.push([KEYS.turnstileSecret, encryptText(next.turnstileSecret)])
  await prisma.$transaction(writes.map(([key, value]) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })))
  cache = null
}

/** Secret to test with: the one typed in the form, else the stored one. */
export async function secretFor(provider: Exclude<CaptchaProvider, 'none'>, typed?: string) {
  if (typed) return typed
  const settings = await loadCaptchaSettings()
  return provider === 'recaptcha' ? settings.recaptchaSecret : settings.turnstileSecret
}
