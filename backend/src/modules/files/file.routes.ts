import { Router } from 'express'
import type { ConnectedAccount, File } from '@prisma/client'
import { google } from 'googleapis'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { createDriveClientCache, isDriveNotFound, getAuthedGoogleClient, getGoogleDriveClient, getGoogleDriveFileMetadata, listGoogleDriveSharedWithMe, listGoogleDriveSharedByMe, toggleGoogleDriveStar, listGoogleDriveRecent, syncGoogleAppFolderFiles, syncGoogleQuota } from '../google/google.service.js'
import { deleteS3Object, syncS3Quota, createS3Client, getS3ConfigForAccount } from '../s3/s3.service.js'
import { streamProviderFile } from './stream-file.js'
import { googleDownloadExportMimeTypes, normalizeHeaders, withExtension } from './stream-google-file.js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { createAuditLog } from '../../utils/audit.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { buildMergedFolders, ensureAccountFolderPath, loadVisibleFolders, moveDriveItem } from '../folders/merged-folders.js'
import { mountDrivePermissionRoutes, shareError } from '../google/drive-sharing.js'
import { searchKey } from '../../utils/search.js'
import { mapLimit } from '../../utils/concurrency.js'
import { ownedBy, requireOwned, type OwnedRequest } from '../../middleware/ownership.js'
import { exportExtension, mountDriveFeatureRoutes, thumbnailUrlFor } from '../google/drive-features.js'
import { copySingleFile } from './cross-account-copy.js'
import { getCacheProgress } from '../../services/temp-cache.service.js'



export const fileRouter = Router()

// Google Drive calls in flight at once for batch trash/restore/delete; the Drive client retries 403 rate limits.
const DRIVE_BATCH_CONCURRENCY = 8

fileRouter.get('/preview/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token)
    const preview = await prisma.filePreviewToken.findFirst({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
      include: { file: { include: { connectedAccount: true } } },
    })
    if (!preview || preview.file.status !== 'active') return res.status(404).json({ code: 'PREVIEW_NOT_FOUND', message: 'Preview token not found.' })
    return streamProviderFile(preview.file, req.headers.range, res, { disposition: 'inline' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/preview-progress/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token)
    const preview = await prisma.filePreviewToken.findFirst({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
      include: { file: true },
    })
    if (!preview || preview.file.status !== 'active') return res.status(404).json({ code: 'PREVIEW_NOT_FOUND', message: 'Preview token not found.' })
    return res.json(getCacheProgress(preview.file.providerFileId || preview.file.id))
  } catch (error) {
    return next(error)
  }
})

fileRouter.use(requireAuth)

fileRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({
      folderId: z.string().optional(),
      q: z.string().trim().max(255).optional(),
      kind: z.enum(['image', 'video', 'pdf', 'doc', 'sheet', 'slide', 'archive', 'folder']).optional(),
      accountId: z.string().optional(),
      minSize: z.coerce.number().optional(),
      maxSize: z.coerce.number().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      sort: z.enum(['name', 'modified', 'size', 'createdAt']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
      // scope=all lists every folder (the Storage page's "largest files"); without it and without
      // filters the root is listed.
      scope: z.enum(['all']).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
      // content=1: also match text inside the files (Google's full-text index), not only names.
      content: z.enum(['1']).optional(),
    }).parse(req.query)

    let mimeTypeCondition: any = undefined
    if (query.kind === 'folder') {
      mimeTypeCondition = { in: ['__never_matches__'] }
    } else if (query.kind === 'image') {
      mimeTypeCondition = { startsWith: 'image/' }
    } else if (query.kind === 'video') {
      mimeTypeCondition = { startsWith: 'video/' }
    } else if (query.kind === 'pdf') {
      mimeTypeCondition = 'application/pdf'
    } else if (query.kind === 'doc') {
      mimeTypeCondition = {
        in: [
          'application/vnd.google-apps.document',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'text/markdown',
          'text/html'
        ]
      }
    } else if (query.kind === 'sheet') {
      mimeTypeCondition = {
        in: [
          'application/vnd.google-apps.spreadsheet',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv'
        ]
      }
    } else if (query.kind === 'slide') {
      mimeTypeCondition = {
        in: [
          'application/vnd.google-apps.presentation',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ]
      }
    } else if (query.kind === 'archive') {
      mimeTypeCondition = {
        in: [
          'application/zip',
          'application/x-zip-compressed',
          'application/x-rar-compressed',
          'application/x-tar',
          'application/x-7z-compressed',
          'application/gzip'
        ]
      }
    }

    // My Drive merges all accounts: a folder shows the files of every account's folder with the same
    // name path, and the root shows files with no folder or whose folder no longer exists.
    let targetFolderWhere: any = {}
    // Searching or filtering without a folder looks through every folder.
    const isFiltering = Boolean(query.q || query.kind || query.accountId || query.minSize !== undefined || query.maxSize !== undefined || query.startDate || query.endDate)
    const atRoot = query.folderId === 'root' || query.folderId === 'null' || (!query.folderId && !isFiltering && !query.scope)
    if (atRoot) {
      targetFolderWhere = { OR: [{ folderId: null }, { folder: { deletedAt: { not: null } } }] }
    } else if (query.folderId) {
      const merged = buildMergedFolders(await loadVisibleFolders(req.user!.id))
      targetFolderWhere = { folderId: { in: merged.memberIds(query.folderId) } }
    }

    const where: any = {
      status: 'active',
      connectedAccount: { status: 'connected' },
      AND: [
        { OR: [{ userId: req.user!.id }, { connectedAccount: { isShared: true } }] },
        targetFolderWhere,
      ],
      ...(query.accountId ? { connectedAccountId: query.accountId } : {}),
      ...(mimeTypeCondition ? { mimeType: mimeTypeCondition } : {}),
      ...(query.minSize !== undefined || query.maxSize !== undefined ? {
        sizeBytes: {
          ...(query.minSize !== undefined ? { gte: BigInt(query.minSize) } : {}),
          ...(query.maxSize !== undefined ? { lte: BigInt(query.maxSize) } : {})
        }
      } : {}),
      ...(query.startDate || query.endDate ? {
        createdAt: {
          ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
          ...(query.endDate ? { lte: new Date(query.endDate) } : {})
        }
      } : {})
    }

    let orderBy: any = { createdAt: 'desc' }
    if (query.sort === 'size') {
      orderBy = { sizeBytes: query.order === 'asc' ? 'asc' : 'desc' }
    } else if (query.sort === 'name') {
      orderBy = { name: query.order === 'desc' ? 'desc' : 'asc' }
    } else if (query.sort === 'modified' || query.sort === 'createdAt') {
      orderBy = { createdAt: query.order === 'asc' ? 'asc' : 'desc' }
    }

    const found = await prisma.file.findMany({
      where,
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy,
      ...(query.limit && !query.q ? { take: query.limit } : {})
    })
    // The name is matched here rather than in SQL so the search ignores case and accents (see utils/search.ts).
    const needle = query.q ? searchKey(query.q) : ''
    let matching = needle ? found.filter((file) => searchKey(file.name).includes(needle)) : found
    if (query.q && query.content) {
      const inContent = await searchDriveContent(req.user!.id, query.q, query.accountId)
      if (inContent.size > 0) {
        const already = new Set(matching.map((file) => file.id))
        matching = [...matching, ...found.filter((file) => !already.has(file.id) && inContent.has(file.providerFileId))]
      }
    }
    const files = query.limit ? matching.slice(0, query.limit) : matching
    return res.json({
      files: files.map((file) => ({
        ...file,
        sizeBytes: file.sizeBytes.toString(),
        webViewLink: file.provider === 'google_drive' ? `https://drive.google.com/file/d/${file.providerFileId}/view` : null,
        thumbnailUrl: thumbnailUrlFor(file),
      }))
    })
  } catch (error) {
    return next(error)
  }
})

const batchFileSchema = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(100) })

// Google Drive ids whose text (inside PDFs, Docs, images with words) matches, from each visible
// Google account. One request per account; an unreachable account is skipped.
async function searchDriveContent(userId: string, text: string, accountId?: string) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { provider: 'google_drive', status: 'connected', OR: [{ userId }, { isShared: true }], ...(accountId ? { id: accountId } : {}) },
  })
  const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const ids = new Set<string>()
  const driveFor = createDriveClientCache()
  await Promise.all(accounts.map(async (account) => {
    try {
      const drive = await driveFor(account)
      const list = await drive.files.list({ q: `fullText contains '${escaped}' and trashed = false`, fields: 'files(id)', pageSize: 200, spaces: 'drive' })
      for (const item of list.data.files ?? []) if (item.id) ids.add(item.id)
    } catch (error) {
      console.warn(`[search] full-text search failed for ${account.email}:`, error instanceof Error ? error.message : error)
    }
  }))
  return ids
}

// Google files also move on Drive (into that account's copy of the merged folder, created if needed);
// otherwise the next sync would put them back where Drive has them.
async function moveFileToFolder(userId: string, file: File & { connectedAccount: ConnectedAccount }, folderId: string | null) {
  if (file.provider !== 'google_drive') {
    await prisma.file.update({ where: { id: file.id }, data: { folderId } })
    return
  }
  const drive = getGoogleDriveClient(await getAuthedGoogleClient(file.connectedAccount), getAccountProxyUrl(file.connectedAccount))
  let targetFolderId: string | null = null
  let targetProviderFolderId = 'root'
  if (folderId) {
    const target = await ensureAccountFolderPath(userId, file.connectedAccountId, drive, folderId)
    if (!target) throw Object.assign(new Error('Folder not found.'), { status: 404, code: 'FOLDER_NOT_FOUND' })
    targetFolderId = target.folderId
    targetProviderFolderId = target.providerFolderId
  }
  await moveDriveItem(drive, file.providerFileId, targetProviderFolderId)
  await prisma.file.update({ where: { id: file.id }, data: { folderId: targetFolderId } })
}

fileRouter.patch('/batch', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.extend({ folderId: z.string().nullable().optional() }).parse(req.body)
    if (body.folderId) await prisma.folder.findFirstOrThrow({ where: { id: body.folderId, userId: req.user!.id, deletedAt: null } })
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' }, include: { connectedAccount: true } })
    for (const file of files) await moveFileToFolder(req.user!.id, file, body.folderId ?? null)
    await createAuditLog(req.user!.id, 'MOVE_FILES', 'file', undefined, { count: files.length, folderId: body.folderId })
    return res.json({ status: 'ok', moved: files.length })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/batch', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' },
      include: { connectedAccount: true }
    })

    // Several files at a time, one Drive client per account (files one by one took seconds each).
    const driveFor = createDriveClientCache()
    await mapLimit(files, DRIVE_BATCH_CONCURRENCY, async (file) => {
      if (file.provider !== 'google_drive' || !file.connectedAccount) return
      try {
        const drive = await driveFor(file.connectedAccount)
        await drive.files.update({ fileId: file.providerFileId, requestBody: { trashed: true }, supportsAllDrives: true })
      } catch (err: any) {
        console.warn(`Failed to trash file ${file.providerFileId} on Google Drive:`, err.message || err)
      }
    })

    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' },
      data: { status: 'deleted', deletedAt: new Date() }
    })
    for (const f of files) {
      await createAuditLog(req.user!.id, 'TRASH_FILE', 'file', f.id, { name: f.name })
    }
    return res.json({ status: 'ok', deleted: result.count })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/trash', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ q: z.string().trim().max(255).optional() }).parse(req.query)
    const files = await prisma.file.findMany({
      where: {
        userId: req.user!.id,
        status: 'deleted',
        ...(query.q ? { name: { contains: query.q } } : {})
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { deletedAt: 'desc' }
    })
    return res.json({ files: files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })) })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/batch/restore', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' },
      include: { connectedAccount: true }
    })

    const driveFor = createDriveClientCache()
    await mapLimit(files, DRIVE_BATCH_CONCURRENCY, async (file) => {
      if (file.provider !== 'google_drive' || !file.connectedAccount) return
      try {
        const drive = await driveFor(file.connectedAccount)
        await drive.files.update({ fileId: file.providerFileId, requestBody: { trashed: false }, supportsAllDrives: true })
      } catch (err: any) {
        console.warn(`Failed to untrash file ${file.providerFileId} on Google Drive:`, err.message || err)
      }
    })

    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' },
      data: { status: 'active', deletedAt: null }
    })
    for (const f of files) {
      await createAuditLog(req.user!.id, 'RESTORE_FILE', 'file', f.id, { name: f.name })
    }
    return res.json({ status: 'ok', restored: result.count })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/batch/permanent', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' },
      include: { connectedAccount: true }
    })
    const deletedIds: string[] = []
    const syncedAccountIds = new Set<string>()
    const failed: Array<{ fileId: string; message: string }> = []

    const driveFor = createDriveClientCache()
    await mapLimit(files, DRIVE_BATCH_CONCURRENCY, async (file) => {
      try {
        if (file.provider === 's3') {
          await deleteS3Object(file)
        } else {
          const drive = await driveFor(file.connectedAccount)
          // Already gone on Google (trash emptied there): only the row is left to remove.
          await drive.files.delete({ fileId: file.providerFileId, supportsAllDrives: true }).catch((error) => {
            if (!isDriveNotFound(error)) throw error
          })
        }
        deletedIds.push(file.id)
        syncedAccountIds.add(file.connectedAccountId)
      } catch (error) {
        failed.push({ fileId: file.id, message: error instanceof Error ? error.message : 'Delete failed' })
      }
    })

    if (deletedIds.length > 0) {
      await prisma.file.deleteMany({
        where: { id: { in: deletedIds }, userId: req.user!.id }
      })
    }
    const deletedSet = new Set(deletedIds)
    for (const file of files) {
      if (deletedSet.has(file.id)) await createAuditLog(req.user!.id, 'PERMANENT_DELETE_FILE', 'file', file.id, { name: file.name })
    }

    await Promise.all([...syncedAccountIds].map((accountId) => {
      const account = files.find((file) => file.connectedAccountId === accountId)?.connectedAccount
      return (account?.provider === 's3' ? syncS3Quota(accountId) : syncGoogleQuota(accountId)).catch(() => undefined)
    }))

    if (deletedIds.length === 0 && failed.length > 0) {
      return res.status(400).json({ code: 'FILES_DELETE_FAILED', message: 'No files were permanently deleted.', deleted: 0, failed })
    }
    return res.json({ status: 'ok', deleted: deletedIds.length, failed })
  } catch (error) {
    return next(error)
  }
})

function getShareBaseUrl(req: AuthRequest): string {
  const host = req.get('host')
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return `${req.protocol}://${host}`
  }
  return env.FRONTEND_URL
}

fileRouter.get('/shared-links', async (req: AuthRequest, res, next) => {
  try {
    const baseUrl = getShareBaseUrl(req)
    const shares = await prisma.fileShare.findMany({
      where: { userId: req.user!.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { file: { include: { connectedAccount: { select: { email: true, provider: true } }, folder: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({
      shares: shares.filter((share) => share.file.status === 'active').map((share) => {
        const url = share.token ? `${baseUrl}/public/files/${share.token}` : null
        return {
          id: share.id,
          url,
          createdAt: share.createdAt.toISOString(),
          expiresAt: share.expiresAt?.toISOString() ?? null,
          file: { ...share.file, sizeBytes: share.file.sizeBytes.toString() },
        }
      })
    })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/shared-with-me', async (req: AuthRequest, res, next) => {
  try {
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: 'google_drive',
        status: 'connected',
        OR: [{ userId: req.user!.id }, { isShared: true }],
        ...(accountId ? { id: accountId } : {}),
      },
    })

    const results = await Promise.allSettled(
      accounts.map((acc) => listGoogleDriveSharedWithMe(acc))
    )

    const allItems: any[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.items) {
        allItems.push(...r.value.items)
      }
    }

    // Sort newest shared first
    allItems.sort((a, b) => {
      const timeA = new Date(a.sharedWithMeTime || a.modifiedTime || 0).getTime()
      const timeB = new Date(b.sharedWithMeTime || b.modifiedTime || 0).getTime()
      return timeB - timeA
    })

    return res.json({ items: allItems })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/shared-by-me', async (req: AuthRequest, res, next) => {
  try {
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: 'google_drive',
        status: 'connected',
        OR: [{ userId: req.user!.id }, { isShared: true }],
        ...(accountId ? { id: accountId } : {}),
      },
    })

    const results = await Promise.allSettled(
      accounts.map((acc) => listGoogleDriveSharedByMe(acc))
    )

    const allItems: any[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.items) {
        allItems.push(...r.value.items)
      }
    }

    // Google returns its own ids; sharing is managed through HCDrive ids, so attach them where the item is known.
    const googleIds = allItems.map((item) => item.id).filter(Boolean)
    if (googleIds.length > 0) {
      const [knownFiles, knownFolders] = await Promise.all([
        prisma.file.findMany({ where: { providerFileId: { in: googleIds }, status: { not: 'deleted' } }, select: { id: true, providerFileId: true, connectedAccountId: true } }),
        prisma.folder.findMany({ where: { providerFolderId: { in: googleIds }, deletedAt: null }, select: { id: true, providerFolderId: true, connectedAccountId: true } }),
      ])
      const fileIdByKey = new Map(knownFiles.map((f) => [`${f.connectedAccountId}:${f.providerFileId}`, f.id]))
      const folderIdByKey = new Map(knownFolders.map((f) => [`${f.connectedAccountId}:${f.providerFolderId}`, f.id]))
      for (const item of allItems) {
        const key = `${item.accountId}:${item.id}`
        item.providerFileId = item.id
        const id = (item.isFolder ? folderIdByKey.get(key) : fileIdByKey.get(key)) ?? null
        item.hcdriveId = id
        item.ninedriveId = id
      }
    }

    // Also include HCDrive public share links
    const baseUrl = getShareBaseUrl(req)
    const dbShares = await prisma.fileShare.findMany({
      where: { userId: req.user!.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { file: { include: { connectedAccount: { select: { email: true, provider: true } } } } },
    })

    for (const s of dbShares) {
      if (s.file.status === 'active') {
        allItems.push({
          id: s.file.id,
          hcdriveId: s.file.id,
          ninedriveId: s.file.id,
          providerFileId: s.file.providerFileId,
          name: s.file.name,
          mimeType: s.file.mimeType,
          size: `${(Number(s.file.sizeBytes) / 1024 / 1024).toFixed(1)} MB`,
          sizeBytes: s.file.sizeBytes.toString(),
          modifiedTime: s.file.createdAt.toISOString(),
          sharedWith: 'HCDrive Public Link',
          accountEmail: s.file.connectedAccount?.email || 'HCDrive',
          accountId: s.file.connectedAccountId,
          webViewLink: `${baseUrl}/public/files/${s.token}`,
          webContentLink: `${baseUrl}/public/files/${s.token}/download`,
          isFolder: false,
        })
      }
    }

    allItems.sort((a, b) => {
      const timeA = new Date(a.modifiedTime || 0).getTime()
      const timeB = new Date(b.modifiedTime || 0).getTime()
      return timeB - timeA
    })

    return res.json({ items: allItems })
  } catch (error) {
    return next(error)
  }
})

// Starred files of every provider. Stars on Google Drive files come in with each sync and folder refresh.
fileRouter.get('/starred', async (req: AuthRequest, res, next) => {
  try {
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined
    const files = await prisma.file.findMany({
      where: {
        starred: true,
        status: 'active',
        connectedAccount: { status: 'connected' },
        OR: [{ userId: req.user!.id }, { connectedAccount: { isShared: true } }],
        ...(accountId ? { connectedAccountId: accountId } : {}),
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })
    return res.json({
      files: files.map((file) => ({
        id: file.id,
        providerFileId: file.providerFileId,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes.toString(),
        modifiedTime: file.createdAt.toISOString(),
        starredTime: file.updatedAt.toISOString(),
        accountEmail: file.connectedAccount.email,
        accountId: file.connectedAccountId,
        provider: file.provider,
        folderId: file.folderId,
        folderName: file.folder?.name ?? null,
        webViewLink: file.provider === 'google_drive' ? `https://drive.google.com/file/d/${file.providerFileId}/view` : null,
        starred: true,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/recent', async (req: AuthRequest, res, next) => {
  try {
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: 'google_drive',
        status: 'connected',
        OR: [{ userId: req.user!.id }, { isShared: true }],
      },
    })

    const results = await Promise.allSettled(
      accounts.map((acc) => listGoogleDriveRecent(acc, 50))
    )

    const allItems: any[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.items) {
        allItems.push(...r.value.items)
      }
    }

    // Also get active database files
    const dbFiles = await prisma.file.findMany({
      where: {
        status: 'active',
        connectedAccount: { status: 'connected' },
        OR: [{ userId: req.user!.id }, { connectedAccount: { isShared: true } }],
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const existingIds = new Set(allItems.map((i) => i.id))
    for (const f of dbFiles) {
      if (!existingIds.has(f.providerFileId) && !existingIds.has(f.id)) {
        allItems.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: `${(Number(f.sizeBytes) / 1024 / 1024).toFixed(1)} MB`,
          sizeBytes: f.sizeBytes.toString(),
          modifiedTime: f.createdAt.toISOString(),
          viewedByMeTime: f.createdAt.toISOString(),
          accountEmail: f.connectedAccount?.email,
          accountId: f.connectedAccountId,
          webViewLink: f.provider === 'google_drive' ? `https://drive.google.com/file/d/${f.providerFileId}/view` : null,
          webContentLink: null,
          isFolder: false,
        })
      }
    }

    allItems.sort((a, b) => {
      const timeA = new Date(a.viewedByMeTime || a.modifiedTime || 0).getTime()
      const timeB = new Date(b.viewedByMeTime || b.modifiedTime || 0).getTime()
      return timeB - timeA
    })

    return res.json({ files: allItems.slice(0, 50) })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/star', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await resolveFileOrFromDrive(fileId, req.user!.id)
    if (!file) return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'File not found.' })

    const body = z.object({ starred: z.boolean().optional() }).parse(req.body ?? {})

    const targetStarred = body.starred !== undefined ? body.starred : !file.starred
    if (file.provider === 'google_drive' && file.connectedAccount) {
      await toggleGoogleDriveStar(file.connectedAccount, file.providerFileId, targetStarred)
    }
    await prisma.file.update({ where: { id: file.id }, data: { starred: targetStarred } })
    return res.json({ status: 'ok', starred: targetStarred })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/sync-google', async (req: AuthRequest, res, next) => {
  try {
    // force: the user pressed "sync"; automatic syncs reuse one that just ran.
    const body = z.object({ connectedAccountId: z.string().min(1).optional(), force: z.boolean().optional() }).parse(req.body ?? {})
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: 'google_drive',
        status: 'connected',
        OR: [
          { userId: req.user!.id },
          { isShared: true }
        ],
        ...(body.connectedAccountId ? { id: body.connectedAccountId } : {})
      },
      select: { id: true },
    })

    // Accounts are independent (each has its own lock), so they sync side by side.
    const results = await Promise.all(accounts.map((account) => syncGoogleAppFolderFiles(account.id, req.user!.id, { force: body.force })))

    return res.json({
      status: 'ok',
      results,
    })
  } catch (error) {
    return next(error)
  }
})

export async function resolveFileOrFromDrive(
  fileId: string,
  userId: string,
  targetAccountId?: string
) {
  // 1. Try finding by database id
  let file = await prisma.file.findFirst({
    where: {
      id: fileId,
      status: 'active',
      connectedAccount: { status: 'connected' },
      OR: [{ userId }, { connectedAccount: { isShared: true } }],
    },
    include: { connectedAccount: true, folder: { select: { id: true, name: true } } },
  })
  if (file) return file

  // 2. Try finding by providerFileId
  file = await prisma.file.findFirst({
    where: {
      providerFileId: fileId,
      status: 'active',
      connectedAccount: { status: 'connected' },
      OR: [{ userId }, { connectedAccount: { isShared: true } }],
    },
    include: { connectedAccount: true, folder: { select: { id: true, name: true } } },
  })
  if (file) return file

  // 3. Not in DB! Check connected accounts directly on Google Drive (Multi-Drive live resolution)
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      provider: 'google_drive',
      status: 'connected',
      OR: [{ userId }, { isShared: true }],
      ...(targetAccountId ? { id: targetAccountId } : {}),
    },
  })

  for (const account of accounts) {
    try {
      const meta = await getGoogleDriveFileMetadata(account, fileId)
      if (meta && meta.id && meta.name) {
        // A row this account already has (hidden or in the trash, so steps 1-2 skipped it) is the
        // file; a second row would show the file twice and count its size twice.
        const known = await prisma.file.findFirst({
          where: { connectedAccountId: account.id, providerFileId: meta.id },
          include: { connectedAccount: true, folder: { select: { id: true, name: true } } },
        })
        if (known) return known
        // Auto-create in database on-the-fly so it works everywhere in HCDrive!
        const created = await prisma.file.create({
          data: {
            userId: account.userId || userId,
            connectedAccountId: account.id,
            provider: 'google_drive',
            providerFileId: meta.id,
            name: meta.name,
            mimeType: meta.mimeType || 'application/octet-stream',
            sizeBytes: BigInt(meta.size || 0),
            status: meta.trashed ? 'deleted' : 'active',
            deletedAt: meta.trashed ? new Date() : null,
          },
          include: { connectedAccount: true, folder: { select: { id: true, name: true } } },
        })
        return created
      }
    } catch {
      // Not in this account or no permission, try next account
    }
  }

  return null
}

fileRouter.get('/open-drive', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.query.fileId || '')
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined
    if (!fileId) return res.status(400).json({ code: 'BAD_REQUEST', message: 'fileId is required' })

    const file = await resolveFileOrFromDrive(fileId, req.user!.id, accountId)
    if (!file) return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'File not found on storage.' })

    if (file.provider === 'google_drive') {
      try {
        const meta = await getGoogleDriveFileMetadata(file.connectedAccount, file.providerFileId)
        const openUrl = meta?.webViewLink || meta?.webContentLink || `https://drive.google.com/file/d/${file.providerFileId}/view`
        if (req.query.redirect === 'false') {
          return res.json({ url: openUrl })
        }
        return res.redirect(openUrl)
      } catch {
        const openUrl = `https://drive.google.com/file/d/${file.providerFileId}/view`
        if (req.query.redirect === 'false') {
          return res.json({ url: openUrl })
        }
        return res.redirect(openUrl)
      }
    }

    return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Direct open is only available for Google Drive files.' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await resolveFileOrFromDrive(fileId, req.user!.id)
    if (!file) return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'File not found.' })
    return res.json({
      file: {
        ...file,
        sizeBytes: file.sizeBytes.toString(),
        webViewLink: file.provider === 'google_drive' ? `https://drive.google.com/file/d/${file.providerFileId}/view` : null,
      }
    })
  } catch (error) {
    return next(error)
  }
})

// Ví dụ đủ ba lớp bảo mật trên một endpoint (đổi tên / chuyển thư mục một tệp):
// 1. Rate limit: bộ giới hạn chung của apiRouter (app.ts) đã đếm request này theo user.
// 2. IDOR: requireOwned chỉ nhận UUID và chỉ tìm tệp của chính người gọi; tệp của người khác trả 404.
// 3. RLS: mọi truy vấn (tệp, thư mục đích) đều có `ownedBy(req)` trong WHERE.
const requireOwnedFile = requireOwned({
  notFoundCode: 'FILE_NOT_FOUND',
  load: (id, req) => prisma.file.findFirst({ where: { id, ...ownedBy(req) }, include: { connectedAccount: true } }),
})

fileRouter.patch('/:id', requireOwnedFile, async (req: OwnedRequest<File & { connectedAccount: ConnectedAccount }>, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1).max(255).optional(), folderId: z.string().nullable().optional() }).parse(req.body)
    const file = req.owned!
    const proxyUrl = getAccountProxyUrl(file.connectedAccount)
    const drive = file.provider === 's3' ? null : getGoogleDriveClient(await getAuthedGoogleClient(file.connectedAccount), proxyUrl)
    // Thư mục đích cũng phải của người gọi, nếu không có thể chuyển tệp vào thư mục người khác.
    if (body.folderId) await prisma.folder.findFirstOrThrow({ where: { id: body.folderId, ...ownedBy(req), deletedAt: null } })
    if (body.name && drive) await drive.files.update({ fileId: file.providerFileId, requestBody: { name: body.name } })
    if (body.folderId !== undefined) await moveFileToFolder(req.user!.id, file, body.folderId)
    const updated = await prisma.file.update({ where: { id: file.id }, data: { ...(body.name ? { name: body.name } : {}) }, include: { connectedAccount: { select: { id: true, email: true, provider: true } }, folder: { select: { id: true, name: true } } } })
    await createAuditLog(req.user!.id, 'UPDATE_FILE', 'file', updated.id, { name: updated.name, updates: body })
    return res.json({ file: { ...updated, sizeBytes: updated.sizeBytes.toString() } })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/copy-to', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const body = z.object({
      targetAccountId: z.string().min(1),
      targetFolderId: z.string().nullable().optional(),
      name: z.string().min(1).max(255).optional(),
    }).parse(req.body)

    const copied = await copySingleFile(req.user!.id, fileId, body.targetAccountId, body.targetFolderId, body.name)
    await createAuditLog(req.user!.id, 'COPY_FILE_TO_ACCOUNT', 'file', fileId, {
      targetAccountId: body.targetAccountId,
      targetFolderId: body.targetFolderId,
    })
    return res.status(201).json({ status: 'ok', file: copied })
  } catch (error) {
    return next(error)
  }
})

// The HCDrive link of a file if it has one, so the share dialog shows it instead of offering to create one.
fileRouter.get('/:id/share', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirst({
      where: { OR: [{ id: fileId }, { providerFileId: fileId }], status: 'active' },
      select: { id: true },
    })
    if (!file) return res.json({ url: null })
    const share = await prisma.fileShare.findFirst({ where: { fileId: file.id, userId: req.user!.id, enabled: true, token: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } })
    return res.json({ url: share?.token ? `${getShareBaseUrl(req)}/public/files/${share.token}` : null })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/share', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await resolveFileOrFromDrive(fileId, req.user!.id)
    if (!file || file.status !== 'active') return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'File not found.' })
    // Older shares kept only the token hash; they cannot be shown again, so a new link is made instead.
    const existingShare = await prisma.fileShare.findFirst({ where: { fileId: file.id, userId: req.user!.id, enabled: true, token: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } })

    let shareId = existingShare?.id
    let token = existingShare?.token
    if (!existingShare) {
      token = randomToken(32)
      const share = await prisma.fileShare.create({ data: { fileId: file.id, userId: req.user!.id, token, tokenHash: hashToken(token) } })
      shareId = share.id
    }

    const baseUrl = getShareBaseUrl(req)
    return res.status(existingShare ? 200 : 201).json({
      url: `${baseUrl}/public/files/${token}`,
      shareId,
      webViewLink: file.provider === 'google_drive' ? `https://drive.google.com/file/d/${file.providerFileId}/view` : null
    })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/public-permission', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: true } })
    if (file.provider !== 'google_drive') {
      return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Only Google Drive files can be made public.' })
    }
    const proxyUrl = getAccountProxyUrl(file.connectedAccount)
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = getGoogleDriveClient(auth, proxyUrl)
    // Read-only: anyone with the link can view/download, but not edit or delete.
    await drive.permissions.create({
      fileId: file.providerFileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    })
    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink' })
    return res.json({ status: 'ok', url: metadata.data.webViewLink ?? metadata.data.webContentLink })
  } catch (error: any) {
    return res.status(500).json({ code: 'GOOGLE_API_ERROR', message: error.message || 'Failed to update Google Drive permissions.' })
  }
})

fileRouter.delete('/:id/share', async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id)
    // Pages fed by Google's own lists (Recent, Home) pass the Google id, so accept that too.
    const files = await prisma.file.findMany({ where: { OR: [{ id }, { providerFileId: id }] }, select: { id: true } })
    await prisma.fileShare.updateMany({ where: { fileId: { in: files.map((file) => file.id) }, userId: req.user!.id, enabled: true }, data: { enabled: false } })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/preview-token', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await resolveFileOrFromDrive(fileId, req.user!.id)
    if (!file || file.status !== 'active') return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'File not found.' })
    const token = randomToken(32)
    await prisma.filePreviewToken.create({ data: { fileId: file.id, userId: req.user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const path = `/files/preview/${token}`
    return res.status(201).json({
      path,
      url: `${req.protocol}://${req.get('host')}${path}`,
      webViewLink: file.provider === 'google_drive' ? `https://drive.google.com/file/d/${file.providerFileId}/view` : null
    })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id/view-url', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await resolveFileOrFromDrive(fileId, req.user!.id)
    if (!file) return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'File not found.' })
    if (file.provider === 's3') return res.json({ url: null })
    try {
      const metadata = await getGoogleDriveFileMetadata(file.connectedAccount, file.providerFileId)
      return res.json({ url: metadata.webViewLink ?? metadata.webContentLink ?? `https://drive.google.com/file/d/${file.providerFileId}/view` })
    } catch {
      return res.json({ url: `https://drive.google.com/file/d/${file.providerFileId}/view` })
    }
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id/download', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    // format: the export type for Google Docs/Sheets/Slides (from /files/:id/export-formats).
    const format = typeof req.query.format === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(req.query.format) ? req.query.format : undefined
    const file = await resolveFileOrFromDrive(fileId, req.user!.id)
    if (!file) return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'File not found.' })
    return streamProviderFile(file, req.headers.range, res, { disposition: 'attachment', ...(format ? { exportMimeType: format, exportExtension: exportExtension(format) } : {}) })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id/cache-progress', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await resolveFileOrFromDrive(fileId, req.user!.id)
    const key = file?.providerFileId || fileId
    const progress = getCacheProgress(key)
    return res.json(progress)
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({
      where: { id: fileId, userId: req.user!.id, status: 'active' },
      include: { connectedAccount: true }
    })

    if (file.provider === 'google_drive' && file.connectedAccount) {
      try {
        const proxyUrl = getAccountProxyUrl(file.connectedAccount)
        const auth = await getAuthedGoogleClient(file.connectedAccount)
        const drive = getGoogleDriveClient(auth, proxyUrl)
        await drive.files.update({
          fileId: file.providerFileId,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        })
      } catch (err: any) {
        console.warn(`Failed to trash file ${file.providerFileId} on Google Drive:`, err.message || err)
      }
    }

    await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date() } })
    await createAuditLog(req.user!.id, 'TRASH_FILE', 'file', file.id, { name: file.name })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/batch-download', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active', connectedAccount: { status: 'connected' } },
      include: { connectedAccount: true }
    })
    if (files.length === 0) return res.status(404).json({ code: 'FILES_NOT_FOUND', message: 'No files found.' })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="hcdrive-download.zip"')

    const archive = new ZipArchive({ zlib: { level: 9 } })
    archive.on('error', (err: any) => {
      throw err
    })
    archive.pipe(res)

    for (const file of files) {
      try {
        let stream: Readable
        let fileName = file.name
        if (file.provider === 's3') {
          const config = await getS3ConfigForAccount(file.connectedAccountId)
          const client = createS3Client(config)
          const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId }))
          stream = response.Body as Readable
        } else {
          const auth = await getAuthedGoogleClient(file.connectedAccount)
          const headers = normalizeHeaders(await auth.getRequestHeaders())
          const exportTarget = googleDownloadExportMimeTypes[file.mimeType]
          if (exportTarget) {
            fileName = withExtension(file.name, exportTarget.extension)
          }
          const url = exportTarget
            ? `https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
            : `https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`
          const proxyUrl = getAccountProxyUrl(file.connectedAccount)
          const response = await fetch(url, { headers, dispatcher: getUndiciDispatcher(proxyUrl) } as any)
          if (!response.ok || !response.body) continue
          stream = Readable.fromWeb(response.body as any)
        }
        archive.append(stream, { name: fileName })
      } catch (err) {
        console.error(`Failed to add file ${file.name} to zip:`, err)
      }
    }

    await archive.finalize()
  } catch (error) {
    return next(error)
  }
})

// Google Drive sharing (people / "anyone with the link") for a file, next to the HCDrive public link.
// Copies, new Google Docs, export formats, shortcuts, details, comments, versions, locks.
mountDriveFeatureRoutes(fileRouter, resolveFileOrFromDrive)

mountDrivePermissionRoutes(fileRouter, async (req) => {
  // Accepts the HCDrive id or the Google id (Recent and Home list items by their Google id, and may
  // show Drive files HCDrive has no row for yet; those are looked up on Drive like the HCDrive link does).
  const file = await resolveFileOrFromDrive(String(req.params.id), req.user!.id)
  if (!file) throw shareError(404, 'FILE_NOT_FOUND', 'File not found.')
  if (file.provider !== 'google_drive') throw shareError(400, 'UNSUPPORTED_PROVIDER', 'Only Google Drive files can be shared on Google Drive.')
  return {
    entityType: 'file',
    entityId: file.id,
    name: file.name,
    account: file.connectedAccount,
    providerId: file.providerFileId,
    canManage: file.connectedAccount.userId === req.user!.id,
  }
})
