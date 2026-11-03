import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { z } from 'zod'
import type { ConnectedAccount, SavedLink } from '@prisma/client'
import type { drive_v3 } from 'googleapis'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { ownedBy, requireOwned, type OwnedRequest } from '../../middleware/ownership.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from '../google/google.service.js'
import { normalizeHeaders } from '../files/stream-google-file.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { noteGoogleError } from '../../utils/google-backoff.js'
import { signId, verifySignedId } from '../../utils/signed-url.js'

// Library of Drive links other people shared with the user (bought courses, lesson folders, documents).
// HCDrive opens them through the user's own Google account that received the share, so it can only
// reach what that account can already open. When the owner blocked downloads, HCDrive does not
// stream the file: the page falls back to Google's own viewer.

export const libraryRouter = Router()

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/
const META_FIELDS = 'id,name,mimeType,size,resourceKey,webViewLink,owners(displayName,emailAddress),capabilities(canDownload),shortcutDetails(targetId,targetMimeType,targetResourceKey)'
const ITEM_FIELDS = 'nextPageToken,files(id,name,mimeType,size,resourceKey,webViewLink,videoMediaMetadata(durationMillis),capabilities(canDownload),shortcutDetails(targetId,targetMimeType,targetResourceKey))'

/** File id and resource key from any Drive / Docs link, or a bare file id. */
export function parseDriveLink(input: string): { fileId: string; resourceKey: string | null } | null {
  const text = input.trim()
  if (DRIVE_ID.test(text) && text.length >= 20) return { fileId: text, resourceKey: null }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname)) return null
  const fromPath = url.pathname.match(/\/(?:file\/d|folders|document\/d|spreadsheets\/d|presentation\/d|drawings\/d|d)\/([A-Za-z0-9_-]{10,200})/)
  const fileId = fromPath?.[1] ?? url.searchParams.get('id')
  if (!fileId || !DRIVE_ID.test(fileId)) return null
  return { fileId, resourceKey: url.searchParams.get('resourcekey') }
}

/** Links shared before 2021 need their resource key sent along, or Drive answers 404. */
function resourceKeyHeaders(fileId: string, resourceKey: string | null | undefined): Record<string, string> {
  return resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${resourceKey}` } : {}
}

function driveFor(account: ConnectedAccount) {
  return getAuthedGoogleClient(account).then((auth) => getGoogleDriveClient(auth, getAccountProxyUrl(account)))
}

function ownGoogleAccounts(userId: string) {
  return prisma.connectedAccount.findMany({ where: { userId, provider: 'google_drive', status: 'connected' }, orderBy: { createdAt: 'asc' } })
}

type Resolved = { account: ConnectedAccount; meta: drive_v3.Schema$File }

/** The first of the user's Google accounts that can open the file (the preferred one is tried first). */
async function findAccountFor(userId: string, fileId: string, resourceKey: string | null, preferredId?: string | null): Promise<Resolved | null> {
  const accounts = await ownGoogleAccounts(userId)
  accounts.sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId))
  for (const account of accounts) {
    try {
      const drive = await driveFor(account)
      const meta = await drive.files.get({ fileId, fields: META_FIELDS, supportsAllDrives: true }, { headers: resourceKeyHeaders(fileId, resourceKey) })
      return { account, meta: meta.data }
    } catch (error) {
      noteGoogleError(account.id, error)
    }
  }
  return null
}

/** The account a saved link opens with; finds another one when it was removed or disconnected. */
async function accountForLink(link: SavedLink): Promise<ConnectedAccount | null> {
  if (link.connectedAccountId) {
    const account = await prisma.connectedAccount.findFirst({ where: { id: link.connectedAccountId, userId: link.userId, provider: 'google_drive', status: 'connected' } })
    if (account) return account
  }
  const found = await findAccountFor(link.userId, link.driveFileId, link.resourceKey)
  if (!found) return null
  await prisma.savedLink.update({ where: { id: link.id }, data: { connectedAccountId: found.account.id } })
  return found.account
}

function noAccess(res: import('express').Response) {
  return res.status(404).json({
    code: 'LINK_NOT_ACCESSIBLE',
    message: 'Không tài khoản Google nào của bạn mở được link này. Hãy kết nối tài khoản Google có email được chia sẻ (Tài khoản lưu trữ → Kết nối Google).',
  })
}

function streamPath(linkId: string, fileId: string, resourceKey?: string | null) {
  return `/library/stream/${signId('library', `${linkId}~${fileId}`)}${resourceKey ? `?rk=${encodeURIComponent(resourceKey)}` : ''}`
}

function previewUrl(fileId: string, resourceKey?: string | null) {
  return `https://drive.google.com/file/d/${fileId}/preview${resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : ''}`
}

type LinkWithAccount = SavedLink & { connectedAccount: { id: string; email: string } | null; _count?: { progress: number } }

function serializeLink(link: LinkWithAccount) {
  return {
    id: link.id,
    driveFileId: link.driveFileId,
    title: link.title,
    url: link.url,
    mimeType: link.mimeType,
    isFolder: link.mimeType === FOLDER_MIME,
    ownerName: link.ownerName,
    ownerEmail: link.ownerEmail,
    collection: link.collection,
    note: link.note,
    lastOpenedAt: link.lastOpenedAt,
    createdAt: link.createdAt,
    account: link.connectedAccount ? { id: link.connectedAccount.id, email: link.connectedAccount.email } : null,
    completedCount: link._count?.progress ?? 0,
  }
}

const linkInclude = {
  connectedAccount: { select: { id: true, email: true } },
  _count: { select: { progress: { where: { completedAt: { not: null } } } } },
} as const

// ---- Streaming (no Authorization header: <video> and <iframe> load it; the signed token is the access) ----

libraryRouter.get('/stream/:token', async (req, res, next) => {
  try {
    const signed = verifySignedId('library', String(req.params.token))
    const [linkId, fileId] = signed?.split('~') ?? []
    if (!linkId || !fileId || !DRIVE_ID.test(fileId)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' })
    const link = await prisma.savedLink.findUnique({ where: { id: linkId } })
    if (!link) return res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' })
    const account = await accountForLink(link)
    if (!account) return noAccess(res)

    const rk = typeof req.query.rk === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(req.query.rk) ? req.query.rk : null
    const resourceKey = fileId === link.driveFileId ? link.resourceKey : rk
    const auth = await getAuthedGoogleClient(account)
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
      dispatcher: getUndiciDispatcher(getAccountProxyUrl(account)),
      headers: { ...normalizeHeaders(await auth.getRequestHeaders()), ...resourceKeyHeaders(fileId, resourceKey), ...(range ? { Range: range } : {}) },
    } as any)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (response.status === 403 && /cannotDownloadFile|download/i.test(text)) {
        return res.status(403).json({ code: 'DOWNLOAD_BLOCKED', message: 'Người chia sẻ đã chặn tải xuống tệp này, chỉ xem được trong trình xem của Google Drive.' })
      }
      noteGoogleError(account.id, { status: response.status, message: text })
      return res.status(response.status === 401 ? 502 : response.status).json({ code: 'GOOGLE_FILE_STREAM_FAILED', message: text || response.statusText })
    }

    res.status(response.status)
    for (const header of ['content-type', 'content-length', 'content-range']) {
      const value = response.headers.get(header)
      if (value) res.setHeader(header, value)
    }
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    if (!response.body) return res.end()
    await pipeline(Readable.fromWeb(response.body as any), res).catch(() => {
      if (!res.destroyed) res.destroy()
    })
  } catch (error) {
    return next(error)
  }
})

libraryRouter.use(requireAuth)

const loadOwnedLink = requireOwned<SavedLink>({
  notFoundCode: 'LINK_NOT_FOUND',
  load: (id, req) => prisma.savedLink.findFirst({ where: { id, ...ownedBy(req) } }),
})

libraryRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const [links, accounts] = await Promise.all([
      prisma.savedLink.findMany({ where: ownedBy(req), include: linkInclude, orderBy: [{ collection: 'asc' }, { title: 'asc' }] }),
      ownGoogleAccounts(req.user!.id),
    ])
    return res.json({
      links: links.map(serializeLink),
      accounts: accounts.map((account) => ({ id: account.id, email: account.email })),
    })
  } catch (error) {
    return next(error)
  }
})

const addSchema = z.object({
  url: z.string().trim().min(1).max(2000).optional(),
  fileId: z.string().regex(DRIVE_ID).optional(),
  accountId: z.string().uuid().optional(),
  collection: z.string().trim().max(120).optional(),
  title: z.string().trim().max(300).optional(),
}).refine((body) => body.url || body.fileId, { message: 'url or fileId is required' })

libraryRouter.post('/', async (req: AuthRequest, res, next) => {
  try {
    const body = addSchema.parse(req.body)
    const parsed = body.url ? parseDriveLink(body.url) : { fileId: body.fileId!, resourceKey: null }
    if (!parsed) return res.status(400).json({ code: 'INVALID_LINK', message: 'Link không phải link Google Drive / Google Docs.' })
    const userId = req.user!.id

    const existing = await prisma.savedLink.findFirst({ where: { userId, driveFileId: parsed.fileId }, include: linkInclude })
    if (existing) {
      const updated = body.collection !== undefined && body.collection !== existing.collection
        ? await prisma.savedLink.update({ where: { id: existing.id }, data: { collection: body.collection }, include: linkInclude })
        : existing
      return res.json({ link: serializeLink(updated), existed: true })
    }

    let found = await findAccountFor(userId, parsed.fileId, parsed.resourceKey, body.accountId)
    // A shortcut in "Shared with me" points at the real item: save that one.
    if (found?.meta.mimeType === SHORTCUT_MIME && found.meta.shortcutDetails?.targetId) {
      const target = found.meta.shortcutDetails
      parsed.fileId = target.targetId!
      parsed.resourceKey = target.targetResourceKey ?? null
      found = await findAccountFor(userId, parsed.fileId, parsed.resourceKey, found.account.id)
    }
    if (!found) return noAccess(res)

    const meta = found.meta
    const owner = meta.owners?.[0]
    const link = await prisma.savedLink.create({
      data: {
        userId,
        connectedAccountId: found.account.id,
        driveFileId: parsed.fileId,
        resourceKey: meta.resourceKey ?? parsed.resourceKey,
        url: body.url ?? meta.webViewLink ?? `https://drive.google.com/open?id=${parsed.fileId}`,
        title: body.title || meta.name || parsed.fileId,
        mimeType: meta.mimeType ?? 'application/octet-stream',
        ownerName: owner?.displayName ?? null,
        ownerEmail: owner?.emailAddress ?? null,
        collection: body.collection ?? '',
      },
      include: linkInclude,
    })
    return res.status(201).json({ link: serializeLink(link), existed: false })
  } catch (error) {
    return next(error)
  }
})

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  collection: z.string().trim().max(120).optional(),
  note: z.string().max(5000).optional(),
})

libraryRouter.patch('/:id', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    const data = patchSchema.parse(req.body)
    const link = await prisma.savedLink.update({ where: { id: req.owned!.id }, data, include: linkInclude })
    return res.json({ link: serializeLink(link) })
  } catch (error) {
    return next(error)
  }
})

libraryRouter.delete('/:id', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    await prisma.savedLink.delete({ where: { id: req.owned!.id } })
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

const renameCollectionSchema = z.object({ from: z.string().trim().max(120), to: z.string().trim().max(120) })

/** Renames a course (group) on every link in it; an empty `to` ungroups them. */
libraryRouter.post('/collections/rename', async (req: AuthRequest, res, next) => {
  try {
    const { from, to } = renameCollectionSchema.parse(req.body)
    const result = await prisma.savedLink.updateMany({ where: { ...ownedBy(req), collection: from }, data: { collection: to } })
    return res.json({ updated: result.count })
  } catch (error) {
    return next(error)
  }
})

const naturalName = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' })

/** Lessons: the contents of the shared folder (or a subfolder of it), or the shared file itself. */
libraryRouter.get('/:id/items', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    const link = req.owned!
    const folderId = typeof req.query.folderId === 'string' && req.query.folderId ? req.query.folderId : null
    if (folderId && !DRIVE_ID.test(folderId)) return res.status(400).json({ code: 'INVALID_FOLDER', message: 'Invalid folder id.' })
    const rk = typeof req.query.rk === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(req.query.rk) ? req.query.rk : null
    const account = await accountForLink(link)
    if (!account) return noAccess(res)
    const drive = await driveFor(account)

    let files: drive_v3.Schema$File[] = []
    try {
      if (link.mimeType === FOLDER_MIME) {
        const parent = folderId ?? link.driveFileId
        const headers = resourceKeyHeaders(parent, parent === link.driveFileId ? link.resourceKey : rk)
        let pageToken: string | undefined
        do {
          const page: { data: drive_v3.Schema$FileList } = await drive.files.list({
            q: `'${parent}' in parents and trashed = false`,
            fields: ITEM_FIELDS,
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          }, { headers })
          files.push(...(page.data.files ?? []))
          pageToken = page.data.nextPageToken ?? undefined
        } while (pageToken && files.length < 5000)
      } else {
        const meta = await drive.files.get({ fileId: link.driveFileId, fields: ITEM_FIELDS.replace(/^nextPageToken,files\((.*)\)$/, '$1'), supportsAllDrives: true }, { headers: resourceKeyHeaders(link.driveFileId, link.resourceKey) })
        files = [meta.data]
      }
    } catch (error) {
      noteGoogleError(account.id, error)
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status === 404 || status === 403) return noAccess(res)
      throw error
    }

    if (!folderId) await prisma.savedLink.update({ where: { id: link.id }, data: { lastOpenedAt: new Date() } })
    const progress = await prisma.savedLinkProgress.findMany({ where: { savedLinkId: link.id, driveFileId: { in: files.map((file) => file.shortcutDetails?.targetId ?? file.id ?? '') } } })
    const progressById = new Map(progress.map((entry) => [entry.driveFileId, entry]))

    const items = files
      .filter((file) => file.id && file.name)
      .map((file) => {
        // Shortcuts inside a course folder behave like the item they point to.
        const id = file.shortcutDetails?.targetId ?? file.id!
        const mimeType = file.shortcutDetails?.targetMimeType ?? file.mimeType ?? 'application/octet-stream'
        const resourceKey = file.shortcutDetails ? file.shortcutDetails.targetResourceKey ?? null : file.resourceKey ?? null
        const isFolder = mimeType === FOLDER_MIME
        const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.')
        const canDownload = file.capabilities?.canDownload !== false
        const entry = progressById.get(id)
        return {
          id,
          name: file.name!,
          mimeType,
          isFolder,
          size: file.size ?? null,
          durationSeconds: file.videoMediaMetadata?.durationMillis ? Math.round(Number(file.videoMediaMetadata.durationMillis) / 1000) : null,
          canDownload,
          resourceKey,
          webViewLink: file.webViewLink ?? null,
          previewUrl: isFolder ? null : previewUrl(id, resourceKey),
          streamUrl: !isFolder && !isGoogleDoc && canDownload ? streamPath(link.id, id, resourceKey) : null,
          completed: Boolean(entry?.completedAt),
          positionSeconds: entry?.positionSeconds ?? 0,
        }
      })
      .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || naturalName.compare(a.name, b.name))

    return res.json({ items, account: { id: account.id, email: account.email } })
  } catch (error) {
    return next(error)
  }
})

const progressSchema = z.object({
  fileId: z.string().regex(DRIVE_ID),
  completed: z.boolean().optional(),
  positionSeconds: z.number().int().min(0).max(1_000_000).optional(),
})

libraryRouter.put('/:id/progress', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    const body = progressSchema.parse(req.body)
    const completedAt = body.completed === undefined ? undefined : body.completed ? new Date() : null
    const entry = await prisma.savedLinkProgress.upsert({
      where: { savedLinkId_driveFileId: { savedLinkId: req.owned!.id, driveFileId: body.fileId } },
      create: { savedLinkId: req.owned!.id, driveFileId: body.fileId, completedAt: completedAt ?? null, positionSeconds: body.positionSeconds ?? 0 },
      update: { ...(completedAt !== undefined ? { completedAt } : {}), ...(body.positionSeconds !== undefined ? { positionSeconds: body.positionSeconds } : {}) },
    })
    return res.json({ completed: Boolean(entry.completedAt), positionSeconds: entry.positionSeconds })
  } catch (error) {
    return next(error)
  }
})
