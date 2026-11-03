import { Router } from 'express'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from '../google/google.service.js'
import { getAccountProxyUrl } from '../../utils/proxy.js'
import { buildMergedFolders, loadVisibleFolders } from '../folders/merged-folders.js'

export const homeRouter = Router()
homeRouter.use(requireAuth)

function formatBytesNumber(bytes: number | string | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === '') return '--'
  const n = Number(bytes)
  if (isNaN(n) || n === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

homeRouter.get('/suggestions', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id

    // 1. Fetch connected Google Drive accounts
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: 'google_drive',
        status: 'connected',
        OR: [{ userId }, { isShared: true }],
      },
    })

    // 2. Fetch recent files from Google Drive in parallel
    const driveResults = await Promise.allSettled(
      accounts.map(async (account) => {
        const proxyUrl = getAccountProxyUrl(account)
        const auth = await getAuthedGoogleClient(account)
        const drive = getGoogleDriveClient(auth, proxyUrl)

        const listRes = await drive.files.list({
          q: "trashed = false and 'me' in owners and mimeType != 'application/vnd.google-apps.folder'",
          pageSize: 20,
          fields:
            'files(id, name, mimeType, size, modifiedTime, viewedByMeTime, createdTime, parents, starred, webViewLink, webContentLink, iconLink, thumbnailLink)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          orderBy: 'viewedByMeTime desc, modifiedTime desc',
        })
        return { account, files: listRes.data.files || [] }
      })
    )

    // 3. Fetch active database files
    const dbFiles = await prisma.file.findMany({
      where: {
        status: 'active',
        connectedAccount: { status: 'connected' },
        OR: [{ userId }, { connectedAccount: { isShared: true } }],
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true } },
        folder: { select: { id: true, name: true, parentId: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    })

    // 4. Load visible folders for folder mapping & suggestions
    const rawFolders = await loadVisibleFolders(userId)
    const merged = buildMergedFolders(rawFolders)
    const folderMapByProviderId = new Map<string, string>()
    const folderMapById = new Map<string, string>()
    for (const f of rawFolders) {
      if (f.providerFolderId) folderMapByProviderId.set(f.providerFolderId, f.name)
      folderMapById.set(f.id, f.name)
    }

    // Map dbFiles by providerFileId for fast id lookup
    const dbFileByProviderId = new Map(dbFiles.map((f) => [f.providerFileId, f]))

    const allCandidateFiles: any[] = []
    const referencedFolderIds = new Set<string>()

    // Process Google Drive files
    for (const result of driveResults) {
      if (result.status !== 'fulfilled') continue
      const { account, files } = result.value
      for (const f of files) {
        if (!f.id) continue
        const dbFile = dbFileByProviderId.get(f.id)

        // Determine reason and reasonTime
        let reason: 'opened' | 'edited' | 'uploaded' = 'opened'
        let reasonTime = f.viewedByMeTime || f.modifiedTime || f.createdTime

        const viewed = f.viewedByMeTime ? new Date(f.viewedByMeTime).getTime() : 0
        const modified = f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0
        const created = f.createdTime ? new Date(f.createdTime).getTime() : 0

        if (viewed && viewed >= modified) {
          reason = 'opened'
          reasonTime = f.viewedByMeTime
        } else if (modified && Math.abs(modified - created) > 60000) {
          reason = 'edited'
          reasonTime = f.modifiedTime
        } else {
          reason = 'uploaded'
          reasonTime = f.createdTime || f.modifiedTime
        }

        const parentProviderId = f.parents?.[0]
        if (parentProviderId && parentProviderId !== 'root') {
          referencedFolderIds.add(parentProviderId)
        }

        const folderName = parentProviderId && parentProviderId !== 'root'
          ? folderMapByProviderId.get(parentProviderId) || dbFile?.folder?.name || null
          : null

        allCandidateFiles.push({
          id: dbFile?.id || f.id,
          providerFileId: f.id,
          name: f.name || 'Untitled',
          mimeType: f.mimeType || 'application/octet-stream',
          size: f.size ? formatBytesNumber(f.size) : '0 B',
          sizeBytes: f.size || '0',
          modifiedTime: f.modifiedTime || new Date().toISOString(),
          viewedByMeTime: f.viewedByMeTime || null,
          createdTime: f.createdTime || null,
          reason,
          reasonTime: reasonTime || f.modifiedTime || new Date().toISOString(),
          accountEmail: account.email,
          accountId: account.id,
          folderName: folderName || null,
          folderId: dbFile?.folderId || null,
          starred: Boolean(f.starred),
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        })
      }
    }

    // Process database files (S3 / DB records not yet listed)
    const existingIds = new Set(allCandidateFiles.map((c) => c.providerFileId))
    for (const f of dbFiles) {
      if (existingIds.has(f.providerFileId)) continue
      if (f.folderId) referencedFolderIds.add(f.folderId)

      allCandidateFiles.push({
        id: f.id,
        providerFileId: f.providerFileId,
        name: f.name,
        mimeType: f.mimeType,
        size: formatBytesNumber(f.sizeBytes.toString()),
        sizeBytes: f.sizeBytes.toString(),
        modifiedTime: f.updatedAt.toISOString(),
        viewedByMeTime: f.updatedAt.toISOString(),
        createdTime: f.createdAt.toISOString(),
        reason: 'uploaded',
        reasonTime: f.createdAt.toISOString(),
        accountEmail: f.connectedAccount?.email || 'HCDrive',
        accountId: f.connectedAccountId,
        folderName: f.folder?.name || null,
        folderId: f.folderId || null,
        starred: false,
        webViewLink: f.provider === 'google_drive' ? `https://drive.google.com/file/d/${f.providerFileId}/view` : null,
      })
    }

    // Sort files by reasonTime descending
    allCandidateFiles.sort((a, b) => {
      const timeA = new Date(a.reasonTime || a.modifiedTime || 0).getTime()
      const timeB = new Date(b.reasonTime || b.modifiedTime || 0).getTime()
      return timeB - timeA
    })

    // 5. Select suggested folders (max 6)
    // First prioritize folders referenced by the recent files, then recently updated folders
    const allMergedFolders = merged.all()
    const suggestedFolderList: any[] = []
    const seenFolderIds = new Set<string>()

    // Priority 1: Folders referenced by recent files
    for (const folder of allMergedFolders) {
      if (
        (referencedFolderIds.has(folder.id) ||
         (folder.providerFolderId && referencedFolderIds.has(folder.providerFolderId))) &&
        !seenFolderIds.has(folder.id)
      ) {
        seenFolderIds.add(folder.id)
        suggestedFolderList.push(folder)
      }
      if (suggestedFolderList.length >= 6) break
    }

    // Priority 2: Fill remaining up to 6 with recent folders
    if (suggestedFolderList.length < 6) {
      for (const folder of allMergedFolders) {
        if (!seenFolderIds.has(folder.id)) {
          seenFolderIds.add(folder.id)
          suggestedFolderList.push(folder)
        }
        if (suggestedFolderList.length >= 6) break
      }
    }

    return res.json({
      folders: suggestedFolderList.map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color,
        iconUrl: f.iconUrl,
        parentId: f.parentId,
        providerFolderId: f.providerFolderId,
        updated: f.updatedAt ? f.updatedAt.toISOString() : new Date().toISOString(),
      })),
      files: allCandidateFiles.slice(0, 10),
    })
  } catch (error) {
    return next(error)
  }
})
