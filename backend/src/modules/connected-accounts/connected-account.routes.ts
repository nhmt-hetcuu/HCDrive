import { Router } from 'express'
import { google } from 'googleapis'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { isAdminUser } from '../../middleware/admin.middleware.js'
import { decryptText, encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { parkGoogleLink, resolveGoogleLoginUser } from '../../utils/google-identity.js'
import { RCLONE_CLIENT_ID, createOAuthClient, syncGoogleQuota, getRcloneConfig, getCustomConfig, syncGoogleAppFolderFiles, listGoogleDriveItems, createGoogleDriveFolder, deleteGoogleDriveItem, getAccountCookie } from '../google/google.service.js'
import { syncS3Quota, testS3Connection } from '../s3/s3.service.js'
import { mountAccountTransferRoutes } from './account-transfer.js'
import { mountAccountDriveRoutes } from '../google/drive-features.js'
import { getAccountProxyUrl, maskProxyUrl, testProxyConnectivity, SUPPORTED_PROXY_PROTOCOLS } from '../../utils/proxy.js'

export const connectedAccountRouter = Router()

const s3ConnectSchema = z.object({
  name: z.string().trim().min(1).max(191),
  bucket: z.string().trim().min(1).max(191),
  region: z.string().trim().min(1).max(191),
  endpoint: z.string().url().optional().or(z.literal('')),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().optional(),
  quotaBytes: z.string().regex(/^\d+$/).optional().nullable(),
})

export async function verifyGoogleCookie(cookie: string): Promise<{ valid: boolean; email?: string | null; error?: string }> {
  let cleanCookie = cookie.trim()
  if (cleanCookie.toLowerCase().startsWith('cookie:')) cleanCookie = cleanCookie.slice(7).trim()
  if ((cleanCookie.startsWith('"') && cleanCookie.endsWith('"')) || (cleanCookie.startsWith("'") && cleanCookie.endsWith("'"))) {
    cleanCookie = cleanCookie.slice(1, -1).trim()
  }

  const hasGoogleSession = cleanCookie.includes('SID=') || cleanCookie.includes('HSID=') || cleanCookie.includes('SSID=') || cleanCookie.includes('SAPISID=') || cleanCookie.includes('OSID=')

  try {
    const res = await fetch('https://drive.google.com/drive/my-drive', {
      headers: {
        'Cookie': cleanCookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://drive.google.com/',
      },
      redirect: 'manual',
    })

    const location = res.headers.get('location') || ''
    if (res.status === 302 || res.status === 301 || res.status === 303) {
      if (location.includes('accounts.google.com') || location.includes('ServiceLogin')) {
        return { valid: false, error: 'Cookie đã hết hạn hoặc không có phiên đăng nhập Google Drive hợp lệ.' }
      }
    }

    if (res.status === 200) {
      const html = await res.text()
      if (html.includes('Sign in - Google Accounts') || html.includes('Đăng nhập - Tài khoản Google')) {
        return { valid: false, error: 'Cookie đã hết hạn hoặc không có phiên đăng nhập Google Drive hợp lệ.' }
      }

      let detectedEmail: string | null = null
      const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)
      if (emailMatches) {
        const userEmails = emailMatches.filter((e) => {
          const lower = e.toLowerCase()
          return !lower.endsWith('@google.com') && !lower.endsWith('example.com') && !lower.includes('support') && !lower.includes('feedback') && !lower.includes('w3.org')
        })
        if (userEmails.length > 0) detectedEmail = userEmails[0]
      }

      return { valid: true, email: detectedEmail }
    }

    if (hasGoogleSession) {
      return { valid: true }
    }

    return { valid: false, error: `Google Drive trả về mã HTTP ${res.status}. Không thể xác thực cookie.` }
  } catch (err: any) {
    if (hasGoogleSession) {
      return { valid: true }
    }
    return { valid: false, error: `Lỗi kết nối tới Google Drive: ${err?.message || err}` }
  }
}

async function syncCookieQuota(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  const cookie = await getAccountCookie(account)
  if (!cookie) {
    await prisma.connectedAccount.update({ where: { id: accountId }, data: { lastError: 'Chưa cấu hình Cookie' } })
  } else {
    const verification = await verifyGoogleCookie(cookie)
    if (!verification.valid) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { lastError: verification.error || 'Cookie đã hết hạn hoặc không hợp lệ' },
      })
    } else {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { lastError: null },
      })
    }
  }
  return prisma.storageAccount.upsert({
    where: { connectedAccountId: accountId },
    create: {
      connectedAccountId: accountId,
      totalBytes: 15n * 1024n * 1024n * 1024n,
      usedBytes: 0n,
      availableBytes: 15n * 1024n * 1024n * 1024n,
      lastSyncedAt: new Date(),
    },
    update: {
      lastSyncedAt: new Date(),
    },
  })
}

async function syncQuotaForAccount(account: { id: string; provider: string; connectedVia?: string | null }) {
  if (account.provider === 's3') return syncS3Quota(account.id)
  if (account.connectedVia === 'cookie') return syncCookieQuota(account.id)
  return syncGoogleQuota(account.id)
}

async function assertCanConnectStorage(userId: string) {
  const isAdmin = await isAdminUser(userId)
  if (isAdmin) return true
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'allow_user_drive_connect' } })
  if (setting?.value === 'true') return true
  throw new Error('Chức năng thêm tài khoản lưu trữ bị giới hạn: Chỉ Quản trị viên (Admin) mới có quyền kết nối hoặc quản lý Google Drive / S3.')
}

// POST /export and /import: storage accounts as one JSON file (see account-transfer.ts).
mountAccountTransferRoutes(connectedAccountRouter, assertCanConnectStorage)
// POST /:id/empty-trash and /:id/drive-items/upload (see drive-features.ts).
mountAccountDriveRoutes(connectedAccountRouter, requireAuth)

connectedAccountRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const isAdmin = await isAdminUser(req.user!.id)
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        OR: [
          { userId: req.user!.id },
          { isShared: true },
        ],
        status: 'connected',
      },
      include: { storageAccount: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const missingQuota = accounts.filter((account) => !account.storageAccount?.lastSyncedAt)
    for (const account of missingQuota) await syncQuotaForAccount(account).catch(() => undefined)

    const syncedAccounts = missingQuota.length > 0
      ? await prisma.connectedAccount.findMany({
        where: {
          OR: [
            { userId: req.user!.id },
            { isShared: true },
          ],
          status: 'connected',
        },
        include: { storageAccount: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      })
      : accounts

    const setting = await prisma.systemSetting.findUnique({ where: { key: 'allow_user_drive_connect' } })
    const allowUserConnect = setting?.value === 'true'

    return res.json({
      canConnectStorage: isAdmin || allowUserConnect,
      accounts: syncedAccounts.map(({ accessTokenEncrypted: _a, refreshTokenEncrypted: _r, proxyUrlEncrypted, cookieEncrypted, storageAccount, user, ...account }) => ({
        ...account,
        isShared: account.isShared,
        isOwner: account.userId === req.user!.id,
        ownerEmail: user?.email,
        hasProxy: Boolean(proxyUrlEncrypted),
        proxyUrl: maskProxyUrl(getAccountProxyUrl({ proxyUrlEncrypted })),
        hasCookie: Boolean(cookieEncrypted),
        storageAccount: storageAccount ? {
          ...storageAccount,
          totalBytes: storageAccount.totalBytes?.toString() ?? null,
          usedBytes: storageAccount.usedBytes.toString(),
          availableBytes: storageAccount.availableBytes?.toString() ?? null,
          trashBytes: storageAccount.trashBytes?.toString() ?? null,
        } : null,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

// Everything about one storage account for its details dialog: how it was connected, the OAuth
// client and scopes, token state, proxy, S3 target, quota and what HCDrive keeps on it. Accounts
// shared by someone else show only the general part; proxy, scopes and S3 keys stay with the owner.
connectedAccountRouter.get('/:id/details', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id
    const isAdmin = await isAdminUser(userId)
    const account = await prisma.connectedAccount.findFirst({
      where: { id: String(req.params.id), OR: [{ userId }, { isShared: true }] },
      include: {
        storageAccount: true,
        s3StorageConfig: true,
        providerConfig: true,
        user: { select: { id: true, name: true, email: true, identities: { where: { provider: 'google' }, select: { providerSubject: true } } } },
      },
    })
    if (!account) return res.status(404).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Không tìm thấy tài khoản lưu trữ.' })
    const isOwner = account.userId === userId
    const canSeePrivate = isOwner || isAdmin

    // Counted per Drive file: rows doubled before the sync merged them must not add up twice.
    const [fileRows, folderCount] = await Promise.all([
      prisma.file.findMany({ where: { connectedAccountId: account.id, status: 'active' }, select: { providerFileId: true, sizeBytes: true } }),
      prisma.folder.count({ where: { connectedAccountId: account.id, deletedAt: null } }),
    ])
    const sizeByDriveId = new Map<string, bigint>()
    for (const row of fileRows) sizeByDriveId.set(row.providerFileId, row.sizeBytes)
    let fileBytes = 0n
    for (const size of sizeByDriveId.values()) fileBytes += size

    let oauthClient: { kind: 'rclone' | 'custom'; clientId: string | null } | null = null
    if (account.provider === 'google_drive' && account.providerConfig) {
      let clientId: string | null = null
      try { clientId = decryptText(account.providerConfig.clientIdEncrypted) } catch {}
      const kind = clientId === RCLONE_CLIENT_ID ? 'rclone' : 'custom'
      oauthClient = { kind, clientId: clientId && clientId.length > 25 ? `${clientId.slice(0, 12)}...${clientId.slice(-15)}` : clientId }
    }

    let s3: Record<string, unknown> | null = null
    if (account.s3StorageConfig) {
      const config = account.s3StorageConfig
      let accessKeyId: string | null = null
      if (canSeePrivate) {
        try {
          const raw = decryptText(config.accessKeyIdEncrypted)
          accessKeyId = raw.length > 8 ? `${raw.slice(0, 4)}…${raw.slice(-4)}` : '***'
        } catch {}
      }
      s3 = {
        name: config.name,
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
        prefix: config.prefix,
        forcePathStyle: config.forcePathStyle,
        quotaBytes: config.quotaBytes?.toString() ?? null,
        accessKeyId,
      }
    }

    const storage = account.storageAccount
    return res.json({
      id: account.id,
      provider: account.provider,
      email: account.email,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      providerAccountId: account.providerAccountId,
      status: account.status,
      lastError: account.lastError,
      connectedVia: account.connectedVia,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      isShared: account.isShared,
      isOwner,
      owner: { name: account.user.name, email: account.user.email },
      // The owner can also sign in to HCDrive with this Google account.
      usedForLogin: account.provider === 'google_drive' && account.user.identities.some((identity) => identity.providerSubject === account.providerAccountId),
      oauthClient: canSeePrivate ? oauthClient : oauthClient && { kind: oauthClient.kind, clientId: null },
      // The rclone client shares Google's per-minute limit with every rclone user; the dialog offers
      // a reconnect with the installation's own client when one is configured.
      customOAuthAvailable: oauthClient?.kind === 'rclone' ? Boolean(await getCustomConfig()) : undefined,
      scopes: canSeePrivate && account.provider === 'google_drive' ? account.scopes : null,
      token: account.provider === 'google_drive' ? {
        hasRefreshToken: Boolean(account.refreshTokenEncrypted),
        accessTokenExpiresAt: account.tokenExpiresAt,
      } : null,
      proxyUrl: canSeePrivate ? maskProxyUrl(getAccountProxyUrl(account)) : null,
      hasProxy: Boolean(account.proxyUrlEncrypted),
      hasCookie: Boolean(account.cookieEncrypted),
      s3,
      storage: storage ? {
        totalBytes: storage.totalBytes?.toString() ?? null,
        usedBytes: storage.usedBytes.toString(),
        availableBytes: storage.availableBytes?.toString() ?? null,
        trashBytes: storage.trashBytes?.toString() ?? null,
        lastSyncedAt: storage.lastSyncedAt,
      } : null,
      hcdrive: {
        fileCount: sizeByDriveId.size,
        fileBytes: fileBytes.toString(),
        duplicateRows: fileRows.length - sizeByDriveId.size,
        folderCount,
      },
    })
  } catch (error) {
    return next(error)
  }
})

async function createGoogleConnectUrl(req: AuthRequest) {
  await assertCanConnectStorage(req.user!.id)
  const query = z.object({
    method: z.enum(['rclone', 'custom']).optional(),
    providerConfigId: z.string().min(1).optional()
  }).parse(req.query)

  let config
  if (query.providerConfigId) {
    config = await prisma.providerConfig.findFirstOrThrow({ where: { id: query.providerConfigId, OR: [{ userId: req.user!.id }, { userId: null }], provider: 'google_drive', status: 'active' } })
  } else if (query.method === 'custom') {
    const custom = await getCustomConfig()
    if (!custom) throw new Error('Chưa cấu hình Google OAuth cá nhân trong Settings.')
    config = custom
  } else {
    config = await getRcloneConfig()
  }

  const state = randomToken()
  await prisma.oauthState.create({ data: { userId: req.user!.id, providerConfigId: config.id, flow: 'connect', stateHash: hashToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) } })
  const client = createOAuthClient(config)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: config.scopes as string[],
    state,
  })
}

connectedAccountRouter.get('/google/auth-methods', requireAuth, async (_req: AuthRequest, res, next) => {
  try {
    const customConfig = await getCustomConfig()
    let customClientId: string | null = null
    if (customConfig) {
      try {
        const raw = decryptText(customConfig.clientIdEncrypted)
        customClientId = raw.length > 25 ? `${raw.slice(0, 12)}...${raw.slice(-15)}` : raw
      } catch {}
    }

    return res.json({
      hasCustom: Boolean(customConfig),
      customClientId,
      defaultMethod: customConfig ? 'custom' : 'rclone',
      methods: [
        {
          id: 'rclone',
          name: 'Rclone Desktop OAuth (Google Verified)',
          description: 'Sử dụng OAuth Client ID chính thức đã được Google verify, không cần tạo app trên Google Cloud, không lo hết hạn 7 ngày.',
          badge: 'Khuyên dùng',
          available: true,
        },
        {
          id: 'custom',
          name: 'Google OAuth cá nhân (Custom App)',
          description: customConfig
            ? `Sử dụng Client ID cá nhân bạn đã thêm (${customClientId})`
            : 'Chưa cấu hình trong Settings (Cần thêm Client ID & Secret trước khi dùng).',
          badge: customConfig ? 'Đã cấu hình' : 'Chưa cấu hình',
          available: Boolean(customConfig),
        },
        {
          id: 'cookie',
          name: 'Cookie Google Drive (Session Cookie)',
          description: 'Kết nối trực tiếp bằng Cookie phiên đăng nhập, hỗ trợ xem và stream video/tệp bảo vệ quyền riêng tư mà không cần cấp quyền OAuth.',
          badge: 'Bypass riêng tư',
          available: true,
        }
      ]
    })
  } catch (error) {
    return next(error)
  }
})

const googleCookieConnectSchema = z.object({
  cookie: z.string().trim().min(10, 'Cookie không được để trống'),
  email: z.string().trim().optional().nullable(),
  displayName: z.string().trim().optional().nullable(),
})

connectedAccountRouter.post('/google/cookie', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await assertCanConnectStorage(req.user!.id)
    const body = googleCookieConnectSchema.parse(req.body)
    let cleanCookie = body.cookie.trim()
    if (cleanCookie.toLowerCase().startsWith('cookie:')) cleanCookie = cleanCookie.slice(7).trim()
    if ((cleanCookie.startsWith('"') && cleanCookie.endsWith('"')) || (cleanCookie.startsWith("'") && cleanCookie.endsWith("'"))) {
      cleanCookie = cleanCookie.slice(1, -1).trim()
    }

    const verification = await verifyGoogleCookie(cleanCookie)
    if (!verification.valid) {
      return res.status(400).json({
        code: 'INVALID_COOKIE',
        message: verification.error || 'Cookie Google Drive không hợp lệ hoặc đã hết hạn.'
      })
    }

    const email = (body.email && body.email.trim()) || verification.email || `drive-cookie-${randomToken(4).toLowerCase()}@gmail.com`
    const displayName = (body.displayName && body.displayName.trim()) || body.email?.trim() || verification.email || 'Google Drive (Cookie)'

    let providerConfig = await prisma.providerConfig.findFirst({
      where: { provider: 'google_drive', status: 'active' },
      orderBy: { createdAt: 'desc' },
    })
    if (!providerConfig) {
      providerConfig = await getRcloneConfig()
    }

    const providerAccountId = `cookie:${email.toLowerCase()}`
    const existing = await prisma.connectedAccount.findUnique({
      where: { userId_provider_providerAccountId: { userId: req.user!.id, provider: 'google_drive', providerAccountId } }
    })

    const account = existing
      ? await prisma.connectedAccount.update({
          where: { id: existing.id },
          data: {
            cookieEncrypted: encryptText(cleanCookie),
            displayName,
            status: 'connected',
            lastError: null,
            connectedVia: 'cookie',
          }
        })
      : await prisma.connectedAccount.create({
          data: {
            userId: req.user!.id,
            providerConfigId: providerConfig.id,
            provider: 'google_drive',
            providerAccountId,
            email,
            displayName,
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            tokenExpiresAt: null,
            scopes: ['cookie'],
            status: 'connected',
            connectedVia: 'cookie',
            cookieEncrypted: encryptText(cleanCookie),
          }
        })

    await prisma.storageAccount.upsert({
      where: { connectedAccountId: account.id },
      create: {
        connectedAccountId: account.id,
        totalBytes: 15n * 1024n * 1024n * 1024n,
        usedBytes: 0n,
        availableBytes: 15n * 1024n * 1024n * 1024n,
        lastSyncedAt: new Date(),
      },
      update: {
        lastSyncedAt: new Date(),
      }
    })

    return res.json({
      success: true,
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        connectedVia: account.connectedVia,
        hasCookie: true,
      }
    })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.post('/s3', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await assertCanConnectStorage(req.user!.id)
    const body = s3ConnectSchema.parse(req.body)
    const providerConfig = await prisma.providerConfig.findFirstOrThrow({ where: { provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
    const providerAccountId = `${body.bucket}:${body.endpoint || body.region}`
    const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: req.user!.id, provider: 's3', providerAccountId } } })
    const account = existingAccount
      ? await prisma.connectedAccount.update({
        where: { id: existingAccount.id },
        data: {
          providerConfigId: providerConfig.id,
          email: `${body.bucket} (S3)`,
          displayName: body.name,
          accessTokenEncrypted: encryptText('s3'),
          refreshTokenEncrypted: encryptText(randomToken()),
          tokenExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
          scopes: [],
          status: 'connected',
          connectedVia: 's3',
        },
      })
      : await prisma.connectedAccount.create({ data: {
        userId: req.user!.id,
        providerConfigId: providerConfig.id,
        provider: 's3',
        providerAccountId,
        email: `${body.bucket} (S3)`,
        displayName: body.name,
        accessTokenEncrypted: encryptText('s3'),
        refreshTokenEncrypted: encryptText(randomToken()),
        tokenExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        scopes: [],
        status: 'connected',
        connectedVia: 's3',
      } })
    const config = await prisma.s3StorageConfig.upsert({
      where: { connectedAccountId: account.id },
      create: {
        userId: req.user!.id,
        connectedAccountId: account.id,
        name: body.name,
        bucket: body.bucket,
        region: body.region,
        endpoint: body.endpoint || null,
        accessKeyIdEncrypted: encryptText(body.accessKeyId),
        secretAccessKeyEncrypted: encryptText(body.secretAccessKey),
        forcePathStyle: body.forcePathStyle ?? Boolean(body.endpoint),
        quotaBytes: body.quotaBytes ? BigInt(body.quotaBytes) : null,
      },
      update: {
        name: body.name,
        bucket: body.bucket,
        region: body.region,
        endpoint: body.endpoint || null,
        accessKeyIdEncrypted: encryptText(body.accessKeyId),
        secretAccessKeyEncrypted: encryptText(body.secretAccessKey),
        forcePathStyle: body.forcePathStyle ?? Boolean(body.endpoint),
        quotaBytes: body.quotaBytes ? BigInt(body.quotaBytes) : null,
        status: 'active',
      },
    })
    try {
      await testS3Connection(config)
      const quota = await syncS3Quota(account.id)
      return res.status(201).json({
        account: {
          ...account,
          storageAccount: { ...quota, totalBytes: quota.totalBytes?.toString() ?? null, usedBytes: quota.usedBytes.toString(), availableBytes: quota.availableBytes?.toString() ?? null, trashBytes: quota.trashBytes?.toString() ?? null },
        },
      })
    } catch (error) {
      if (!existingAccount) await prisma.connectedAccount.delete({ where: { id: account.id } }).catch(() => undefined)
      throw error
    }
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.get('/google/connect-url', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const url = await createGoogleConnectUrl(req)
    return res.json({ url })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.get('/google/connect', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const url = await createGoogleConnectUrl(req)
    return res.redirect(url)
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.get('/google/callback', async (req, res, next) => {
  try {
    const query = z.object({ code: z.string(), state: z.string() }).parse(req.query)
    const oauthState = await prisma.oauthState.findUniqueOrThrow({ where: { stateHash: hashToken(query.state) }, include: { providerConfig: true } })
    if (oauthState.usedAt || oauthState.expiresAt < new Date()) return res.status(400).json({ code: 'GOOGLE_OAUTH_STATE_INVALID', message: 'OAuth state expired.' })
    const client = createOAuthClient(oauthState.providerConfig)
    const tokenResult = await client.getToken(query.code)
    const tokens = tokenResult.tokens
    if (!tokens.access_token) return res.status(400).json({ code: 'GOOGLE_OAUTH_FAILED', message: 'Google did not return required tokens.' })
    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const profile = await oauth2.userinfo.get()
    const providerAccountId = profile.data.id
    const email = profile.data.email
    if (!providerAccountId || !email) return res.status(400).json({ code: 'GOOGLE_PROFILE_FAILED', message: 'Google profile missing id or email.' })

    if (oauthState.flow === 'link') {
      await prisma.oauthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date() } })
      if (!oauthState.userId) return res.redirect(`${env.FRONTEND_URL}/settings?tab=profile&googleLink=error`)
      const linkToken = parkGoogleLink(oauthState.userId, { id: providerAccountId, email, name: profile.data.name, picture: profile.data.picture })
      return res.redirect(`${env.FRONTEND_URL}/settings?tab=profile&googleLinkToken=${linkToken}`)
    }

    if (oauthState.flow === 'login') {
      const user = await resolveGoogleLoginUser({ id: providerAccountId, email, name: profile.data.name, picture: profile.data.picture })
      if (!user) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
      const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId } } })
      const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existingAccount?.refreshTokenEncrypted
      if (!refreshTokenEncrypted) {
        console.error('Google login failed: no refresh token received and no existing account. Has refresh_token:', !!tokens.refresh_token)
        return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
      }
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
      syncGoogleAppFolderFiles(account.id, user.id).catch((e) => console.error('Initial files sync error:', e))
      const handoffToken = randomToken()
      await prisma.authHandoff.create({ data: { userId: user.id, tokenHash: hashToken(handoffToken), expiresAt: new Date(Date.now() + 5 * 60_000) } })
      return res.redirect(`${env.FRONTEND_URL}/google-auth?token=${handoffToken}`)
    }

    if (oauthState.flow !== 'connect' || !oauthState.userId) return res.status(400).json({ code: 'GOOGLE_OAUTH_STATE_INVALID', message: 'OAuth state expired.' })
    const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: oauthState.userId, provider: 'google_drive', providerAccountId } } })
    const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existingAccount?.refreshTokenEncrypted
    if (!refreshTokenEncrypted) return res.status(400).json({ code: 'GOOGLE_OAUTH_FAILED', message: 'Google did not return required tokens.' })

    const account = await prisma.connectedAccount.upsert({
      where: { userId_provider_providerAccountId: { userId: oauthState.userId, provider: 'google_drive', providerAccountId } },
      create: {
        userId: oauthState.userId,
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
        connectedVia: 'oauth',
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
        connectedVia: 'oauth',
      },
    })
    await prisma.oauthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date() } })
    await syncGoogleQuota(account.id)
    syncGoogleAppFolderFiles(account.id, oauthState.userId).catch((e) => console.error('Initial files sync error:', e))
    return res.redirect(`${env.FRONTEND_URL}/google-connected?status=success`)
  } catch (error) {
    console.error('Google OAuth callback failed:', error)
    return res.redirect(`${env.FRONTEND_URL}/google-connected?status=error`)
  }
})

const manualTokenSchema = z.object({
  refreshToken: z.string().trim().min(1),
  clientId: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
  proxyUrl: z.string().trim().optional(),
})

connectedAccountRouter.post('/google/manual-token', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await assertCanConnectStorage(req.user!.id)
    const body = manualTokenSchema.parse(req.body)
    let config = await prisma.providerConfig.findFirst({
      where: { userId: null, provider: 'google_drive', status: 'active' },
      orderBy: { createdAt: 'desc' }
    })

    if (body.clientId && body.clientSecret) {
      if (!config) {
        config = await prisma.providerConfig.create({
          data: {
            userId: null,
            provider: 'google_drive',
            clientIdEncrypted: encryptText(body.clientId),
            clientSecretEncrypted: encryptText(body.clientSecret),
            redirectUri: 'http://localhost:4000/connected-accounts/google/callback',
            scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
            status: 'active'
          }
        })
      }
    }

    if (!config) {
      return res.status(400).json({ code: 'CONFIG_REQUIRED', message: 'Google OAuth configuration not found. Provide clientId and clientSecret.' })
    }

    const client = createOAuthClient(config)
    client.setCredentials({ refresh_token: body.refreshToken })
    const { token: accessToken } = await client.getAccessToken()
    if (!accessToken) {
      return res.status(400).json({ code: 'INVALID_TOKEN', message: 'Failed to verify Google refresh token.' })
    }

    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const profile = await oauth2.userinfo.get()
    const providerAccountId = profile.data.id
    const email = profile.data.email
    if (!providerAccountId || !email) {
      return res.status(400).json({ code: 'PROFILE_FAILED', message: 'Failed to retrieve Google user profile.' })
    }

    const proxyUrlEncrypted = body.proxyUrl ? encryptText(body.proxyUrl) : undefined

    const account = await prisma.connectedAccount.upsert({
      where: { userId_provider_providerAccountId: { userId: req.user!.id, provider: 'google_drive', providerAccountId } },
      create: {
        userId: req.user!.id,
        providerConfigId: config.id,
        provider: 'google_drive',
        providerAccountId,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(accessToken),
        refreshTokenEncrypted: encryptText(body.refreshToken),
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        scopes: config.scopes as string[],
        status: 'connected',
        connectedVia: 'manual_token',
        ...(proxyUrlEncrypted ? { proxyUrlEncrypted } : {}),
      },
      update: {
        providerConfigId: config.id,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(accessToken),
        refreshTokenEncrypted: encryptText(body.refreshToken),
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        scopes: config.scopes as string[],
        status: 'connected',
        connectedVia: 'manual_token',
        ...(proxyUrlEncrypted ? { proxyUrlEncrypted } : {}),
      },
    })

    await syncGoogleQuota(account.id).catch(() => undefined)
    syncGoogleAppFolderFiles(account.id, req.user!.id).catch((e) => console.error('Initial files sync error:', e))

    return res.status(201).json({ status: 'success', accountId: account.id, email })
  } catch (error) {
    return next(error)
  }
})

const exchangeCodeSchema = z.object({
  code: z.string().trim().min(1),
  method: z.enum(['rclone', 'custom']).optional(),
  redirectUri: z.string().trim().optional(),
  proxyUrl: z.string().trim().optional(),
})

connectedAccountRouter.post('/google/exchange-code', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await assertCanConnectStorage(req.user!.id)
    const body = exchangeCodeSchema.parse(req.body)
    let config
    if (body.method === 'custom') {
      config = await getCustomConfig()
      if (!config) return res.status(400).json({ code: 'CONFIG_NOT_FOUND', message: 'Chưa cấu hình Google OAuth cá nhân.' })
    } else {
      config = await getRcloneConfig()
    }

    let authCode = body.code
    // Extract code if user pasted a full URL
    if (authCode.includes('code=')) {
      const match = authCode.match(/[?&]code=([^&]+)/)
      if (match) authCode = decodeURIComponent(match[1])
    }

    const client = createOAuthClient(config)
    const tokenResult = await client.getToken({
      code: authCode,
      redirect_uri: body.redirectUri || config.redirectUri,
    })
    const tokens = tokenResult.tokens
    if (!tokens.refresh_token && !tokens.access_token) {
      return res.status(400).json({ code: 'TOKEN_EXCHANGE_FAILED', message: 'Google did not return valid tokens.' })
    }

    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const profile = await oauth2.userinfo.get()
    const providerAccountId = profile.data.id
    const email = profile.data.email
    if (!providerAccountId || !email) {
      return res.status(400).json({ code: 'PROFILE_FAILED', message: 'Could not retrieve user email from Google.' })
    }

    const existingAccount = await prisma.connectedAccount.findUnique({
      where: { userId_provider_providerAccountId: { userId: req.user!.id, provider: 'google_drive', providerAccountId } }
    })
    const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existingAccount?.refreshTokenEncrypted
    if (!refreshTokenEncrypted) {
      return res.status(400).json({ code: 'MISSING_REFRESH_TOKEN', message: 'Google did not provide a refresh token. Try signing in again.' })
    }

    const proxyUrlEncrypted = body.proxyUrl ? encryptText(body.proxyUrl) : undefined

    const account = await prisma.connectedAccount.upsert({
      where: { userId_provider_providerAccountId: { userId: req.user!.id, provider: 'google_drive', providerAccountId } },
      create: {
        userId: req.user!.id,
        providerConfigId: config.id,
        provider: 'google_drive',
        providerAccountId,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(tokens.access_token || ''),
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        scopes: config.scopes as string[],
        status: 'connected',
        connectedVia: 'auth_code',
        ...(proxyUrlEncrypted ? { proxyUrlEncrypted } : {}),
      },
      update: {
        providerConfigId: config.id,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(tokens.access_token || ''),
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        scopes: config.scopes as string[],
        status: 'connected',
        connectedVia: 'auth_code',
        ...(proxyUrlEncrypted ? { proxyUrlEncrypted } : {}),
      },
    })

    await syncGoogleQuota(account.id).catch(() => undefined)
    syncGoogleAppFolderFiles(account.id, req.user!.id).catch((e) => console.error('Initial files sync error:', e))

    return res.status(201).json({ status: 'success', accountId: account.id, email })
  } catch (error) {
    return next(error)
  }
})

const proxyUpdateSchema = z.object({
  proxyUrl: z.string().trim().nullable().optional(),
})

connectedAccountRouter.patch('/:id/proxy', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const isAdmin = await isAdminUser(req.user!.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId } })
    if (account.userId !== req.user!.id && !isAdmin) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Bạn không có quyền sửa proxy của tài khoản này.' })
    }

    const body = proxyUpdateSchema.parse(req.body)

    let proxyUrlEncrypted: string | null = null
    if (body.proxyUrl && body.proxyUrl.trim()) {
      const cleanUrl = body.proxyUrl.trim()
      try {
        const parsed = new URL(cleanUrl)
        if (!SUPPORTED_PROXY_PROTOCOLS.includes(parsed.protocol)) {
          return res.status(400).json({ code: 'INVALID_PROXY_PROTOCOL', message: 'Proxy protocol must be http, https, socks5 or socks5h.' })
        }
      } catch {
        return res.status(400).json({ code: 'INVALID_PROXY_URL', message: 'Invalid proxy URL format.' })
      }
      proxyUrlEncrypted = encryptText(cleanUrl)
    }

    const updated = await prisma.connectedAccount.update({
      where: { id: accountId },
      data: { proxyUrlEncrypted },
    })

    return res.json({
      status: 'ok',
      hasProxy: Boolean(proxyUrlEncrypted),
      proxyUrl: maskProxyUrl(body.proxyUrl?.trim() ?? null),
    })
  } catch (error) {
    return next(error)
  }
})

const cookieUpdateSchema = z.object({
  cookie: z.string().trim().nullable().optional(),
})

connectedAccountRouter.patch('/:id/cookie', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id
    const isAdmin = await isAdminUser(userId)
    const account = await prisma.connectedAccount.findFirst({
      where: { id: String(req.params.id), ...(isAdmin ? {} : { userId }) },
    })
    if (!account) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Bạn không có quyền sửa cookie của tài khoản này.' })
    }

    const body = cookieUpdateSchema.parse(req.body)
    let cookieEncrypted: string | null = null
    if (body.cookie && body.cookie.trim()) {
      cookieEncrypted = encryptText(body.cookie.trim())
    }

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { cookieEncrypted },
    })

    return res.json({
      status: 'ok',
      hasCookie: Boolean(cookieEncrypted),
    })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.patch('/:id/share', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const isAdmin = await isAdminUser(req.user!.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId } })
    if (account.userId !== req.user!.id && !isAdmin) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Chỉ chủ sở hữu hoặc Quản trị viên mới có thể thay đổi quyền chia sẻ.' })
    }
    const body = z.object({ isShared: z.boolean() }).parse(req.body)
    const updated = await prisma.connectedAccount.update({
      where: { id: accountId },
      data: { isShared: body.isShared },
    })
    return res.json({ status: 'ok', isShared: updated.isShared })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.post('/:id/test-proxy', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const body = z.object({ proxyUrl: z.string().trim().optional() }).parse(req.body ?? {})
    // The server opens a connection to whatever host is given here, so only the people who may set
    // this account's proxy may test one (otherwise any user could probe hosts on the server's network).
    const isAdmin = await isAdminUser(req.user!.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId } })
    if (account.userId !== req.user!.id && !isAdmin) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Bạn không có quyền kiểm tra proxy của tài khoản này.' })
    }
    let proxyUrl = body.proxyUrl || (getAccountProxyUrl(account) ?? undefined)
    if (!proxyUrl) {
      return res.status(400).json({ code: 'NO_PROXY_CONFIGURED', message: 'No proxy URL provided or configured on this account.' })
    }
    try {
      if (!SUPPORTED_PROXY_PROTOCOLS.includes(new URL(proxyUrl).protocol)) {
        return res.status(400).json({ code: 'INVALID_PROXY_PROTOCOL', message: 'Proxy protocol must be http, https, socks5 or socks5h.' })
      }
    } catch {
      return res.status(400).json({ code: 'INVALID_PROXY_URL', message: 'Invalid proxy URL format.' })
    }

    const result = await testProxyConnectivity(proxyUrl)
    return res.json(result)
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.post('/:id/sync-quota', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: accountId, OR: [{ userId: req.user!.id }, { isShared: true }] }
    })
    const quota = await syncQuotaForAccount(account)
    if (account.provider === 'google_drive' && account.connectedVia !== 'cookie') {
      syncGoogleAppFolderFiles(account.id, req.user!.id).catch((e) => console.error('Sync files on quota refresh error:', e))
    }
    return res.json({
      quota: {
        ...quota,
        totalBytes: quota.totalBytes?.toString() ?? null,
        usedBytes: quota.usedBytes.toString(),
        availableBytes: quota.availableBytes?.toString() ?? null,
        trashBytes: quota.trashBytes?.toString() ?? null,
      },
    })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.get('/:id/drive-items', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: accountId, status: 'connected', OR: [{ userId: req.user!.id }, { isShared: true }] },
    })
    const parentId = String(req.query.parentId || 'root')
    const q = req.query.q ? String(req.query.q) : undefined
    const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined

    if (account.provider === 'google_drive') {
      const result = await listGoogleDriveItems(account, parentId, q, pageToken)
      return res.json(result)
    }

    return res.json({ parentId, items: [], nextPageToken: null })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.post('/:id/drive-folder', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: accountId, status: 'connected', OR: [{ userId: req.user!.id }, { isShared: true }] },
    })
    const body = z.object({
      name: z.string().trim().min(1).max(255),
      parentId: z.string().optional().default('root'),
    }).parse(req.body)

    if (account.provider === 'google_drive') {
      const folder = await createGoogleDriveFolder(account, body.name, body.parentId)
      return res.status(201).json({ folder })
    }
    return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Only Google Drive supports creating remote folders directly.' })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.delete('/:id/drive-item/:fileId', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const fileId = String(req.params.fileId)
    const permanent = req.query.permanent === 'true'
    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: accountId, status: 'connected', OR: [{ userId: req.user!.id }, { isShared: true }] },
    })

    if (account.provider === 'google_drive') {
      await deleteGoogleDriveItem(account, fileId, permanent)
      await prisma.file.updateMany({
        where: { providerFileId: fileId, connectedAccountId: account.id },
        data: { status: 'deleted', deletedAt: new Date() },
      })
      return res.json({ status: 'ok' })
    }
    return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Only Google Drive supported.' })
  } catch (error) {
    return next(error)
  }
})

connectedAccountRouter.delete('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const accountId = String(req.params.id)
    const isAdmin = await isAdminUser(req.user!.id)
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId } })
    if (account.userId !== req.user!.id && !isAdmin) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Bạn không có quyền ngắt kết nối tài khoản này.' })
    }
    await prisma.connectedAccount.update({ where: { id: accountId }, data: { status: 'disconnected' } })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})
