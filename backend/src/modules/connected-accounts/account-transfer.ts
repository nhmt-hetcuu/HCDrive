import type { Router } from 'express'
import type { ConnectedAccount, ProviderConfig } from '@prisma/client'
import { google } from 'googleapis'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { limiters } from '../../middleware/rate-limit.js'
import { createAuditLog } from '../../utils/audit.js'
import { decryptText, encryptText, randomToken } from '../../utils/crypto.js'
import { verifyPassword } from '../../utils/password.js'
import { SUPPORTED_PROXY_PROTOCOLS, getAccountProxyUrl } from '../../utils/proxy.js'
import { RCLONE_CLIENT_ID, createOAuthClient, getRcloneConfig, syncGoogleAppFolderFiles, syncGoogleQuota } from '../google/google.service.js'
import { syncS3Quota, testS3Connection } from '../s3/s3.service.js'

// Moving storage accounts between HCDrive installs (or keeping a backup of them) as one JSON file:
// Google Drive accounts as their refresh token plus the OAuth client that issued it, S3 accounts as
// their bucket and keys. The file holds live credentials, so exporting asks for the password again.

const EXPORT_FORMAT = 'hcdrive-storage-accounts'
const DEFAULT_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const proxyUrlSchema = z.string().trim().max(2048).refine((value) => {
  try {
    return SUPPORTED_PROXY_PROTOCOLS.includes(new URL(value).protocol)
  } catch {
    return false
  }
}, { message: 'Proxy must be http://, https://, socks5:// or socks5h://' })

// The same object rclone keeps in its config ("token = {...}"), so a token can go either way.
const tokenSchema = z.object({
  access_token: z.string().optional(),
  token_type: z.string().optional(),
  refresh_token: z.string().trim().min(1),
  expiry: z.string().optional(),
})

const googleEntrySchema = z.object({
  provider: z.literal('google_drive'),
  email: z.string().optional(),
  displayName: z.string().nullable().optional(),
  // rclone: the shared default client; custom: the client below, which must be the one that issued the token.
  oauthClient: z.object({
    kind: z.enum(['rclone', 'custom']),
    clientId: z.string().trim().optional(),
    clientSecret: z.string().trim().optional(),
  }).optional(),
  scopes: z.array(z.string()).optional(),
  token: tokenSchema,
  proxyUrl: proxyUrlSchema.nullable().optional(),
  isShared: z.boolean().optional(),
})

const s3EntrySchema = z.object({
  provider: z.literal('s3'),
  name: z.string().trim().min(1).max(191),
  bucket: z.string().trim().min(1).max(191),
  region: z.string().trim().min(1).max(191),
  endpoint: z.string().url().nullable().optional().or(z.literal('')),
  prefix: z.string().trim().max(191).optional(),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().optional(),
  quotaBytes: z.string().regex(/^\d+$/).nullable().optional(),
  isShared: z.boolean().optional(),
})

const entrySchema = z.discriminatedUnion('provider', [googleEntrySchema, s3EntrySchema])
type GoogleEntry = z.infer<typeof googleEntrySchema>
type S3Entry = z.infer<typeof s3EntrySchema>

const exportBodySchema = z.object({
  password: z.string().optional(),
  accountIds: z.array(z.string().min(1)).max(500).optional(),
})

function decryptOrNull(value: string | null | undefined) {
  if (!value) return null
  try {
    return decryptText(value)
  } catch {
    return null
  }
}

/** Accepts the HCDrive export, a bare list of entries, or one rclone token object. */
function readImportPayload(raw: unknown) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'refresh_token' in raw) {
    return [{ provider: 'google_drive' as const, token: tokenSchema.parse(raw), oauthClient: { kind: 'rclone' as const } }]
  }
  const list = Array.isArray(raw) ? raw : z.object({ accounts: z.array(z.unknown()) }).parse(raw).accounts
  if (list.length === 0) throw Object.assign(new Error('Tệp JSON không có tài khoản nào.'), { status: 400, code: 'IMPORT_EMPTY' })
  if (list.length > 500) throw Object.assign(new Error('Tối đa 500 tài khoản mỗi lần nhập.'), { status: 400, code: 'IMPORT_TOO_MANY' })
  return list
}

async function exportAccount(account: ConnectedAccount & { providerConfig: ProviderConfig | null; s3StorageConfig: { name: string; bucket: string; region: string; endpoint: string | null; prefix: string; accessKeyIdEncrypted: string; secretAccessKeyEncrypted: string; forcePathStyle: boolean; quotaBytes: bigint | null } | null }) {
  const proxyUrl = getAccountProxyUrl(account)
  if (account.provider === 's3' && account.s3StorageConfig) {
    const config = account.s3StorageConfig
    return {
      provider: 's3',
      name: config.name,
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      prefix: config.prefix,
      accessKeyId: decryptOrNull(config.accessKeyIdEncrypted),
      secretAccessKey: decryptOrNull(config.secretAccessKeyEncrypted),
      forcePathStyle: config.forcePathStyle,
      quotaBytes: config.quotaBytes?.toString() ?? null,
      isShared: account.isShared,
    }
  }
  const refreshToken = decryptOrNull(account.refreshTokenEncrypted)
  if (!refreshToken) return null
  const clientId = decryptOrNull(account.providerConfig?.clientIdEncrypted)
  const kind = clientId === RCLONE_CLIENT_ID ? 'rclone' : 'custom'
  return {
    provider: 'google_drive',
    email: account.email,
    displayName: account.displayName,
    oauthClient: kind === 'rclone'
      ? { kind }
      : { kind, clientId, clientSecret: decryptOrNull(account.providerConfig?.clientSecretEncrypted) },
    scopes: account.scopes,
    token: {
      access_token: decryptOrNull(account.accessTokenEncrypted) ?? undefined,
      token_type: 'Bearer',
      refresh_token: refreshToken,
      expiry: account.tokenExpiresAt?.toISOString(),
    },
    proxyUrl,
    isShared: account.isShared,
  }
}

/** The OAuth client a token came from; a custom one is reused when already stored, otherwise saved for this user. */
async function providerConfigFor(userId: string, entry: GoogleEntry): Promise<ProviderConfig> {
  const client = entry.oauthClient ?? { kind: 'rclone' as const }
  if (client.kind === 'rclone' || !client.clientId) return getRcloneConfig()
  if (!client.clientSecret) throw new Error('Thiếu clientSecret của OAuth riêng.')
  const candidates = await prisma.providerConfig.findMany({ where: { provider: 'google_drive', status: 'active', OR: [{ userId: null }, { userId }] } })
  const found = candidates.find((config) => decryptOrNull(config.clientIdEncrypted) === client.clientId && decryptOrNull(config.clientSecretEncrypted) === client.clientSecret)
  if (found) return found
  const rclone = await getRcloneConfig()
  return prisma.providerConfig.create({
    data: {
      userId,
      provider: 'google_drive',
      clientIdEncrypted: encryptText(client.clientId),
      clientSecretEncrypted: encryptText(client.clientSecret),
      // Only used for consent redirects; refreshing a token never needs it.
      redirectUri: rclone.redirectUri,
      scopes: entry.scopes?.length ? entry.scopes : DEFAULT_GOOGLE_SCOPES,
      status: 'active',
    },
  })
}

async function importGoogle(userId: string, entry: GoogleEntry) {
  const config = await providerConfigFor(userId, entry)
  const proxyUrl = entry.proxyUrl || null
  const client = createOAuthClient(config, proxyUrl)
  client.setCredentials({ refresh_token: entry.token.refresh_token })
  // Proves the token still works (and belongs to this client) before anything is stored.
  const refreshed = await client.refreshAccessToken()
  const accessToken = refreshed.credentials.access_token
  if (!accessToken) throw new Error('Google không cấp access token cho refresh token này.')
  const profile = await google.oauth2({ version: 'v2', auth: client }).userinfo.get()
  const providerAccountId = profile.data.id
  const email = profile.data.email
  if (!providerAccountId || !email) throw new Error('Không đọc được email của tài khoản Google.')

  const key = { userId_provider_providerAccountId: { userId, provider: 'google_drive', providerAccountId } }
  const existed = Boolean(await prisma.connectedAccount.findUnique({ where: key, select: { id: true } }))
  const data = {
    providerConfigId: config.id,
    email,
    displayName: profile.data.name,
    avatarUrl: profile.data.picture,
    accessTokenEncrypted: encryptText(accessToken),
    refreshTokenEncrypted: encryptText(refreshed.credentials.refresh_token || entry.token.refresh_token),
    tokenExpiresAt: new Date(refreshed.credentials.expiry_date ?? Date.now() + 3600_000),
    scopes: entry.scopes?.length ? entry.scopes : (config.scopes as string[]),
    status: 'connected',
    connectedVia: 'import',
    lastError: null,
    proxyUrlEncrypted: proxyUrl ? encryptText(proxyUrl) : null,
    ...(entry.isShared !== undefined ? { isShared: entry.isShared } : {}),
  }
  const account = await prisma.connectedAccount.upsert({
    where: key,
    create: { ...data, userId, provider: 'google_drive', providerAccountId },
    update: data,
  })
  await syncGoogleQuota(account.id).catch(() => undefined)
  syncGoogleAppFolderFiles(account.id, userId).catch((error) => console.error('Files sync after import failed:', error))
  return { email, existed }
}

async function importS3(userId: string, entry: S3Entry) {
  const anyConfig = await prisma.providerConfig.findFirst({ where: { provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } }) ?? await getRcloneConfig()
  const endpoint = entry.endpoint || null
  const providerAccountId = `${entry.bucket}:${endpoint || entry.region}`
  const key = { userId_provider_providerAccountId: { userId, provider: 's3', providerAccountId } }
  const existing = await prisma.connectedAccount.findUnique({ where: key, select: { id: true } })
  const accountData = {
    providerConfigId: anyConfig.id,
    email: `${entry.bucket} (S3)`,
    displayName: entry.name,
    accessTokenEncrypted: encryptText('s3'),
    refreshTokenEncrypted: encryptText(randomToken()),
    tokenExpiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
    scopes: [],
    status: 'connected',
    connectedVia: 'import',
    ...(entry.isShared !== undefined ? { isShared: entry.isShared } : {}),
  }
  const account = await prisma.connectedAccount.upsert({
    where: key,
    create: { ...accountData, userId, provider: 's3', providerAccountId },
    update: accountData,
  })
  const s3Data = {
    name: entry.name,
    bucket: entry.bucket,
    region: entry.region,
    endpoint,
    ...(entry.prefix ? { prefix: entry.prefix } : {}),
    accessKeyIdEncrypted: encryptText(entry.accessKeyId),
    secretAccessKeyEncrypted: encryptText(entry.secretAccessKey),
    forcePathStyle: entry.forcePathStyle ?? Boolean(endpoint),
    quotaBytes: entry.quotaBytes ? BigInt(entry.quotaBytes) : null,
    status: 'active',
  }
  const config = await prisma.s3StorageConfig.upsert({
    where: { connectedAccountId: account.id },
    create: { ...s3Data, userId, connectedAccountId: account.id },
    update: s3Data,
  })
  try {
    await testS3Connection(config)
    await syncS3Quota(account.id)
  } catch (error) {
    // Kept like a failed manual connect would leave it: the error shows on the account until fixed.
    await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastError: error instanceof Error ? error.message : 'S3 connection failed' } })
    throw error
  }
  return { email: account.email, existed: Boolean(existing) }
}

// Google's token endpoint answers a bad refresh token with "invalid_grant" / "Bad Request".
function importErrorMessage(error: unknown) {
  const gaxios = error as { response?: { data?: { error_description?: string; error?: string | { message?: string } } } }
  const data = gaxios.response?.data
  if (data?.error === 'invalid_grant') return 'Refresh token không còn dùng được: đã bị thu hồi, hết hạn, hoặc không do OAuth client này cấp.'
  if (data?.error === 'unauthorized_client' || data?.error === 'invalid_client') return 'OAuth client (clientId/clientSecret) không khớp với token này.'
  const googleMessage = data?.error_description || (typeof data?.error === 'string' ? data.error : data?.error?.message)
  return googleMessage || (error instanceof Error ? error.message : 'Import failed')
}

export function mountAccountTransferRoutes(router: Router, assertCanConnectStorage: (userId: string) => Promise<unknown>) {
  // POST so the password travels in the body. Only the caller's own accounts are exported.
  router.post('/export', requireAuth, limiters.passwordCheck, async (req: AuthRequest, res, next) => {
    try {
      const body = exportBodySchema.parse(req.body ?? {})
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { passwordHash: true, hasPassword: true } })
      if (user.hasPassword && (!body.password || !(await verifyPassword(user.passwordHash, body.password)))) {
        return res.status(400).json({ code: 'INVALID_CURRENT_PASSWORD', message: 'Mật khẩu không chính xác.' })
      }
      const accounts = await prisma.connectedAccount.findMany({
        where: { userId: req.user!.id, status: 'connected', ...(body.accountIds ? { id: { in: body.accountIds } } : {}) },
        include: { providerConfig: true, s3StorageConfig: true },
        orderBy: { createdAt: 'asc' },
      })
      const entries = (await Promise.all(accounts.map(exportAccount))).filter((entry) => entry !== null)
      await createAuditLog(req.user!.id, 'STORAGE_ACCOUNTS_EXPORT', 'connected_account', undefined, { count: entries.length })
      res.setHeader('Cache-Control', 'no-store')
      return res.json({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), accounts: entries })
    } catch (error) {
      return next(error)
    }
  })

  // Each entry is checked against Google/S3 on its own, so one bad token does not stop the rest.
  router.post('/import', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      await assertCanConnectStorage(req.user!.id)
      const list = readImportPayload(req.body)
      const results: Array<{ index: number; provider: string; label: string; status: 'imported' | 'updated' | 'failed'; message?: string }> = []
      for (const [index, raw] of list.entries()) {
        const parsed = entrySchema.safeParse(raw)
        const guess = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
        const label = String(guess.email ?? guess.name ?? guess.bucket ?? `#${index + 1}`)
        if (!parsed.success) {
          results.push({ index, provider: String(guess.provider ?? '?'), label, status: 'failed', message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`).join('; ') })
          continue
        }
        try {
          const outcome = parsed.data.provider === 'google_drive' ? await importGoogle(req.user!.id, parsed.data) : await importS3(req.user!.id, parsed.data)
          results.push({ index, provider: parsed.data.provider, label: outcome.email, status: outcome.existed ? 'updated' : 'imported' })
        } catch (error) {
          results.push({ index, provider: parsed.data.provider, label, status: 'failed', message: importErrorMessage(error) })
        }
      }
      const imported = results.filter((result) => result.status !== 'failed').length
      await createAuditLog(req.user!.id, 'STORAGE_ACCOUNTS_IMPORT', 'connected_account', undefined, { total: results.length, imported })
      return res.json({ imported, failed: results.length - imported, results })
    } catch (error) {
      return next(error)
    }
  })
}
