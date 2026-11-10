import { drive_v3, google } from 'googleapis'
import type { ConnectedAccount, ProviderConfig } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { decryptText, encryptText } from '../../utils/crypto.js'
import { getAccountProxyUrl, applyProxyToOAuthClient, gaxiosProxyOptions } from '../../utils/proxy.js'
import { withAccountLock } from '../../utils/account-lock.js'
import { googlePausedFor, noteGoogleError } from '../../utils/google-backoff.js'
import { rememberThumbnailLink } from '../../utils/thumbnail-cache.js'

const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'

export const RCLONE_CLIENT_ID = '202264815644.apps.googleusercontent.com'
export const RCLONE_CLIENT_SECRET = 'X4Z3ca8xfWDb1Voo-F9a7ZxJ'

export async function getRcloneConfig(): Promise<ProviderConfig> {
  const frontendUrl = (process.env.FRONTEND_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '')
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || `${frontendUrl}/connected-accounts/google/callback`

  const all = await prisma.providerConfig.findMany({
    where: { userId: null, provider: 'google_drive', status: 'active' },
  })
  const found = all.find((c) => {
    try {
      return decryptText(c.clientIdEncrypted) === RCLONE_CLIENT_ID
    } catch {
      return false
    }
  })

  if (found) {
    let secret = ''
    try { secret = decryptText(found.clientSecretEncrypted) } catch {}
    if (secret !== RCLONE_CLIENT_SECRET || found.redirectUri !== redirectUri) {
      return prisma.providerConfig.update({
        where: { id: found.id },
        data: {
          clientSecretEncrypted: encryptText(RCLONE_CLIENT_SECRET),
          redirectUri,
        },
      })
    }
    return found
  }

  return prisma.providerConfig.create({
    data: {
      userId: null,
      provider: 'google_drive',
      clientIdEncrypted: encryptText(RCLONE_CLIENT_ID),
      clientSecretEncrypted: encryptText(RCLONE_CLIENT_SECRET),
      redirectUri,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      status: 'active',
    },
  })
}

export async function getCustomConfig(): Promise<ProviderConfig | null> {
  const all = await prisma.providerConfig.findMany({
    where: { userId: null, provider: 'google_drive', status: 'active' },
    orderBy: { createdAt: 'desc' },
  })
  return all.find((c) => {
    try {
      return decryptText(c.clientIdEncrypted) !== RCLONE_CLIENT_ID
    } catch {
      return true
    }
  }) ?? null
}

export function createOAuthClient(config: ProviderConfig, proxyUrl?: string | null) {
  let clientId = decryptText(config.clientIdEncrypted)
  let clientSecret = decryptText(config.clientSecretEncrypted)

  // Auto-correct if this is Rclone client ID with stale/wrong secret
  if (clientId === RCLONE_CLIENT_ID && clientSecret !== RCLONE_CLIENT_SECRET) {
    clientSecret = RCLONE_CLIENT_SECRET
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, config.redirectUri)
  if (proxyUrl) {
    applyProxyToOAuthClient(client, proxyUrl)
  }
  return client
}

/**
 * Drive clients for a batch of files: one per account, instead of reading the OAuth config and
 * refreshing the token again for every file.
 */
export function createDriveClientCache() {
  const clients = new Map<string, Promise<drive_v3.Drive>>()
  return (account: ConnectedAccount) => {
    let client = clients.get(account.id)
    if (!client) {
      client = getAuthedGoogleClient(account).then((auth) => getGoogleDriveClient(auth, getAccountProxyUrl(account)))
      clients.set(account.id, client)
    }
    return client
  }
}

/** Google answers 404 for a file that is already gone. */
export function isDriveNotFound(error: unknown) {
  const e = error as { status?: number; code?: number | string; response?: { status?: number } }
  return e?.status === 404 || e?.code === 404 || e?.response?.status === 404
}

export function getGoogleDriveClient(auth: any, proxyUrl?: string | null): drive_v3.Drive {
  const options: drive_v3.Options = {
    version: 'v3',
    auth,
    retryConfig: {
      // Per-minute limits do not clear in milliseconds: wait 1, 2, 4, 8 s between tries.
      retry: 4,
      retryDelay: 1000,
      retryDelayMultiplier: 2,
      statusCodesToRetry: [
        [100, 199],
        [403, 403],
        [429, 429],
        [500, 599]
      ],
      shouldRetry: (err: any) => {
        const status = err.response?.status || err.code
        if (status === 403) {
          const reason = err.response?.data?.error?.errors?.[0]?.reason || ''
          const msg = err.response?.data?.error?.message || err.message || ''
          if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || msg.includes('Quota exceeded')) {
            return true
          }
        }
        if (status === 429) return true
        return false
      }
    }
  }
  // http(s) proxies go in as `proxy`; SOCKS5 proxies as a ready-made `agent` (see utils/proxy.ts).
  Object.assign(options, gaxiosProxyOptions(proxyUrl))
  return google.drive(options)
}

export async function getAuthedGoogleClient(account: ConnectedAccount) {
  if (!account.accessTokenEncrypted || !account.refreshTokenEncrypted || !account.tokenExpiresAt) throw new Error('Google account tokens are missing.')
  if (!account.providerConfigId) throw new Error('Google provider config is missing.')
  const config = await prisma.providerConfig.findUniqueOrThrow({ where: { id: account.providerConfigId } })
  const proxyUrl = getAccountProxyUrl(account)
  const client = createOAuthClient(config, proxyUrl)
  client.setCredentials({
    access_token: decryptText(account.accessTokenEncrypted),
    refresh_token: decryptText(account.refreshTokenEncrypted),
    expiry_date: account.tokenExpiresAt.getTime(),
  })

  if (account.tokenExpiresAt.getTime() < Date.now() + 60_000) {
    const result = await client.refreshAccessToken()
    const credentials = result.credentials
    if (credentials.access_token) {
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: encryptText(credentials.access_token),
          tokenExpiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
        },
      })
      client.setCredentials(credentials)
    }
  }

  return client
}

export async function syncGoogleQuota(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)
  let about
  try {
    about = await drive.about.get({ fields: 'storageQuota,user' })
  } catch (error) {
    noteGoogleError(accountId, error)
    throw error
  }
  // A Google call that works again clears the error shown on the account.
  if (account.lastError) await prisma.connectedAccount.update({ where: { id: accountId }, data: { lastError: null } }).catch(() => undefined)
  const quota = about.data.storageQuota
  const total = quota?.limit ? BigInt(quota.limit) : null
  const used = quota?.usage ? BigInt(quota.usage) : 0n
  return prisma.storageAccount.upsert({
    where: { connectedAccountId: accountId },
    create: {
      connectedAccountId: accountId,
      totalBytes: total,
      usedBytes: used,
      availableBytes: total === null ? null : total - used,
      trashBytes: quota?.usageInDriveTrash ? BigInt(quota.usageInDriveTrash) : null,
      lastSyncedAt: new Date(),
    },
    update: {
      totalBytes: total,
      usedBytes: used,
      availableBytes: total === null ? null : total - used,
      trashBytes: quota?.usageInDriveTrash ? BigInt(quota.usageInDriveTrash) : null,
      lastSyncedAt: new Date(),
    },
  })
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function ensureGoogleAppFolder(_account: ConnectedAccount): Promise<string> {
  // Save directly to the root of Google Drive (outside of any subfolder)
  return 'root'
}

export type GoogleAppFolderSyncResult = {
  accountId: string
  created: number
  updated: number
  deleted: number
}

type DriveFileMetadata = {
  id: string
  name: string
  mimeType: string
  sizeBytes: bigint
  parentId: string
  trashed: boolean
  modifiedAt: Date | null
  starred: boolean
  shortcutTargetId: string | null
}

// A full sync lists every file of the account. Every visit to My Drive, every user of a shared
// account and the quota refresh all ask for one, and queued behind the account lock they also held
// up the live refresh of the open folder. So a sync already running is joined, and one that
// finished moments ago is not repeated unless forced.
const FULL_SYNC_REUSE_MS = 2 * 60_000
const runningFullSyncs = new Map<string, Promise<GoogleAppFolderSyncResult>>()
const lastFullSyncAt = new Map<string, number>()

export function syncGoogleAppFolderFiles(accountId: string, userId: string, options: { force?: boolean } = {}): Promise<GoogleAppFolderSyncResult> {
  const running = runningFullSyncs.get(accountId)
  if (running) return running
  const last = lastFullSyncAt.get(accountId)
  if (!options.force && last && Date.now() - last < FULL_SYNC_REUSE_MS) {
    return Promise.resolve({ accountId, created: 0, updated: 0, deleted: 0 })
  }
  const run = withAccountLock(accountId, () => syncAccountUnlocked(accountId, userId, Boolean(options.force)))
    .then((result) => {
      lastFullSyncAt.set(accountId, Date.now())
      return result
    })
    .finally(() => runningFullSyncs.delete(accountId))
  runningFullSyncs.set(accountId, run)
  return run
}

// A full listing at least this often even when the Changes API works, to catch anything it missed.
const FULL_SYNC_EVERY_MS = 6 * 60 * 60_000
const driveRootIds = new Map<string, string>()

/**
 * Full sync the first time, when forced (the Sync button) or every 6 hours; otherwise only the
 * changes Drive reports since the last sync (one request instead of listing every file).
 */
async function syncAccountUnlocked(accountId: string, userId: string, force: boolean): Promise<GoogleAppFolderSyncResult> {
  const account = await prisma.connectedAccount.findFirstOrThrow({
    where: { id: accountId, provider: 'google_drive', status: 'connected', OR: [{ userId }, { isShared: true }] },
  })
  if (account.connectedVia === 'cookie') {
    return { accountId, created: 0, updated: 0, deleted: 0 }
  }
  // Google said "too many requests" a moment ago: automatic syncs wait (see utils/google-backoff.ts).
  if (!force && googlePausedFor(accountId) > 0) return { accountId, created: 0, updated: 0, deleted: 0 }
  try {
    return await syncAccountWithGoogle(account, userId, force)
  } catch (error) {
    noteGoogleError(accountId, error)
    throw error
  }
}

async function syncAccountWithGoogle(account: ConnectedAccount, userId: string, force: boolean): Promise<GoogleAppFolderSyncResult> {
  const accountId = account.id
  const fullDue = force || !account.changesPageToken || !account.lastFullSyncAt || account.lastFullSyncAt.getTime() < Date.now() - FULL_SYNC_EVERY_MS
  if (!fullDue) {
    const incremental = await syncGoogleChanges(account, userId).catch((error) => {
      console.warn(`[sync] changes for ${account.email} failed, falling back to a full sync:`, error instanceof Error ? error.message : error)
      return null
    })
    if (incremental) return incremental
  }
  // The position is taken before listing, so changes made while the listing runs come next time.
  const drive = getGoogleDriveClient(await getAuthedGoogleClient(account), getAccountProxyUrl(account))
  const start = await drive.changes.getStartPageToken({ supportsAllDrives: true })
  const result = await syncGoogleAppFolderFilesUnlocked(accountId, userId)
  await prisma.connectedAccount.update({ where: { id: accountId }, data: { changesPageToken: start.data.startPageToken ?? null, lastFullSyncAt: new Date() } })
  return result
}

/**
 * Applies Drive's change log to the file rows. Returns null when a full sync is needed instead:
 * folders changed (the merged tree is rebuilt by the full sync) or too many changes piled up.
 */
async function syncGoogleChanges(account: ConnectedAccount, userId: string): Promise<GoogleAppFolderSyncResult | null> {
  const drive = getGoogleDriveClient(await getAuthedGoogleClient(account), getAccountProxyUrl(account))
  type ChangedFile = { id: string; name: string; mimeType: string; size: string | null; parents: string[]; trashed: boolean; modifiedTime: string | null; starred: boolean; ownedByMe: boolean; shortcutTargetId: string | null }
  const changes: Array<{ fileId: string; removed: boolean; file: ChangedFile | null }> = []
  let pageToken: string | null | undefined = account.changesPageToken
  let newStartPageToken: string | null = null
  while (pageToken) {
    const page: { data: drive_v3.Schema$ChangeList } = await drive.changes.list({
      pageToken,
      spaces: 'drive',
      includeRemoved: true,
      pageSize: 1000,
      fields: 'nextPageToken,newStartPageToken,changes(changeType,removed,fileId,file(id,name,mimeType,size,parents,trashed,modifiedTime,starred,ownedByMe,shortcutDetails(targetId)))',
    })
    for (const change of page.data.changes ?? []) {
      if (change.changeType && change.changeType !== 'file') continue
      if (!change.fileId) continue
      const file = change.file
      changes.push({
        fileId: change.fileId,
        removed: Boolean(change.removed),
        file: file?.id && file.name && file.mimeType ? {
          id: file.id, name: file.name, mimeType: file.mimeType, size: file.size ?? null, parents: file.parents ?? [],
          trashed: Boolean(file.trashed), modifiedTime: file.modifiedTime ?? null, starred: Boolean(file.starred),
          ownedByMe: file.ownedByMe !== false, shortcutTargetId: file.shortcutDetails?.targetId ?? null,
        } : null,
      })
    }
    if (changes.length > 5000) return null
    newStartPageToken = page.data.newStartPageToken ?? newStartPageToken
    pageToken = page.data.nextPageToken
  }
  if (!newStartPageToken) return null

  const folders = await prisma.folder.findMany({ where: { connectedAccountId: account.id, deletedAt: null, providerFolderId: { not: null } }, select: { id: true, providerFolderId: true } })
  const folderByDriveId = new Map(folders.map((folder) => [folder.providerFolderId as string, folder.id]))
  if (changes.some((change) => change.file?.mimeType === googleDriveFolderMimeType || (change.removed && folderByDriveId.has(change.fileId)))) return null

  let rootId = driveRootIds.get(account.id)
  if (!rootId) {
    rootId = (await drive.files.get({ fileId: 'root', fields: 'id' })).data.id ?? undefined
    if (!rootId) return null
    driveRootIds.set(account.id, rootId)
  }

  // The last change of a file wins.
  const latest = new Map(changes.map((change) => [change.fileId, change]))
  const rows = await prisma.file.findMany({ where: { connectedAccountId: account.id, provider: 'google_drive', providerFileId: { in: [...latest.keys()] } } })
  const rowsByDriveId = new Map<string, typeof rows>()
  for (const row of rows) rowsByDriveId.set(row.providerFileId, [...(rowsByDriveId.get(row.providerFileId) ?? []), row])

  let created = 0
  let updated = 0
  let deleted = 0
  for (const [fileId, change] of latest) {
    const known = rowsByDriveId.get(fileId) ?? []
    const file = change.file
    if (change.removed || !file) {
      // Gone for good (deleted from Google's trash) or no longer visible to this account.
      if (known.length > 0) deleted += (await prisma.file.deleteMany({ where: { id: { in: known.map((row) => row.id) } } })).count
      continue
    }
    const base = {
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: BigInt(file.size ?? 0),
      starred: file.starred,
      shortcutTargetId: file.shortcutTargetId,
      ...(file.modifiedTime ? { createdAt: new Date(file.modifiedTime) } : {}),
    }
    const parentId = file.parents[0] ?? null
    let placement: { status: string; folderId: string | null; deletedAt: Date | null }
    if (file.trashed) placement = { status: 'deleted', folderId: known[0]?.folderId ?? null, deletedAt: known[0]?.deletedAt ?? new Date() }
    else if (!file.ownedByMe) placement = { status: 'outside', folderId: null, deletedAt: null }
    else if (parentId === rootId) placement = { status: 'active', folderId: null, deletedAt: null }
    else if (parentId && folderByDriveId.has(parentId)) placement = { status: 'active', folderId: folderByDriveId.get(parentId) ?? null, deletedAt: null }
    else placement = { status: 'outside', folderId: null, deletedAt: null }

    if (known.length === 0) {
      // Files outside My Drive or shared by others are not recorded, as in the full sync.
      if (placement.status === 'outside') continue
      await prisma.file.create({ data: { ...base, ...placement, userId: account.userId || userId, connectedAccountId: account.id, provider: 'google_drive', providerFileId: fileId } })
      created += 1
      continue
    }
    for (const row of known) {
      await prisma.file.update({ where: { id: row.id }, data: { ...base, ...placement } })
      if (placement.status === 'deleted' && row.status !== 'deleted') deleted += 1
      else updated += 1
    }
  }

  await prisma.connectedAccount.update({ where: { id: account.id }, data: { changesPageToken: newStartPageToken } })
  if (created + updated + deleted > 0) await syncGoogleQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}

async function syncGoogleAppFolderFilesUnlocked(accountId: string, userId: string): Promise<GoogleAppFolderSyncResult> {
  const account = await prisma.connectedAccount.findFirstOrThrow({
    where: {
      id: accountId,
      provider: 'google_drive',
      status: 'connected',
      OR: [{ userId }, { isShared: true }]
    }
  })
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  // My Drive in HCDrive mirrors Google's "My Drive": only items whose parent chain reaches the
  // account's root folder. Owned items elsewhere (inside folders shared by others, Computers
  // backups, files whose parent was removed) are not shown, the same as on drive.google.com.
  const rootFolder = await drive.files.get({ fileId: 'root', fields: 'id' })
  const rootId = rootFolder.data.id
  if (!rootId) throw new Error('Google Drive did not return the My Drive root folder id.')

  // 1. Sync folders from Google Drive so folder structure is mirrored into HCDrive.
  // A failed listing must abort the sync: an empty list would mark every folder as deleted.
  const listedFolders: Array<{ id: string; name: string; parentId: string | null }> = []
  let folderPageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `mimeType = '${googleDriveFolderMimeType}' and trashed = false and 'me' in owners`,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,parents)',
      pageSize: 1000,
      pageToken: folderPageToken,
    })
    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name) continue
      listedFolders.push({
        id: f.id,
        name: f.name,
        parentId: f.parents?.[0] ?? null
      })
    }
    folderPageToken = res.data.nextPageToken ?? undefined
  } while (folderPageToken)

  const listedFolderById = new Map(listedFolders.map((folder) => [folder.id, folder]))
  const inMyDrive = new Map<string, boolean>()
  function isInMyDrive(parentId: string | null): boolean {
    const chain: string[] = []
    let current = parentId
    let result = false
    while (current) {
      if (current === rootId) { result = true; break }
      const known = inMyDrive.get(current)
      if (known !== undefined) { result = known; break }
      const folder = listedFolderById.get(current)
      if (!folder || chain.includes(current)) break
      chain.push(current)
      current = folder.parentId
    }
    for (const id of chain) inMyDrive.set(id, result)
    return result
  }
  const driveFolders = listedFolders.filter((folder) => isInMyDrive(folder.id))

  const existingFolders = await prisma.folder.findMany({
    where: { userId, connectedAccountId: account.id, deletedAt: null },
    select: { id: true, parentId: true, providerFolderId: true }
  })

  // Detect folders deleted on Google Drive (or moved out of My Drive) and mark them deleted in HCDrive
  const driveFolderIds = new Set(driveFolders.map((f) => f.id))
  const missingFolderIds = existingFolders
    .filter((f) => f.providerFolderId && !driveFolderIds.has(f.providerFolderId))
    .map((f) => f.id)
  if (missingFolderIds.length > 0) {
    await prisma.folder.updateMany({
      where: { id: { in: missingFolderIds } },
      data: { deletedAt: new Date() }
    })
  }

  const folderByProviderId = new Map<string, { id: string; parentId: string | null }>()
  for (const f of existingFolders) {
    if (f.providerFolderId) folderByProviderId.set(f.providerFolderId, { id: f.id, parentId: f.parentId })
  }

  for (const df of driveFolders) {
    if (!folderByProviderId.has(df.id)) {
      try {
        const createdFolder = await prisma.folder.create({
          data: {
            userId,
            connectedAccountId: account.id,
            name: df.name,
            color: '#3b82f6',
            providerFolderId: df.id,
            parentId: null
          },
          select: { id: true, parentId: true }
        })
        folderByProviderId.set(df.id, { id: createdFolder.id, parentId: createdFolder.parentId })
      } catch {
        // Ignore duplicate / creation errors
      }
    }
  }

  for (const df of driveFolders) {
    const current = folderByProviderId.get(df.id)
    if (!current) continue
    // Every folder kept here is inside My Drive, so its parent is either the root or a mirrored folder.
    const parentId = df.parentId && df.parentId !== rootId ? folderByProviderId.get(df.parentId)?.id ?? null : null
    if (current.parentId !== parentId) {
      await prisma.folder.update({
        where: { id: current.id },
        data: { parentId }
      }).catch(() => undefined)
    }
  }

  const userFolders = await prisma.folder.findMany({
    where: { userId, connectedAccountId: account.id, deletedAt: null },
    select: { id: true, providerFolderId: true }
  })
  const folderIdMap = new Map<string, string>()
  for (const f of userFolders) {
    if (f.providerFolderId) folderIdMap.set(f.providerFolderId, f.id)
  }

  // 2. Fetch all active files owned by the user (strictly excluding shared files and trash)
  const driveFiles: DriveFileMetadata[] = []
  const outsideFileIds = new Set<string>()
  let pageToken: string | undefined
  const q = `mimeType != '${googleDriveFolderMimeType}' and trashed = false and 'me' in owners`

  do {
    const response = await drive.files.list({
      q,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,mimeType,size,parents,trashed,modifiedTime,starred,thumbnailLink,shortcutDetails(targetId))',
      pageSize: 1000,
      pageToken,
    })
    for (const file of response.data.files ?? []) {
      if (!file.id || !file.name || !file.mimeType) continue
      rememberThumbnailLink(file.id, file.thumbnailLink)
      const parentId = file.parents?.[0] ?? null
      if (parentId !== rootId && !(parentId && folderIdMap.has(parentId))) {
        outsideFileIds.add(file.id)
        continue
      }
      driveFiles.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: BigInt(file.size ?? 0),
        parentId: parentId ?? rootId,
        trashed: false,
        modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
        starred: Boolean(file.starred),
        shortcutTargetId: file.shortcutDetails?.targetId ?? null,
      })
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  // Owned files in Google Drive's trash. They are the HCDrive trash too: without this list they look
  // the same as files gone for good, and every sync used to delete the rows of trashed files.
  const trashedFiles = new Map<string, { name: string; mimeType: string; sizeBytes: bigint; trashedAt: Date | null; modifiedAt: Date | null }>()
  let trashPageToken: string | undefined
  do {
    const response = await drive.files.list({
      q: `mimeType != '${googleDriveFolderMimeType}' and trashed = true and 'me' in owners`,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,trashedTime)',
      pageSize: 1000,
      pageToken: trashPageToken,
    })
    for (const file of response.data.files ?? []) {
      if (!file.id || !file.name || !file.mimeType) continue
      trashedFiles.set(file.id, {
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: BigInt(file.size ?? 0),
        trashedAt: file.trashedTime ? new Date(file.trashedTime) : null,
        modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
      })
    }
    trashPageToken = response.data.nextPageToken ?? undefined
  } while (trashPageToken)

  const existingFiles = await mergeDuplicateFileRows(account.userId, await prisma.file.findMany({
    where: { connectedAccountId: account.id, provider: 'google_drive' },
    select: { id: true, userId: true, providerFileId: true, name: true, mimeType: true, sizeBytes: true, status: true, folderId: true, deletedAt: true, createdAt: true, starred: true }
  }))
  type ExistingFileRecord = {
    id: string
    providerFileId: string
    name: string
    mimeType: string
    sizeBytes: bigint
    status: string
    folderId: string | null
    deletedAt: Date | null
    createdAt: Date
    starred: boolean
  }
  const existingByProviderId = new Map<string, ExistingFileRecord>()
  for (const f of existingFiles) {
    existingByProviderId.set(f.providerFileId, f as ExistingFileRecord)
  }
  const driveFileIds = new Set(driveFiles.map((file) => file.id))
  let created = 0
  let updated = 0
  let deleted = 0

  for (const driveFile of driveFiles) {
    const dbFolderId = (driveFile.parentId && folderIdMap.has(driveFile.parentId)) ? (folderIdMap.get(driveFile.parentId) ?? null) : null
    const existing = existingByProviderId.get(driveFile.id)

    if (!existing) {
      await prisma.file.create({
        data: {
          userId: account.userId || userId,
          connectedAccountId: account.id,
          provider: 'google_drive',
          providerFileId: driveFile.id,
          name: driveFile.name,
          mimeType: driveFile.mimeType,
          sizeBytes: driveFile.sizeBytes,
          status: 'active',
          deletedAt: null,
          folderId: dbFolderId,
          starred: driveFile.starred,
          shortcutTargetId: driveFile.shortcutTargetId,
          ...(driveFile.modifiedAt ? { createdAt: driveFile.modifiedAt } : {}),
        },
      })
      created += 1
      continue
    }

    const needsUpdate =
      existing.name !== driveFile.name ||
      existing.mimeType !== driveFile.mimeType ||
      existing.sizeBytes !== driveFile.sizeBytes ||
      existing.status !== 'active' ||
      existing.folderId !== dbFolderId ||
      existing.starred !== driveFile.starred ||
      (driveFile.modifiedAt !== null && existing.createdAt.getTime() !== driveFile.modifiedAt.getTime())

    if (needsUpdate) {
      await prisma.file.update({
        where: { id: existing.id },
        data: {
          name: driveFile.name,
          mimeType: driveFile.mimeType,
          sizeBytes: driveFile.sizeBytes,
          status: 'active',
          deletedAt: null,
          folderId: dbFolderId,
          starred: driveFile.starred,
          shortcutTargetId: driveFile.shortcutTargetId,
          ...(driveFile.modifiedAt ? { createdAt: driveFile.modifiedAt } : {}),
        },
      })
      updated += 1
    }
  }

  // Any active file in HCDrive that is no longer returned as an active owned file on Google Drive:
  // (Either deleted on Google Drive, moved to Google Drive trash, or shared file that's not owned by me)
  // MUST be marked as deleted in HCDrive immediately!
  // Owned files that still exist but are outside My Drive are hidden (status 'outside'), not sent to the trash.
  const outsideIds = existingFiles.filter((file) => outsideFileIds.has(file.providerFileId) && file.status !== 'outside').map((file) => file.id)
  if (outsideIds.length > 0) {
    await prisma.file.updateMany({ where: { id: { in: outsideIds } }, data: { status: 'outside', folderId: null } })
  }

  // Gone from My Drive: into the HCDrive trash. Rows a live folder refresh marked 'outside' (the
  // file left the folder it was read from) follow when the file turns out to be in Google's trash.
  const missingActiveIds = existingFiles
    .filter((file) => !driveFileIds.has(file.providerFileId) && !outsideFileIds.has(file.providerFileId))
    .filter((file) => file.status === 'active' || (file.status === 'outside' && trashedFiles.has(file.providerFileId)))
    .map((file) => file.id)
  if (missingActiveIds.length > 0) {
    const result = await prisma.file.updateMany({ where: { id: { in: missingActiveIds } }, data: { status: 'deleted', deletedAt: new Date() } })
    deleted += result.count
  }

  // Trashed on drive.google.com but never seen by HCDrive (or trashed before it was connected).
  for (const [providerFileId, file] of trashedFiles) {
    if (existingByProviderId.has(providerFileId)) continue
    await prisma.file.create({
      data: {
        userId: account.userId || userId,
        connectedAccountId: account.id,
        provider: 'google_drive',
        providerFileId,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        status: 'deleted',
        deletedAt: file.trashedAt ?? new Date(),
        folderId: null,
        ...(file.modifiedAt ? { createdAt: file.modifiedAt } : {}),
      },
    }).then(() => { created += 1 }, () => undefined)
  }

  // Rows in the HCDrive trash whose file is gone from Google Drive altogether (trash emptied there).
  const purgedIds = existingFiles.filter((file) => file.status === 'deleted' && !driveFileIds.has(file.providerFileId) && !outsideFileIds.has(file.providerFileId) && !trashedFiles.has(file.providerFileId)).map((file) => file.id)
  if (purgedIds.length > 0) {
    await prisma.file.deleteMany({ where: { id: { in: purgedIds } } }).catch(() => undefined)
  }

  await syncGoogleQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}

const STATUS_RANK: Record<string, number> = { active: 0, outside: 1, deleted: 2 }

/**
 * One Drive file must be one row. Rows got doubled when a live folder read listed a file that an
 * upload had just put on Drive but not yet recorded, or when opening a file by its Google id made a
 * new row next to a hidden or trashed one. The doubles showed twice and inflated "files kept"
 * (1355 files, 11.58 GB against 5.94 GB used on Drive). This keeps one row per Drive id (the active
 * one, preferring the uploader's over the account owner's), moves share links, preview tokens and
 * invites to it, and deletes the rest.
 */
export async function mergeDuplicateFileRows<T extends { id: string; userId: string; providerFileId: string; status: string }>(accountOwnerId: string, rows: T[]): Promise<T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(row.providerFileId)
    if (group) group.push(row)
    else groups.set(row.providerFileId, [row])
  }
  const kept: T[] = []
  let removed = 0
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0])
      continue
    }
    group.sort((a, b) =>
      (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3)
      || Number(a.userId === accountOwnerId) - Number(b.userId === accountOwnerId)
      || a.id.localeCompare(b.id))
    const [keeper, ...extras] = group
    const extraIds = extras.map((row) => row.id)
    await prisma.fileShare.updateMany({ where: { fileId: { in: extraIds } }, data: { fileId: keeper.id } })
    await prisma.filePreviewToken.updateMany({ where: { fileId: { in: extraIds } }, data: { fileId: keeper.id } })
    for (const extraId of extraIds) {
      // An invite to the same person for the kept row may exist already (unique key); that one stays.
      await prisma.workspaceInvite.updateMany({ where: { targetType: 'file', targetId: extraId }, data: { targetId: keeper.id } }).catch(() => undefined)
    }
    await prisma.file.deleteMany({ where: { id: { in: extraIds } } })
    removed += extraIds.length
    kept.push(keeper)
  }
  if (removed > 0) console.log(`[sync] merged ${removed} duplicate file rows`)
  return kept
}

function formatBytesNumber(bytes: number | string | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === '') return '--'
  const n = Number(bytes)
  if (isNaN(n) || n === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export async function listGoogleDriveItems(
  account: ConnectedAccount,
  parentId: string = 'root',
  query?: string,
  pageToken?: string
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  if (parentId === '__shared_drives__') {
    const drivesRes = await drive.drives.list({
      pageSize: 100,
      fields: 'nextPageToken, drives(id, name)',
      pageToken: pageToken || undefined,
    })
    const items = (drivesRes.data.drives || []).map((d) => ({
      id: d.id,
      name: d.name || 'Shared Drive',
      mimeType: googleDriveFolderMimeType,
      size: null,
      sizeBytes: '0',
      modifiedTime: null,
      webViewLink: null,
      webContentLink: null,
      iconLink: null,
      thumbnailLink: null,
      parents: [],
      driveId: d.id,
      isSharedDriveRoot: true,
      isFolder: true,
      trashed: false,
    }))
    return { parentId, items, nextPageToken: drivesRes.data.nextPageToken || null }
  }

  let q = `'${parentId === 'root' ? 'root' : parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and trashed = false`
  if (parentId === 'root' && (!query || !query.trim())) {
    q += ` and 'me' in owners`
  }
  let corpora: 'user' | 'allDrives' | 'drive' = 'user'
  let driveId: string | undefined = undefined

  if (query && query.trim()) {
    const escaped = query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    q = `name contains '${escaped}' and trashed = false`
    corpora = 'allDrives'
  } else if (parentId !== 'root') {
    try {
      const parentMeta = await drive.files.get({
        fileId: parentId,
        fields: 'driveId',
        supportsAllDrives: true,
      })
      if (parentMeta.data.driveId) {
        driveId = parentMeta.data.driveId
        corpora = 'drive'
      }
    } catch {
      // Ignore if not in a shared drive
    }
  }

  const listParams: drive_v3.Params$Resource$Files$List = {
    q,
    pageSize: 200,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents, driveId, trashed)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'folder,name_natural',
    pageToken: pageToken || undefined,
    ...(corpora === 'allDrives' ? { corpora: 'allDrives' } : {}),
    ...(driveId ? { corpora: 'drive', driveId } : {}),
  }

  const res = await drive.files.list(listParams)
  const items = (res.data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? formatBytesNumber(f.size) : (f.mimeType === googleDriveFolderMimeType ? '--' : '0 B'),
    sizeBytes: f.size || '0',
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
    webContentLink: f.webContentLink || null,
    iconLink: f.iconLink || null,
    thumbnailLink: f.thumbnailLink || null,
    parents: f.parents || [],
    driveId: f.driveId || null,
    isFolder: f.mimeType === googleDriveFolderMimeType,
    trashed: Boolean(f.trashed),
  }))

  return { parentId, items, nextPageToken: res.data.nextPageToken || null }
}

export async function createGoogleDriveFolder(
  account: ConnectedAccount,
  name: string,
  parentId: string = 'root'
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  const hasParent = parentId && parentId !== 'root' && parentId !== '__shared_drives__'
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: googleDriveFolderMimeType,
      ...(hasParent ? { parents: [parentId] } : {}),
    },
    fields: 'id, name, mimeType, modifiedTime, webViewLink, parents, driveId',
    supportsAllDrives: true,
  })
  return res.data
}

export async function deleteGoogleDriveItem(
  account: ConnectedAccount,
  fileId: string,
  permanent: boolean = false
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  if (permanent) {
    await drive.files.delete({
      fileId,
      supportsAllDrives: true,
    })
  } else {
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    })
  }
  return { status: 'ok' }
}

export async function getGoogleDriveFileMetadata(
  account: ConnectedAccount,
  fileId: string
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, parents, driveId, trashed',
    supportsAllDrives: true,
  })
  return res.data
}

export async function listGoogleDriveSharedWithMe(
  account: ConnectedAccount,
  pageToken?: string
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  const res = await drive.files.list({
    q: 'sharedWithMe = true and trashed = false',
    pageSize: 100,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, owners, sharedWithMeTime)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'sharedWithMeTime desc',
    pageToken: pageToken || undefined,
  })

  const items = (res.data.files || []).map((f) => {
    const owner = f.owners?.[0]
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? formatBytesNumber(f.size) : (f.mimeType === googleDriveFolderMimeType ? '--' : '0 B'),
      sizeBytes: f.size || '0',
      modifiedTime: f.modifiedTime,
      sharedWithMeTime: f.sharedWithMeTime || f.modifiedTime,
      ownerName: owner?.displayName || owner?.emailAddress || 'Người khác',
      ownerEmail: owner?.emailAddress || null,
      accountEmail: account.email,
      accountId: account.id,
      webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
      webContentLink: f.webContentLink || null,
      iconLink: f.iconLink || null,
      thumbnailLink: f.thumbnailLink || null,
      isFolder: f.mimeType === googleDriveFolderMimeType,
    }
  })

  return { items, nextPageToken: res.data.nextPageToken || null }
}

export async function listGoogleDriveSharedByMe(
  account: ConnectedAccount,
  pageToken?: string
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  const res = await drive.files.list({
    q: "'me' in owners and trashed = false and shared = true",
    pageSize: 100,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, shared, permissions(displayName, emailAddress, role, type))',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'modifiedTime desc',
    pageToken: pageToken || undefined,
  })

  const items = (res.data.files || []).map((f) => {
    const recipients = (f.permissions || [])
      .filter((p) => p.role !== 'owner')
      .map((p) => p.displayName || p.emailAddress || (p.type === 'anyone' ? 'Bất kỳ ai có liên kết' : 'Thành viên'))
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? formatBytesNumber(f.size) : (f.mimeType === googleDriveFolderMimeType ? '--' : '0 B'),
      sizeBytes: f.size || '0',
      modifiedTime: f.modifiedTime,
      sharedWith: recipients.slice(0, 3).join(', ') + (recipients.length > 3 ? ` +${recipients.length - 3}` : ''),
      accountEmail: account.email,
      accountId: account.id,
      webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
      webContentLink: f.webContentLink || null,
      iconLink: f.iconLink || null,
      thumbnailLink: f.thumbnailLink || null,
      isFolder: f.mimeType === googleDriveFolderMimeType,
    }
  })

  return { items, nextPageToken: res.data.nextPageToken || null }
}

export async function listGoogleDriveStarred(
  account: ConnectedAccount,
  pageToken?: string
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  const res = await drive.files.list({
    q: "starred = true and trashed = false and 'me' in owners",
    pageSize: 100,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, starred)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'modifiedTime desc',
    pageToken: pageToken || undefined,
  })

  const items = (res.data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? formatBytesNumber(f.size) : (f.mimeType === googleDriveFolderMimeType ? '--' : '0 B'),
    sizeBytes: f.size || '0',
    modifiedTime: f.modifiedTime,
    starred: true,
    accountEmail: account.email,
    accountId: account.id,
    webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
    webContentLink: f.webContentLink || null,
    iconLink: f.iconLink || null,
    thumbnailLink: f.thumbnailLink || null,
    isFolder: f.mimeType === googleDriveFolderMimeType,
  }))

  return { items, nextPageToken: res.data.nextPageToken || null }
}

export async function toggleGoogleDriveStar(
  account: ConnectedAccount,
  fileId: string,
  starred: boolean
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  const res = await drive.files.update({
    fileId,
    requestBody: { starred },
    fields: 'id, starred',
    supportsAllDrives: true,
  })
  return res.data
}

export async function listGoogleDriveRecent(
  account: ConnectedAccount,
  limit: number = 50
) {
  const proxyUrl = getAccountProxyUrl(account)
  const auth = await getAuthedGoogleClient(account)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  const res = await drive.files.list({
    q: "trashed = false and 'me' in owners",
    pageSize: limit,
    fields: 'files(id, name, mimeType, size, modifiedTime, viewedByMeTime, webViewLink, webContentLink, iconLink, thumbnailLink)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'viewedByMeTime desc, modifiedTime desc',
  })

  const items = (res.data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? formatBytesNumber(f.size) : (f.mimeType === googleDriveFolderMimeType ? '--' : '0 B'),
    sizeBytes: f.size || '0',
    modifiedTime: f.modifiedTime,
    viewedByMeTime: f.viewedByMeTime || f.modifiedTime,
    accountEmail: account.email,
    accountId: account.id,
    webViewLink: f.webViewLink || (f.id ? `https://drive.google.com/file/d/${f.id}/view` : null),
    webContentLink: f.webContentLink || null,
    iconLink: f.iconLink || null,
    thumbnailLink: f.thumbnailLink || null,
    isFolder: f.mimeType === googleDriveFolderMimeType,
  }))

  return { items }
}

export async function getAccountCookie(account: { id?: string; cookieEncrypted?: string | null }): Promise<string | null> {
  if (account.cookieEncrypted) {
    try {
      const decrypted = decryptText(account.cookieEncrypted)
      if (decrypted && decrypted.trim()) return decrypted.trim()
    } catch (e) {
      console.warn(`[google.service] Failed to decrypt cookie for account ${account.id}:`, e)
    }
  }
  // System-wide fallback from environment variable
  if (process.env.GOOGLE_DRIVE_COOKIE && process.env.GOOGLE_DRIVE_COOKIE.trim()) {
    return process.env.GOOGLE_DRIVE_COOKIE.trim()
  }
  // System-wide fallback from system settings table
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'google_drive_cookie' } })
    if (setting?.value && setting.value.trim()) return setting.value.trim()
  } catch {}
  return null
}




