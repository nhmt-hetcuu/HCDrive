import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { clientIp } from '../../middleware/rate-limit.js'
import { adminCaptchaSettings, checkCaptchaKeys, loadCaptchaSettings, saveCaptchaSettings, secretFor } from '../../utils/captcha.js'
import { proxyMode, proxySightings, resolveClientIp, saveProxyMode } from '../../utils/client-ip.js'

// Settings → Security (admin only; mounted inside systemRouter, which checks that).

export const securityRouter = Router()

securityRouter.get('/captcha', async (_req, res, next) => {
  try {
    return res.json(await adminCaptchaSettings())
  } catch (error) {
    return next(error)
  }
})

const captchaSchema = z.object({
  provider: z.enum(['none', 'recaptcha', 'turnstile']),
  recaptchaSiteKey: z.string().trim().max(200).optional(),
  recaptchaSecret: z.string().trim().max(200).optional(),
  turnstileSiteKey: z.string().trim().max(200).optional(),
  turnstileSecret: z.string().trim().max(200).optional(),
  onRegister: z.boolean(),
  onLogin: z.boolean(),
  /** Token from the widget the admin solved with the new keys (needed when the keys change). */
  testToken: z.string().max(4096).optional(),
})

securityRouter.put('/captcha', async (req, res, next) => {
  try {
    const body = captchaSchema.parse(req.body)
    if (body.provider !== 'none') {
      const current = await loadCaptchaSettings()
      const siteKey = (body.provider === 'recaptcha' ? body.recaptchaSiteKey : body.turnstileSiteKey) ?? ''
      const typedSecret = body.provider === 'recaptcha' ? body.recaptchaSecret : body.turnstileSecret
      const secret = await secretFor(body.provider, typedSecret)
      if (!siteKey) return res.status(400).json({ code: 'CAPTCHA_SITE_KEY_REQUIRED', message: 'Nhập Site key.' })
      if (!secret) return res.status(400).json({ code: 'CAPTCHA_SECRET_REQUIRED', message: 'Nhập Secret key.' })

      const storedSiteKey = body.provider === 'recaptcha' ? current.recaptchaSiteKey : current.turnstileSiteKey
      const keysChanged = body.provider !== current.provider || siteKey !== storedSiteKey || Boolean(typedSecret)
      if (keysChanged) {
        if (!body.testToken) return res.status(400).json({ code: 'CAPTCHA_TEST_REQUIRED', message: 'Giải captcha thử bên dưới trước khi lưu, để chắc chắn cặp khoá đúng.' })
        const check = await checkCaptchaKeys(body.provider, secret, body.testToken, clientIp(req))
        if (!check.ok) {
          const message = check.reason === 'secret'
            ? 'Secret key không đúng (hoặc không khớp với Site key).'
            : check.reason === 'network'
              ? `Không gọi được máy chủ xác minh captcha: ${check.codes.join(', ')}`
              : `Captcha thử không hợp lệ (${check.codes.join(', ') || 'unknown'}). Giải lại rồi lưu.`
          return res.status(400).json({ code: 'CAPTCHA_TEST_FAILED', message })
        }
      }
    }
    await saveCaptchaSettings(body)
    return res.json(await adminCaptchaSettings())
  } catch (error) {
    return next(error)
  }
})

securityRouter.get('/network', (req, res) => {
  const header = (name: string) => req.header(name)
  const resolved = resolveClientIp(req.socket.remoteAddress, header)
  const seen = proxySightings()
  const ago = (at: number) => (at ? Math.round((Date.now() - at) / 1000) : null)
  return res.json({
    mode: proxyMode(),
    envTrustProxy: env.TRUST_PROXY?.trim() || null,
    clientIp: clientIp(req),
    detected: resolved,
    request: {
      peer: req.socket.remoteAddress ?? null,
      host: req.header('host') ?? null,
      forwardedFor: req.header('x-forwarded-for') ?? null,
      realIp: req.header('x-real-ip') ?? null,
      cfConnectingIp: req.header('cf-connecting-ip') ?? null,
      cfRay: req.header('cf-ray') ?? null,
      forwardedProto: req.header('x-forwarded-proto') ?? null,
    },
    seenSecondsAgo: { cloudflare: ago(seen.cloudflareAt), proxy: ago(seen.proxyAt), direct: ago(seen.directAt) },
  })
})

securityRouter.put('/network', async (req, res, next) => {
  try {
    const { mode } = z.object({ mode: z.enum(['auto', 'off']) }).parse(req.body)
    if (env.TRUST_PROXY?.trim()) return res.status(409).json({ code: 'SET_BY_ENV', message: 'TRUST_PROXY đang được đặt trong biến môi trường; xoá nó đi để chỉnh ở đây.' })
    await saveProxyMode(mode)
    return res.json({ mode })
  } catch (error) {
    return next(error)
  }
})
