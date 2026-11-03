import type { ConnectedAccount } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from '../google/google.service.js'
import { getAccountProxyUrl } from '../../utils/proxy.js'
import { withAccountLock } from '../../utils/account-lock.js'
import { googlePausedFor, noteGoogleError } from '../../utils/google-backoff.js'
import { rememberThumbnailLink } from '../../utils/thumbnail-cache.js'
import { buildMergedFolders, loadVisibleFolders } from './merged-folders.js'

const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'

type LiveItem = { id: string; name: string; mimeType: string; size: bigint; modifiedTime: Date | null; starred: boolean; shortcutTargetId: string | null }

async function listLiveChildren(account: ConnectedAccount, providerParentId: string): Promise<LiveItem[]> {
  const drive = getGoogleDriveClient(await getAuthedGoogleClient(account), getAccountProxyUrl(account))
  const parent = providerParentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  // The My Drive root only holds the account's own items; inside folders, items others added are shown too (as on drive.google.com).
  const q = `'${parent}' in parents and trashed = false${providerParentId === 'root' ? " and 'me' in owners" : ''}`
  const items: LiveItem[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, starred, thumbnailLink, shortcutDetails(targetId))',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    })
    for (const file of res.data.files ?? []) {
      if (!file.id || !file.name || !file.mimeType) continue
      rememberThumbnailLink(file.id, file.thumbnailLink)
      items.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: BigInt(file.size ?? 0),
        modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
        starred: Boolean(file.starred),
        shortcutTargetId: file.shortcutDetails?.targetId ?? null,
      })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return items
}

/**
 * Reads one merged My Drive folder (or the root) straight from Google Drive in every account and
 * brings the database rows for its direct children in line, so the page shows exactly what Drive has
 * without waiting for a full sync. Returns whether anything changed.
 */
export async function refreshMergedFolderLive(userId: string, folderId: string | null): Promise<{ changed: boolean; errors: string[] }> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { provider: 'google_drive', status: 'connected', OR: [{ userId }, { isShared: true }] },
  })

  // Which Drive folder to read in each account, and the database folder its children belong to.
  let targets: Array<{ account: ConnectedAccount; providerParentId: string; dbParentId: string | null }>
  if (!folderId) {
    targets = accounts.map((account) => ({ account, providerParentId: 'root', dbParentId: null }))
  } else {
    const members = buildMergedFolders(await loadVisibleFolders(userId)).members(folderId)
    targets = members.flatMap((member) => {
      const account = accounts.find((candidate) => candidate.id === member.connectedAccountId)
      return account && member.providerFolderId ? [{ account, providerParentId: member.providerFolderId, dbParentId: member.id }] : []
    })
  }

  let changed = false
  const errors: string[] = []
  await Promise.all(targets.map(({ account, providerParentId, dbParentId }) => withAccountLock(account.id, async () => {
    let live: LiveItem[]
    // Rate limited a moment ago: show the saved copy instead of asking Google again.
    if (googlePausedFor(account.id) > 0) return
    try {
      live = await listLiveChildren(account, providerParentId)
    } catch (error) {
      noteGoogleError(account.id, error)
      // One unreachable account must not hide the others; its rows are left untouched.
      errors.push(`${account.email}: ${error instanceof Error ? error.message : 'list failed'}`)
      return
    }
    const ownerId = account.userId || userId
    const liveFolders = live.filter((item) => item.mimeType === googleDriveFolderMimeType)
    const liveFiles = live.filter((item) => item.mimeType !== googleDriveFolderMimeType)

    // Folders
    const knownFolders = await prisma.folder.findMany({
      where: { connectedAccountId: account.id, providerFolderId: { in: liveFolders.map((item) => item.id) } },
      select: { id: true, name: true, parentId: true, providerFolderId: true, deletedAt: true },
    })
    for (const item of liveFolders) {
      const known = knownFolders.find((folder) => folder.providerFolderId === item.id)
      if (!known) {
        await prisma.folder.create({ data: { userId: ownerId, connectedAccountId: account.id, name: item.name, color: '#3b82f6', providerFolderId: item.id, parentId: dbParentId } })
        changed = true
      } else if (known.name !== item.name || known.parentId !== dbParentId || known.deletedAt) {
        await prisma.folder.update({ where: { id: known.id }, data: { name: item.name, parentId: dbParentId, deletedAt: null } })
        changed = true
      }
    }
    // Folders recorded here that Drive no longer has in this place were moved or deleted.
    const goneFolders = await prisma.folder.updateMany({
      where: { connectedAccountId: account.id, parentId: dbParentId, deletedAt: null, providerFolderId: { not: null, notIn: liveFolders.map((item) => item.id) } },
      data: { deletedAt: new Date() },
    })
    if (goneFolders.count > 0) changed = true

    // Files
    const knownFiles = await prisma.file.findMany({
      where: { connectedAccountId: account.id, provider: 'google_drive', providerFileId: { in: liveFiles.map((item) => item.id) } },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, folderId: true, status: true, createdAt: true, providerFileId: true, starred: true },
    })
    for (const item of liveFiles) {
      const known = knownFiles.find((file) => file.providerFileId === item.id)
      const modified = item.modifiedTime ? { createdAt: item.modifiedTime } : {}
      if (!known) {
        await prisma.file.create({ data: { userId: ownerId, connectedAccountId: account.id, provider: 'google_drive', providerFileId: item.id, name: item.name, mimeType: item.mimeType, sizeBytes: item.size, folderId: dbParentId, status: 'active', starred: item.starred, shortcutTargetId: item.shortcutTargetId, ...modified } })
        changed = true
      } else if (
        known.name !== item.name ||
        known.mimeType !== item.mimeType ||
        known.sizeBytes !== item.size ||
        known.folderId !== dbParentId ||
        known.status !== 'active' ||
        known.starred !== item.starred ||
        (item.modifiedTime && known.createdAt.getTime() !== item.modifiedTime.getTime())
      ) {
        await prisma.file.update({ where: { id: known.id }, data: { name: item.name, mimeType: item.mimeType, sizeBytes: item.size, folderId: dbParentId, status: 'active', deletedAt: null, starred: item.starred, shortcutTargetId: item.shortcutTargetId, ...modified } })
        changed = true
      }
    }
    // Active files recorded here that Drive no longer has in this place: hidden until the next full sync finds them.
    const goneFiles = await prisma.file.updateMany({
      where: { connectedAccountId: account.id, provider: 'google_drive', folderId: dbParentId, status: 'active', providerFileId: { notIn: liveFiles.map((item) => item.id) } },
      data: { status: 'outside' },
    })
    if (goneFiles.count > 0) changed = true
  })))

  return { changed, errors }
}
