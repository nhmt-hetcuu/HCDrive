import { Router } from 'express'
import { google } from 'googleapis'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import Busboy from 'busboy'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { isAdminUser } from '../../middleware/admin.middleware.js'
import { hashPassword, verifyPassword } from '../../utils/password.js'
import { encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { signAccessToken } from '../../utils/jwt.js'
import { createAuditLog } from '../../utils/audit.js'
import { clientIp, limiters } from '../../middleware/rate-limit.js'
import { publicCaptchaConfig, verifyCaptcha } from '../../utils/captcha.js'
import { isRegistrationAllowed } from '../../utils/registration.js'
import { GOOGLE_LINK_SCOPES, linkGoogleIdentity, parkGoogleLink, resolveGoogleLoginUser, takeGoogleLink } from '../../utils/google-identity.js'
import { createOAuthClient, syncGoogleQuota, getRcloneConfig, getCustomConfig } from '../google/google.service.js'

export const authRouter = Router()

function getAvatarsDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'avatars')
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  }
  return dir
}

const registerSchema = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), captchaToken: z.string().optional() })
const loginSchema = z.object({ email: z.string().min(1), password: z.string().min(1), captchaToken: z.string().max(4096).optional() })
const refreshSchema = z.object({ refreshToken: z.string().min(1) })
const googleExchangeSchema = z.object({ token: z.string().min(1) })

// The browser's own id (see getDeviceId in the frontend); ignored unless it looks like one.
function deviceIdOf(req: AuthRequest) {
  const id = req.header('X-Device-Id')
  return id && /^[a-f0-9]{32}$/.test(id) ? id : null
}

async function createSession(userId: string, req: AuthRequest) {
  const refreshToken = randomToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const deviceId = deviceIdOf(req)
  // Signing in again from the same browser replaces its old session, so the session list shows one row per browser.
  if (deviceId) {
    await prisma.userSession.updateMany({ where: { userId, deviceId, revokedAt: null }, data: { revokedAt: new Date() } })
  }
  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: req.header('User-Agent'),
      ipAddress: req.ip,
      deviceId,
      expiresAt,
    },
  })
  return { accessToken: signAccessToken({ sub: userId, sid: session.id }), refreshToken }
}


authRouter.get('/config', async (_req, res, next) => {
  try {
    const [allowRegistration, captcha] = await Promise.all([isRegistrationAllowed(), publicCaptchaConfig()])
    return res.json({ allowRegistration, captcha })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/register', limiters.register, async (req, res, next) => {
  try {
    if (!(await isRegistrationAllowed())) {
      return res.status(403).json({
        code: 'REGISTRATION_DISABLED',
        message: 'Chức năng đăng ký tài khoản mới hiện đang bị tắt bởi quản trị viên.'
      })
    }

    const body = registerSchema.parse(req.body)
    if (!(await verifyCaptcha('register', body.captchaToken, clientIp(req)))) return res.status(400).json({ code: 'CAPTCHA_FAILED', message: 'Xác minh captcha không thành công. Thử lại.' })
    const existing = await prisma.user.findUnique({ where: { email: body.email } })
    if (existing) return res.status(409).json({ code: 'AUTH_EMAIL_TAKEN', message: 'Email already registered.' })
    const user = await prisma.user.create({ data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password) } })
    const tokens = await createSession(user.id, req)
    return res.status(201).json({ ...tokens, user: { id: user.id, name: user.name, email: user.email, hasPassword: true } })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/login', limiters.loginPerIp, limiters.loginPerAccount, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body)
    if (!(await verifyCaptcha('login', body.captchaToken, clientIp(req)))) return res.status(400).json({ code: 'CAPTCHA_FAILED', message: 'Xác minh captcha không thành công. Thử lại.' })
    const loginInput = body.email.trim()
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: loginInput.toLowerCase() },
          { name: loginInput },
        ],
      },
    })
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) return res.status(401).json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password.' })
    if (user.status !== 'active') {
      return res.status(403).json({ code: 'ACCOUNT_DISABLED', message: 'Tài khoản của bạn đã bị vô hiệu hoá bởi quản trị viên.' })
    }
    const tokens = await createSession(user.id, req)
    return res.json({ ...tokens, user: { id: user.id, name: user.name, email: user.email, hasPassword: user.hasPassword } })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/google/methods', async (_req, res, next) => {
  try {
    const customConfig = await getCustomConfig()
    return res.json({
      hasCustom: Boolean(customConfig),
      defaultMethod: customConfig ? 'custom' : 'rclone',
    })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/google/url', async (req, res, next) => {
  try {
    const query = z.object({ method: z.enum(['rclone', 'custom']).optional() }).parse(req.query)
    let config
    if (query.method === 'custom') {
      config = await getCustomConfig()
      if (!config) return res.status(400).json({ code: 'CONFIG_NOT_FOUND', message: 'Chưa cấu hình Google OAuth cá nhân.' })
    } else {
      config = await getRcloneConfig()
    }

    const state = randomToken()
    await prisma.oauthState.create({ data: { providerConfigId: config.id, flow: 'login', stateHash: hashToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const client = createOAuthClient(config)
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: config.scopes as string[],
      state,
    })
    return res.json({ url })
  } catch (error) {
    return next(error)
  }
})

// Starts linking a Google account to the signed-in user, so it can be used on the sign-in page.
// Asks only for the Google profile (no Drive access); the callback is the shared OAuth redirect.
authRouter.get('/google/link-url', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ method: z.enum(['rclone', 'custom']).optional() }).parse(req.query)
    const custom = await getCustomConfig()
    const config = query.method === 'rclone' || !custom ? await getRcloneConfig() : custom
    const state = randomToken()
    await prisma.oauthState.create({ data: { userId: req.user!.id, providerConfigId: config.id, flow: 'link', stateHash: hashToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const url = createOAuthClient(config).generateAuthUrl({ prompt: 'select_account', scope: GOOGLE_LINK_SCOPES, state })
    return res.json({ url })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/google/callback', async (req, res) => {
  try {
    const query = z.object({ code: z.string(), state: z.string() }).parse(req.query)
    const oauthState = await prisma.oauthState.findUniqueOrThrow({ where: { stateHash: hashToken(query.state) }, include: { providerConfig: true } })
    if ((oauthState.flow !== 'login' && oauthState.flow !== 'link') || oauthState.usedAt || oauthState.expiresAt < new Date()) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)

    const client = createOAuthClient(oauthState.providerConfig)
    const tokenResult = await client.getToken(query.code)
    const tokens = tokenResult.tokens
    if (!tokens.access_token) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
    client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const profile = await oauth2.userinfo.get()
    const providerAccountId = profile.data.id
    const email = profile.data.email
    if (!providerAccountId || !email) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)

    if (oauthState.flow === 'link') {
      await prisma.oauthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date() } })
      if (!oauthState.userId) return res.redirect(`${env.FRONTEND_URL}/settings?tab=profile&googleLink=error`)
      const linkToken = parkGoogleLink(oauthState.userId, { id: providerAccountId, email, name: profile.data.name, picture: profile.data.picture })
      return res.redirect(`${env.FRONTEND_URL}/settings?tab=profile&googleLinkToken=${linkToken}`)
    }

    const user = await resolveGoogleLoginUser({ id: providerAccountId, email, name: profile.data.name, picture: profile.data.picture })
    if (!user) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
    const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId } } })
    const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existingAccount?.refreshTokenEncrypted
    if (!refreshTokenEncrypted) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)

    const account = await prisma.connectedAccount.upsert({
      where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId } },
      create: {
        userId: user.id,
        providerConfigId: oauthState.providerConfigId,
        provider: 'google_drive',
        providerAccountId,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(tokens.access_token),
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        scopes: oauthState.providerConfig.scopes as string[],
        status: 'connected',
        connectedVia: 'login',
      },
      update: {
        providerConfigId: oauthState.providerConfigId,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(tokens.access_token),
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        scopes: oauthState.providerConfig.scopes as string[],
        status: 'connected',
        connectedVia: 'login',
      },
    })

    await prisma.oauthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date(), userId: user.id } })
    await syncGoogleQuota(account.id).catch(() => undefined)

    const handoffToken = randomToken()
    await prisma.authHandoff.create({ data: { userId: user.id, tokenHash: hashToken(handoffToken), expiresAt: new Date(Date.now() + 5 * 60_000) } })
    return res.redirect(`${env.FRONTEND_URL}/google-auth?token=${handoffToken}`)
  } catch (error) {
    console.error('Google Auth callback failed:', error)
    return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
  }
})

authRouter.post('/google/exchange', limiters.refresh, async (req, res, next) => {
  try {
    const body = googleExchangeSchema.parse(req.body)
    const handoff = await prisma.authHandoff.findFirst({ where: { tokenHash: hashToken(body.token), usedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } })
    if (!handoff) return res.status(401).json({ code: 'AUTH_GOOGLE_HANDOFF_INVALID', message: 'Google login session expired.' })
    await prisma.authHandoff.update({ where: { id: handoff.id }, data: { usedAt: new Date() } })
    const tokens = await createSession(handoff.userId, req)
    return res.json({ ...tokens, user: { id: handoff.user.id, name: handoff.user.name, email: handoff.user.email } })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/refresh', limiters.refresh, async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body)
    const session = await prisma.userSession.findFirst({ where: { refreshTokenHash: hashToken(body.refreshToken), revokedAt: null, expiresAt: { gt: new Date() } } })
    if (!session) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Refresh token expired.' })
    // Each refresh bumps updatedAt, which the session list shows as "last active".
    // Sessions from before device ids existed pick theirs up here, so the next sign-in from that browser replaces them.
    const deviceId = session.deviceId ?? deviceIdOf(req)
    await prisma.userSession.update({ where: { id: session.id }, data: { ipAddress: req.ip, userAgent: req.header('User-Agent') ?? session.userAgent, deviceId } })
    return res.json({ accessToken: signAccessToken({ sub: session.userId, sid: session.id }) })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/logout', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await prisma.userSession.update({ where: { id: req.user!.sessionId }, data: { revokedAt: new Date() } })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

// Browsers and devices signed in to this account. requireAuth rejects a revoked session on its next
// request, so revoking one signs that browser out right away (not only when its access token expires).
authRouter.get('/sessions', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const sessions = await prisma.userSession.findMany({
      where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, updatedAt: true },
    })
    return res.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.updatedAt.toISOString(),
        current: session.id === req.user!.sessionId,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

authRouter.delete('/sessions/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const sessionId = String(req.params.id)
    if (sessionId === req.user!.sessionId) {
      return res.status(400).json({ code: 'CANNOT_REVOKE_CURRENT_SESSION', message: 'Dùng Đăng xuất để thoát phiên hiện tại.' })
    }
    const result = await prisma.userSession.updateMany({
      where: { id: sessionId, userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (result.count === 0) return res.status(404).json({ code: 'SESSION_NOT_FOUND', message: 'Phiên đăng nhập không tồn tại hoặc đã kết thúc.' })
    await createAuditLog(req.user!.id, 'SESSION_REVOKE', 'session', sessionId)
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/sessions/revoke-others', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await revokeOtherSessions(req.user!.id, req.user!.sessionId)
    await createAuditLog(req.user!.id, 'SESSION_REVOKE_OTHERS', 'session', req.user!.sessionId, { count: result.count })
    return res.json({ status: 'ok', revoked: result.count })
  } catch (error) {
    return next(error)
  }
})

function revokeOtherSessions(userId: string, currentSessionId: string) {
  return prisma.userSession.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: new Date() },
  })
}

// Google accounts that can sign in to this user. One whose Gmail is the HCDrive email signs in by
// email match anyway, and the last way in of a user without a password must stay, so neither can be removed.
authRouter.get('/identities', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { email: true, hasPassword: true, identities: { orderBy: { createdAt: 'asc' } } } })
    return res.json({
      hasPassword: user.hasPassword,
      identities: user.identities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        createdAt: identity.createdAt,
        lastLoginAt: identity.lastLoginAt,
        isAccountEmail: identity.email.toLowerCase() === user.email.toLowerCase(),
        canUnlink: identity.email.toLowerCase() !== user.email.toLowerCase() && (user.hasPassword || user.identities.length > 1),
      })),
    })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/google/link/confirm', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ token: z.string().min(1) }).parse(req.body)
    const profile = takeGoogleLink(body.token, req.user!.id)
    if (!profile) return res.status(400).json({ code: 'GOOGLE_LINK_EXPIRED', message: 'Phiên liên kết Google đã hết hạn, hãy thử lại.' })
    const result = await linkGoogleIdentity(req.user!.id, profile)
    if (result === 'linked_other') return res.status(409).json({ code: 'GOOGLE_LINKED_OTHER', message: `Tài khoản Google ${profile.email} đã liên kết với một tài khoản HCDrive khác.` })
    if (result === 'email_taken') return res.status(409).json({ code: 'GOOGLE_EMAIL_TAKEN', message: `${profile.email} là email của một tài khoản HCDrive khác, không thể liên kết.` })
    await createAuditLog(req.user!.id, 'GOOGLE_LOGIN_LINK', 'user', req.user!.id, { email: profile.email })
    return res.json({ status: 'ok', email: profile.email })
  } catch (error) {
    return next(error)
  }
})

authRouter.delete('/identities/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { email: true, hasPassword: true, identities: true } })
    const identity = user.identities.find((item) => item.id === String(req.params.id))
    if (!identity) return res.status(404).json({ code: 'IDENTITY_NOT_FOUND', message: 'Không tìm thấy liên kết.' })
    if (identity.email.toLowerCase() === user.email.toLowerCase()) {
      return res.status(400).json({ code: 'IDENTITY_IS_ACCOUNT_EMAIL', message: 'Gmail này trùng email tài khoản nên luôn đăng nhập được bằng Google.' })
    }
    if (!user.hasPassword && user.identities.length <= 1) {
      return res.status(400).json({ code: 'IDENTITY_LAST_LOGIN', message: 'Đây là cách đăng nhập duy nhất của tài khoản, không thể gỡ.' })
    }
    await prisma.userIdentity.delete({ where: { id: identity.id } })
    await createAuditLog(req.user!.id, 'GOOGLE_LOGIN_UNLINK', 'user', req.user!.id, { email: identity.email })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, avatarUrl: true, status: true, hasPassword: true, convertUploads: true } })
    const isAdmin = await isAdminUser(user.id)
    return res.json({ user: { ...user, isAdmin } })
  } catch (error) {
    return next(error)
  }
})

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email('Địa chỉ email không hợp lệ').toLowerCase().optional(),
  avatarUrl: z.string().trim().nullable().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).optional(),
  convertUploads: z.boolean().optional(),
})

authRouter.patch('/me', requireAuth, limiters.passwordCheck, async (req: AuthRequest, res, next) => {
  try {
    const body = updateProfileSchema.parse(req.body)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } })

    let newEmail: string | undefined
    if (body.email && body.email.toLowerCase() !== user.email.toLowerCase()) {
      newEmail = body.email.toLowerCase()
      // Check if email already used by another account
      const conflict = await prisma.user.findFirst({
        where: {
          email: newEmail,
          id: { not: user.id },
        },
      })
      if (conflict) {
        return res.status(409).json({
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Địa chỉ email này đã được sử dụng bởi một tài khoản khác.',
        })
      }

      // If user has a password set, require current password verification to protect account
      if (user.hasPassword) {
        if (!body.currentPassword || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
          return res.status(400).json({
            code: 'INVALID_CURRENT_PASSWORD',
            message: 'Mật khẩu hiện tại không chính xác để đổi email.',
          })
        }
      }
    }

    let passwordHash: string | undefined
    if (body.newPassword) {
      // If user has a password, require current password
      if (user.hasPassword) {
        if (!body.currentPassword || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
          return res.status(400).json({ code: 'INVALID_CURRENT_PASSWORD', message: 'Mật khẩu hiện tại không chính xác.' })
        }
      }
      passwordHash = await hashPassword(body.newPassword)
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(newEmail ? { email: newEmail } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl || null } : {}),
        ...(passwordHash ? { passwordHash, hasPassword: true } : {}),
        ...(body.convertUploads !== undefined ? { convertUploads: body.convertUploads } : {}),
      },
      select: { id: true, name: true, email: true, avatarUrl: true, status: true, hasPassword: true, convertUploads: true }
    })

    if (newEmail) {
      await createAuditLog(user.id, 'USER_EMAIL_CHANGED', 'user', user.id, {
        oldEmail: user.email,
        newEmail,
      })
    }

    // A new password signs out every other browser, so someone who knew the old one loses access.
    if (passwordHash) await revokeOtherSessions(user.id, req.user!.sessionId)

    const isAdmin = await isAdminUser(updated.id)
    return res.json({ user: { ...updated, isAdmin } })
  } catch (error) {
    return next(error)
  }
})

// Public endpoint to serve avatar directly from server local disk
authRouter.get('/avatar/:userId', (req, res, next) => {
  try {
    const cleanUserId = String(req.params.userId).replace(/[^a-zA-Z0-9_-]/g, '')
    const dir = getAvatarsDir()

    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }

    for (const [ext, mime] of Object.entries(mimeMap)) {
      const filePath = path.join(dir, `${cleanUserId}${ext}`)
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', mime)
        res.setHeader('Cache-Control', 'public, max-age=86400')
        return fs.createReadStream(filePath).pipe(res)
      }
    }

    return res.status(404).json({ code: 'AVATAR_NOT_FOUND', message: 'No avatar found' })
  } catch (error) {
    return next(error)
  }
})

// Upload avatar directly to server local disk (no cloud)
authRouter.post('/avatar', requireAuth, (req: AuthRequest, res, next) => {
  try {
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'multipart/form-data required.' })
    }

    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 5 * 1024 * 1024 } })
    let fileUploaded = false

    busboy.on('file', (name, fileStream, info) => {
      const mime = info.mimeType?.toLowerCase() || ''
      const extMap: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
      }
      const ext = extMap[mime]
      if (!ext) {
        fileStream.resume()
        return res.status(400).json({ code: 'INVALID_IMAGE_TYPE', message: 'Only PNG, JPG, WEBP, and GIF images are supported.' })
      }

      fileUploaded = true
      const dir = getAvatarsDir()
      const cleanUserId = req.user!.id.replace(/[^a-zA-Z0-9_-]/g, '')

      // Clean up previous avatar files
      for (const e of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
        const oldFile = path.join(dir, `${cleanUserId}${e}`)
        if (fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile) } catch {}
        }
      }

      const targetPath = path.join(dir, `${cleanUserId}${ext}`)
      const writeStream = fs.createWriteStream(targetPath)

      fileStream.pipe(writeStream)

      writeStream.on('finish', async () => {
        try {
          const avatarUrl = `/auth/avatar/${cleanUserId}?t=${Date.now()}`
          const updated = await prisma.user.update({
            where: { id: req.user!.id },
            data: { avatarUrl },
            select: { id: true, name: true, email: true, avatarUrl: true, status: true },
          })
          const isAdmin = await isAdminUser(updated.id)
          return res.json({ status: 'ok', avatarUrl, user: { ...updated, isAdmin } })
        } catch (err) {
          next(err)
        }
      })

      writeStream.on('error', (err) => {
        next(err)
      })
    })

    busboy.on('finish', () => {
      if (!fileUploaded && !res.headersSent) {
        return res.status(400).json({ code: 'FILE_REQUIRED', message: 'No image file uploaded.' })
      }
    })

    busboy.on('error', (err) => {
      if (!res.headersSent) next(err)
    })

    req.pipe(busboy)
  } catch (error) {
    return next(error)
  }
})

// Delete custom avatar from local server disk
authRouter.delete('/avatar', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const dir = getAvatarsDir()
    const cleanUserId = req.user!.id.replace(/[^a-zA-Z0-9_-]/g, '')
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
      const filePath = path.join(dir, `${cleanUserId}${ext}`)
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath) } catch {}
      }
    }
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarUrl: null },
      select: { id: true, name: true, email: true, avatarUrl: true, status: true },
    })
    const isAdmin = await isAdminUser(updated.id)
    return res.json({ status: 'ok', user: { ...updated, isAdmin } })
  } catch (error) {
    return next(error)
  }
})
