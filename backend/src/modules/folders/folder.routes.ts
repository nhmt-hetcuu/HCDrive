import { Router } from 'express'
import { google } from 'googleapis'
import { z } from 'zod'
import { Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { createDriveClientCache, getAuthedGoogleClient, getGoogleDriveClient, ensureGoogleAppFolder } from '../google/google.service.js'
import { mapLimit } from '../../utils/concurrency.js'
import { getS3ConfigForAccount, createS3Client } from '../s3/s3.service.js'
import { googleDownloadExportMimeTypes, normalizeHeaders, withExtension } from '../files/stream-google-file.js'
import { createAuditLog } from '../../utils/audit.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { buildMergedFolders, ensureAccountFolderPath, loadVisibleFolders, moveDriveItem } from './merged-folders.js'
import { refreshMergedFolderLive } from './live-refresh.js'
import { mountDrivePermissionRoutes, shareError } from '../google/drive-sharing.js'
import { searchKey } from '../../utils/search.js'
import { copyFolderRecursively } from '../files/cross-account-copy.js'

export const folderRouter = Router()
folderRouter.use(requireAuth)

const defaultFolderColor = '#3b82f6'
const defaultFolderIconUrl = 'https://api.iconify.design/lucide:folder.svg'
const iconUrlSchema = z.string().url().startsWith('https://api.iconify.design/lucide:').max(2048)
const colorSchema = z.string().regex(/^(#[0-9a-fA-F]{6}|text-[a-z]+-[0-9]+)$/).max(64)

const createSchema = z.object({
  name: z.string().min(1).max(255),
  color: colorSchema.optional(),
  iconUrl: iconUrlSchema.nullable().optional(),
  parentId: z.string().nullable().optional(),
})

function serializeFolder(folder: { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; createdAt: Date; updatedAt: Date }) {
  return { ...folder, providerFolderId: folder.providerFolderId ?? null, createdAt: folder.createdAt.toISOString(), updatedAt: folder.updatedAt.toISOString() }
}

async function ensureProviderFolderIds(
  folders: Array<{ id: string; name: string; parentId: string | null; providerFolderId: string | null }>,
  userId: string
) {
  const foldersWithoutId = folders.filter((f) => !f.providerFolderId)
  if (foldersWithoutId.length === 0) return

  const connectedAccount = await prisma.connectedAccount.findFirst({
    where: { userId, provider: 'google_drive', status: 'connected' }
  })
  if (!connectedAccount) return

  try {
    const auth = await getAuthedGoogleClient(connectedAccount)
    const proxyUrl = getAccountProxyUrl(connectedAccount)
    const drive = getGoogleDriveClient(auth, proxyUrl)
    const appFolderId = await ensureGoogleAppFolder(connectedAccount)

    for (const folder of foldersWithoutId) {
      try {
        let parentGoogleId = appFolderId
        if (folder.parentId) {
          const parentFolder = await prisma.folder.findFirst({
            where: { id: folder.parentId, userId }
          })
          if (parentFolder?.providerFolderId) {
            parentGoogleId = parentFolder.providerFolderId
          }
        }

        const driveFolder = await drive.files.create({
          requestBody: {
            name: folder.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentGoogleId]
          },
          fields: 'id'
        })

        const gId = driveFolder.data.id ?? null
        if (gId) {
          await prisma.folder.update({
            where: { id: folder.id },
            data: { providerFolderId: gId, connectedAccountId: connectedAccount.id }
          })
          folder.providerFolderId = gId
        }
      } catch (error) {
        console.error(`Failed self-healing for folder ${folder.id}:`, error)
      }
    }
  } catch (error) {
    console.error('Failed self-healing Google Drive auth:', error)
  }
}

folderRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({
      parentId: z.string().nullable().optional(),
      all: z.string().optional(),
      q: z.string().trim().max(255).optional(),
      accountId: z.string().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }).parse(req.query)
    // Folders from every connected account are merged by name path (see merged-folders.ts);
    // ?all=1 returns the whole merged tree, used for breadcrumbs and folder pickers.
    const merged = buildMergedFolders(await loadVisibleFolders(req.user!.id))
    // Searching or filtering looks through the whole merged tree, like GET /files does.
    const isFiltering = Boolean(query.q || query.accountId || query.startDate || query.endDate)
    let folders = query.all === '1' || isFiltering ? merged.all() : merged.childrenOf(query.parentId || null)
    if (isFiltering) {
      const needle = query.q ? searchKey(query.q) : ''
      const start = query.startDate ? new Date(query.startDate) : null
      const end = query.endDate ? new Date(query.endDate) : null
      folders = folders.filter((folder) =>
        (!needle || searchKey(folder.name).includes(needle)) &&
        (!query.accountId || merged.members(folder.id).some((member) => member.connectedAccountId === query.accountId)) &&
        (!start || folder.updatedAt >= start) &&
        (!end || folder.updatedAt <= end))
    }
    await ensureProviderFolderIds(folders, req.user!.id)

    const userAccounts = await prisma.connectedAccount.findMany({
      where: { OR: [{ userId: req.user!.id }, { isShared: true }] },
      select: { id: true, email: true }
    })
    const accountMap = new Map(userAccounts.map((a) => [a.id, a.email]))

    const serializedFolders = folders.map(({ connectedAccountId: _a, userId: _u, ...folder }) => {
      const members = merged.members(folder.id)
      const accounts = members
        .map((m) => (m.connectedAccountId ? { id: m.connectedAccountId, email: accountMap.get(m.connectedAccountId) || '' } : null))
        .filter((a): a is { id: string; email: string } => a !== null && a.email.length > 0)
      return {
        ...serializeFolder(folder),
        accounts,
        // Location shown next to search results; the folder itself is left out.
        ...(isFiltering ? { path: merged.pathTo(folder.id).slice(0, -1).map((f) => ({ id: f.id, name: f.name })) } : {})
      }
    })
    return res.json({ folders: serializedFolders })
  } catch (error) {
    return next(error)
  }
})

// Re-reads one My Drive folder (or the root when parentId is empty) directly from Google Drive in every account.
folderRouter.post('/refresh', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ parentId: z.string().nullable().optional() }).parse(req.body ?? {})
    const result = await refreshMergedFolderLive(req.user!.id, body.parentId || null)
    return res.json(result)
  } catch (error) {
    return next(error)
  }
})

folderRouter.get('/recent', async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 4), 4)
    const folders = await prisma.folder.findMany({
      where: { userId: req.user!.id, deletedAt: null },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    await ensureProviderFolderIds(folders, req.user!.id)
    return res.json({ folders: folders.map(serializeFolder) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.get('/:id/download', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id
    const folderId = String(req.params.id)
    const visibleFolders = await loadVisibleFolders(userId)
    const merged = buildMergedFolders(visibleFolders)
    const rootMembers = merged.members(folderId)
    if (rootMembers.length === 0) {
      return res.status(404).json({ code: 'FOLDER_NOT_FOUND', message: 'Folder not found.' })
    }

    const folderName = rootMembers[0].name
    const allUserFolders = await prisma.folder.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true, parentId: true }
    })

    const folderMap = new Map<string, { id: string; name: string; parentId: string | null }>()
    for (const f of allUserFolders) {
      folderMap.set(f.id, f)
    }

    const targetFolderIds = new Set<string>(rootMembers.map((m) => m.id))
    let changed = true
    while (changed) {
      changed = false
      for (const f of allUserFolders) {
        if (f.parentId && targetFolderIds.has(f.parentId) && !targetFolderIds.has(f.id)) {
          targetFolderIds.add(f.id)
          changed = true
        }
      }
    }

    function getRelativePath(fId: string): string {
      if (rootMembers.some((m) => m.id === fId)) return ''
      const parts: string[] = []
      let curr = folderMap.get(fId)
      while (curr && !rootMembers.some((m) => m.id === curr!.id)) {
        parts.unshift(curr.name)
        curr = curr.parentId ? folderMap.get(curr.parentId) : undefined
      }
      return parts.join('/')
    }

    const files = await prisma.file.findMany({
      where: {
        userId,
        status: 'active',
        folderId: { in: Array.from(targetFolderIds) },
        connectedAccount: { status: 'connected' }
      },
      include: { connectedAccount: true }
    })

    if (files.length === 0) {
      return res.status(404).json({ code: 'FOLDER_EMPTY', message: 'Thư mục không có tệp nào để tải xuống.' })
    }

    res.setHeader('Content-Type', 'application/zip')
    const safeName = encodeURIComponent(folderName).replace(/['()]/g, escape)
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"; filename*=UTF-8''${safeName}.zip`)

    const archive = new ZipArchive({ zlib: { level: 9 } })
    archive.on('error', (err: any) => {
      console.error('[folder-download] archive error:', err)
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
        const relDir = file.folderId ? getRelativePath(file.folderId) : ''
        const archivePath = relDir ? `${relDir}/${fileName}` : fileName
        archive.append(stream, { name: archivePath })
      } catch (err) {
        console.error(`Failed to add file ${file.name} to zip:`, err)
      }
    }

    await archive.finalize()
  } catch (error) {
    return next(error)
  }
})

folderRouter.post('/', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    let parentFolder = null
    if (body.parentId) {
      parentFolder = await prisma.folder.findFirstOrThrow({
        where: { id: body.parentId, userId: req.user!.id, deletedAt: null }
      })
    }

    // A Drive folder id only exists in its own account, so a subfolder is created in the parent's account.
    const connectedAccount = await prisma.connectedAccount.findFirst({
      where: {
        userId: req.user!.id,
        provider: 'google_drive',
        status: 'connected',
        ...(parentFolder?.connectedAccountId ? { id: parentFolder.connectedAccountId } : {}),
      }
    })

    let providerFolderId: string | null = null
    if (connectedAccount) {
      try {
        const auth = await getAuthedGoogleClient(connectedAccount)
        const proxyUrl = getAccountProxyUrl(connectedAccount)
        const drive = getGoogleDriveClient(auth, proxyUrl)

        let googleParentId = await ensureGoogleAppFolder(connectedAccount)
        if (parentFolder && parentFolder.providerFolderId) {
          googleParentId = parentFolder.providerFolderId
        }

        const driveFolder = await drive.files.create({
          requestBody: {
            name: body.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [googleParentId]
          },
          fields: 'id'
        })
        providerFolderId = driveFolder.data.id ?? null
      } catch (error) {
        console.error('Failed to create folder on Google Drive:', error)
      }
    }

    const folder = await prisma.folder.create({
      data: {
        userId: req.user!.id,
        name: body.name,
        color: body.color ?? defaultFolderColor,
        iconUrl: body.iconUrl ?? defaultFolderIconUrl,
        parentId: body.parentId ?? null,
        providerFolderId,
        connectedAccountId: connectedAccount?.id ?? null
      },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
    })
    await createAuditLog(req.user!.id, 'CREATE_FOLDER', 'folder', folder.id, { name: folder.name })
    return res.status(201).json({ folder: serializeFolder(folder) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.partial().parse(req.body)
    const folderId = String(req.params.id)
    const userId = req.user!.id
    if (body.parentId === folderId) return res.status(400).json({ code: 'FOLDER_INVALID_PARENT', message: 'Folder cannot be moved into itself.' })

    const folders = await loadVisibleFolders(userId)
    const merged = buildMergedFolders(folders)
    // A merged folder has one copy per account; all copies change together or the merged folder would split.
    const members = merged.members(folderId).filter((folder) => folder.userId === userId)
    if (members.length === 0) return res.status(404).json({ code: 'FOLDER_NOT_FOUND', message: 'Folder not found.' })

    if (body.parentId) {
      await prisma.folder.findFirstOrThrow({ where: { id: body.parentId, userId, deletedAt: null } })
      const descendantIds = new Set<string>(members.map((folder) => folder.id))
      let changed = true
      while (changed) {
        changed = false
        for (const folder of folders) {
          if (folder.parentId && descendantIds.has(folder.parentId) && !descendantIds.has(folder.id)) {
            descendantIds.add(folder.id)
            changed = true
          }
        }
      }
      if (merged.memberIds(body.parentId).some((id) => descendantIds.has(id))) {
        return res.status(400).json({ code: 'FOLDER_INVALID_PARENT', message: 'Folder cannot be moved into itself or a child folder.' })
      }
    }

    const accountIds = members.map((folder) => folder.connectedAccountId).filter((id): id is string => Boolean(id))
    const accounts = await prisma.connectedAccount.findMany({ where: { id: { in: accountIds }, provider: 'google_drive', status: 'connected' } })

    for (const member of members) {
      const account = accounts.find((candidate) => candidate.id === member.connectedAccountId)
      // Folders without a Drive copy (S3 / old virtual folders) just point at the merged parent.
      let parentId: string | null | undefined = body.parentId === undefined ? undefined : body.parentId ?? null

      if (account && member.providerFolderId) {
        const drive = getGoogleDriveClient(await getAuthedGoogleClient(account), getAccountProxyUrl(account))
        if (body.name) {
          await drive.files.update({ fileId: member.providerFolderId, requestBody: { name: body.name }, supportsAllDrives: true })
        }
        if (body.parentId !== undefined) {
          let providerParentId = 'root'
          parentId = null
          if (body.parentId) {
            const target = await ensureAccountFolderPath(userId, account.id, drive, body.parentId)
            if (!target) return res.status(404).json({ code: 'FOLDER_NOT_FOUND', message: 'Target folder not found.' })
            providerParentId = target.providerFolderId
            parentId = target.folderId
          }
          await moveDriveItem(drive, member.providerFolderId, providerParentId)
        }
      }

      await prisma.folder.update({
        where: { id: member.id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.color ? { color: body.color } : {}),
          ...(body.iconUrl !== undefined ? { iconUrl: body.iconUrl } : {}),
          ...(parentId !== undefined ? { parentId } : {}),
        },
      })
    }

    const updated = await prisma.folder.findFirstOrThrow({
      where: { id: members.some((folder) => folder.id === folderId) ? folderId : members[0].id },
      select: { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, createdAt: true, updatedAt: true },
    })
    await createAuditLog(userId, 'UPDATE_FOLDER', 'folder', updated.id, { name: updated.name, updates: body, copies: members.length })
    return res.json({ folder: serializeFolder(updated) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id
    const visibleFolders = await loadVisibleFolders(userId)
    // Deleting a merged folder deletes every account's copy of it.
    const roots = buildMergedFolders(visibleFolders).members(String(req.params.id)).filter((folder) => folder.userId === userId)
    if (roots.length === 0) return res.status(404).json({ code: 'FOLDER_NOT_FOUND', message: 'Folder not found.' })

    const folders = await prisma.folder.findMany({ where: { userId, deletedAt: null }, select: { id: true, parentId: true, providerFolderId: true } })
    const folderIds = new Set<string>(roots.map((folder) => folder.id))
    let changed = true
    while (changed) {
      changed = false
      for (const folder of folders) {
        if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
          folderIds.add(folder.id)
          changed = true
        }
      }
    }

    const files = await prisma.file.findMany({
      where: { userId, status: 'active', folderId: { in: [...folderIds] } },
      include: { connectedAccount: true }
    })

    // Trash files on Google Drive, several at a time with one Drive client per account
    const driveFor = createDriveClientCache()
    await mapLimit(files, 8, async (file) => {
      if (file.provider !== 'google_drive' || !file.connectedAccount) return
      try {
        const drive = await driveFor(file.connectedAccount)
        await drive.files.update({ fileId: file.providerFileId, requestBody: { trashed: true }, supportsAllDrives: true })
      } catch {}
    })

    // Trash each account's copy of the folder on Google Drive
    const accounts = await prisma.connectedAccount.findMany({ where: { id: { in: roots.map((folder) => folder.connectedAccountId).filter((id): id is string => Boolean(id)) } } })
    await Promise.all(roots.map(async (root) => {
      const account = accounts.find((candidate) => candidate.id === root.connectedAccountId)
      if (!root.providerFolderId || !account || account.provider !== 'google_drive') return
      try {
        const drive = await driveFor(account)
        await drive.files.update({ fileId: root.providerFolderId, requestBody: { trashed: true }, supportsAllDrives: true })
      } catch {}
    }))

    await prisma.file.updateMany({ where: { id: { in: files.map((file) => file.id) } }, data: { status: 'deleted', deletedAt: new Date() } })
    await prisma.folder.updateMany({ where: { id: { in: [...folderIds] }, userId }, data: { deletedAt: new Date() } })

    await createAuditLog(userId, 'DELETE_FOLDER', 'folder', roots[0].id, { name: roots[0].name, copies: roots.length })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

folderRouter.post('/:id/copy-to', async (req: AuthRequest, res, next) => {
  try {
    const folderId = String(req.params.id)
    const body = z.object({
      targetAccountId: z.string().min(1),
      targetParentFolderId: z.string().nullable().optional(),
      name: z.string().min(1).max(255).optional(),
    }).parse(req.body)

    const result = await copyFolderRecursively(
      req.user!.id,
      folderId,
      body.targetAccountId,
      body.targetParentFolderId,
      body.name
    )
    await createAuditLog(req.user!.id, 'COPY_FOLDER_TO_ACCOUNT', 'folder', folderId, {
      targetAccountId: body.targetAccountId,
      targetParentFolderId: body.targetParentFolderId,
      copiedFiles: result.copiedFiles,
      copiedFolders: result.copiedFolders,
    })
    return res.status(201).json({ status: 'ok', ...result, folder: serializeFolder(result.folder) })
  } catch (error) {
    return next(error)
  }
})

// Google Drive sharing for a folder. A merged folder has one Drive folder per account, each with its own
// link and permissions; ?accountId= picks the copy (default: the first copy stored on Google Drive).
mountDrivePermissionRoutes(folderRouter, async (req) => {
  const members = buildMergedFolders(await loadVisibleFolders(req.user!.id)).members(String(req.params.id))
  const accounts = await prisma.connectedAccount.findMany({
    where: { id: { in: members.map((folder) => folder.connectedAccountId).filter((id): id is string => Boolean(id)) }, provider: 'google_drive', status: 'connected' },
  })
  const copies = members.flatMap((folder) => {
    const account = accounts.find((candidate) => candidate.id === folder.connectedAccountId)
    return account && folder.providerFolderId ? [{ folder, account }] : []
  })
  if (copies.length === 0) throw shareError(404, 'FOLDER_NOT_ON_DRIVE', 'This folder has no copy on Google Drive.')
  const requestedAccountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined
  const chosen = copies.find((copy) => copy.account.id === requestedAccountId) ?? copies[0]
  return {
    entityType: 'folder',
    entityId: chosen.folder.id,
    name: chosen.folder.name,
    account: chosen.account,
    providerId: chosen.folder.providerFolderId!,
    canManage: chosen.account.userId === req.user!.id,
    copies: copies.map((copy) => ({ accountId: copy.account.id, email: copy.account.email })),
  }
})
