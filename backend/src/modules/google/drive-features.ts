import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Router, Response, NextFunction } from 'express'
import type { ConnectedAccount, File } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import type { AuthRequest } from '../../middleware/auth.middleware.js'
import { createAuditLog } from '../../utils/audit.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { signId } from '../../utils/signed-url.js'
import { getAuthedGoogleClient, getGoogleDriveClient, ensureGoogleAppFolder, syncGoogleQuota } from './google.service.js'
import { shareError, toDriveError } from './drive-sharing.js'
import { ensureAccountFolderPath, buildMergedFolders, loadVisibleFolders } from '../folders/merged-folders.js'

// Google Drive features reached through each account's token, beyond list/upload/download/share:
// copies, new Google Docs, export formats, shortcuts, details, comments, version history and locks.
// Mounted on the files router; account-wide actions (empty trash, upload into any Drive folder)
// are in mountAccountDriveRoutes below.

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
export type FileResolver = (id: string, userId: string) => Promise<FileWithAccount | null>

export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
export const GOOGLE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'

export const googleDocKinds = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  form: 'application/vnd.google-apps.form',
} as const

// Office files Google converts on upload (when the user turned conversion on).
const convertibleUploads: Array<{ test: (mime: string, name: string) => boolean; target: string }> = [
  { test: (mime, name) => mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mime === 'application/msword' || /\.(docx?|odt|rtf)$/i.test(name), target: googleDocKinds.document },
  { test: (mime, name) => mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mime === 'application/vnd.ms-excel' || mime === 'text/csv' || /\.(xlsx?|ods|csv)$/i.test(name), target: googleDocKinds.spreadsheet },
  { test: (mime, name) => mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || mime === 'application/vnd.ms-powerpoint' || /\.(pptx?|odp)$/i.test(name), target: googleDocKinds.presentation },
]

/** The Google type an upload becomes when conversion is on, or null to keep the file as it is. */
export function conversionTargetFor(mimeType: string, fileName: string) {
  return convertibleUploads.find((rule) => rule.test(mimeType, fileName))?.target ?? null
}

/** Signed URL the browser can put in an <img> (see public.routes.ts). */
export function thumbnailUrlFor(file: { id: string; provider: string; mimeType: string }) {
  if (file.provider !== 'google_drive' || file.mimeType === GOOGLE_FOLDER_MIME || file.mimeType === GOOGLE_SHORTCUT_MIME) return null
  return `/public/thumbnails/${signId('thumbnail', file.id)}`
}

function driveFor(account: ConnectedAccount) {
  return getAuthedGoogleClient(account).then((auth) => getGoogleDriveClient(auth, getAccountProxyUrl(account)))
}

/** Changing a file on Drive: the person who added it to HCDrive, or the owner of its storage account. */
function canModify(file: FileWithAccount, userId: string) {
  return file.userId === userId || file.connectedAccount.userId === userId
}

function handle(task: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await task(req, res)
    } catch (error) {
      next(toDriveError(error))
    }
  }
}

const exportExtensions: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/x-vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/rtf': '.rtf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'text/markdown': '.md',
  'application/zip': '.zip',
  'application/epub+zip': '.epub',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'application/vnd.google-apps.script+json': '.json',
  'text/html': '.html',
}

export function exportExtension(mimeType: string) {
  return exportExtensions[mimeType] ?? ''
}

// Export formats per Google type, from about.get. The list is the same for every account, so one
// answer is kept for the life of the process.
let exportFormatsCache: Record<string, string[]> | null = null

async function exportFormatsFor(account: ConnectedAccount, mimeType: string) {
  if (!exportFormatsCache) {
    const drive = await driveFor(account)
    const about = await drive.about.get({ fields: 'exportFormats' })
    exportFormatsCache = (about.data.exportFormats ?? {}) as Record<string, string[]>
  }
  return exportFormatsCache[mimeType] ?? []
}

const fileFields = 'id,name,mimeType,size,modifiedTime,parents,starred,shortcutDetails(targetId)'

async function recordDriveFile(userId: string, account: ConnectedAccount, folderId: string | null, item: { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null; modifiedTime?: string | null; shortcutDetails?: { targetId?: string | null } | null }) {
  if (!item.id) throw shareError(502, 'GOOGLE_NO_ID', 'Google Drive did not return the new file.')
  const data = {
    userId,
    connectedAccountId: account.id,
    provider: 'google_drive',
    providerFileId: item.id,
    name: item.name ?? 'Untitled',
    mimeType: item.mimeType ?? 'application/octet-stream',
    sizeBytes: BigInt(item.size ?? 0),
    folderId,
    status: 'active',
    shortcutTargetId: item.shortcutDetails?.targetId ?? null,
    ...(item.modifiedTime ? { createdAt: new Date(item.modifiedTime) } : {}),
  }
  // A live folder read may have recorded it already.
  const known = await prisma.file.findFirst({ where: { connectedAccountId: account.id, providerFileId: item.id } })
  return known ? prisma.file.update({ where: { id: known.id }, data }) : prisma.file.create({ data })
}

function serializeFile(file: File) {
  return { ...file, sizeBytes: file.sizeBytes.toString(), thumbnailUrl: thumbnailUrlFor(file) }
}

/** The Drive folder (and HCDrive folder) a new item goes in: the account's copy of the merged folder, or the Drive root. */
async function drivePlacement(userId: string, account: ConnectedAccount, folderId: string | null | undefined) {
  if (!folderId) return { parentId: await ensureGoogleAppFolder(account), folderId: null as string | null }
  const target = await ensureAccountFolderPath(userId, account.id, await driveFor(account), folderId)
  if (!target) throw shareError(404, 'FOLDER_NOT_FOUND', 'Folder not found.')
  return { parentId: target.providerFolderId, folderId: target.folderId }
}

const revisionFields = 'revisions(id,modifiedTime,keepForever,size,originalFilename,mimeType,published,lastModifyingUser(displayName,emailAddress,photoLink,me),exportLinks)'
const commentFields = 'id,content,createdTime,modifiedTime,resolved,deleted,quotedFileContent(value),author(displayName,photoLink,emailAddress,me),replies(id,content,createdTime,action,deleted,author(displayName,photoLink,emailAddress,me))'
const detailFields = 'id,name,description,mimeType,size,createdTime,modifiedTime,viewedByMeTime,md5Checksum,webViewLink,starred,copyRequiresWriterPermission,lastModifyingUser(displayName,emailAddress,photoLink),owners(displayName,emailAddress,photoLink),imageMediaMetadata(width,height,cameraMake,cameraModel,time,location),videoMediaMetadata(width,height,durationMillis),contentRestrictions(readOnly,reason,restrictingUser(displayName,emailAddress),restrictionTime),capabilities(canEdit,canComment,canCopy,canDownload,canModifyContentRestriction,canShare),shortcutDetails(targetId,targetMimeType)'

/** Streams a Drive URL (revision content, export link) to the browser as a download. */
async function streamDriveUrl(account: ConnectedAccount, url: string, fileName: string, mimeType: string, res: Response) {
  const auth = await getAuthedGoogleClient(account)
  const headers = Object.fromEntries(Object.entries(await auth.getRequestHeaders()).map(([key, value]) => [key, String(value)]))
  const response = await fetch(url, { headers, dispatcher: getUndiciDispatcher(getAccountProxyUrl(account)) } as RequestInit)
  if (!response.ok || !response.body) {
    const message = await response.text().catch(() => response.statusText)
    return res.status(response.status === 401 ? 502 : response.status).json({ code: 'GOOGLE_DOWNLOAD_FAILED', message: message || response.statusText })
  }
  res.setHeader('Content-Type', response.headers.get('content-type') ?? mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  const length = response.headers.get('content-length')
  if (length) res.setHeader('Content-Length', length)
  await pipeline(Readable.fromWeb(response.body as never), res).catch(() => {
    if (!res.destroyed) res.destroy()
  })
}

export function mountDriveFeatureRoutes(router: Router, resolveFile: FileResolver) {
  async function googleFile(req: AuthRequest, { write = false } = {}) {
    const file = await resolveFile(String(req.params.id), req.user!.id)
    if (!file) throw shareError(404, 'FILE_NOT_FOUND', 'File not found.')
    if (file.provider !== 'google_drive') throw shareError(400, 'UNSUPPORTED_PROVIDER', 'Tính năng này chỉ có cho tệp Google Drive.')
    if (write && !canModify(file, req.user!.id)) throw shareError(403, 'FILE_NOT_ALLOWED', 'Chỉ người tải tệp lên hoặc chủ tài khoản lưu trữ mới làm được việc này.')
    return file
  }

  // New Google Docs, Sheets, Slides or Forms, in the open folder (merged folders: the copy in the
  // chosen account). Without an account, the user's own Google account with the most free space.
  router.post('/google-doc', handle(async (req, res) => {
    const body = z.object({
      kind: z.enum(['document', 'spreadsheet', 'presentation', 'form']),
      name: z.string().trim().min(1).max(255).optional(),
      folderId: z.string().nullable().optional(),
      accountId: z.string().optional(),
    }).parse(req.body)
    const userId = req.user!.id
    let accountId = body.accountId
    if (!accountId && body.folderId) {
      const members = buildMergedFolders(await loadVisibleFolders(userId)).members(body.folderId)
      accountId = members.find((member) => member.connectedAccountId)?.connectedAccountId ?? undefined
    }
    const candidates = await prisma.connectedAccount.findMany({
      where: { provider: 'google_drive', status: 'connected', OR: [{ userId }, { isShared: true }], ...(accountId ? { id: accountId } : {}) },
      include: { storageAccount: true },
    })
    candidates.sort((a, b) => Number(b.userId === userId) - Number(a.userId === userId) || Number((b.storageAccount?.availableBytes ?? 0n) - (a.storageAccount?.availableBytes ?? 0n)))
    const account = candidates[0]
    if (!account) throw shareError(400, 'NO_GOOGLE_ACCOUNT', 'Chưa có tài khoản Google Drive nào để tạo tệp.')
    const placement = await drivePlacement(userId, account, body.folderId)
    const defaultNames = { document: 'Tài liệu không có tiêu đề', spreadsheet: 'Bảng tính không có tiêu đề', presentation: 'Bản trình bày không có tiêu đề', form: 'Biểu mẫu không có tiêu đề' }
    const drive = await driveFor(account)
    const created = await drive.files.create({
      requestBody: { name: body.name || defaultNames[body.kind], mimeType: googleDocKinds[body.kind], parents: [placement.parentId] },
      fields: `${fileFields},webViewLink`,
      supportsAllDrives: true,
    })
    const file = await recordDriveFile(userId, account, placement.folderId, created.data)
    await createAuditLog(userId, 'CREATE_GOOGLE_DOC', 'file', file.id, { name: file.name, kind: body.kind })
    res.status(201).json({ file: serializeFile(file), webViewLink: created.data.webViewLink ?? null })
  }))

  router.post('/:id/copy', handle(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(255).optional() }).parse(req.body ?? {})
    const source = await googleFile(req)
    const drive = await driveFor(source.connectedAccount)
    const copied = await drive.files.copy({
      fileId: source.providerFileId,
      requestBody: { name: body.name || `Bản sao của ${source.name}` },
      fields: fileFields,
      supportsAllDrives: true,
    })
    const file = await recordDriveFile(req.user!.id, source.connectedAccount, source.folderId, copied.data)
    await createAuditLog(req.user!.id, 'COPY_FILE', 'file', file.id, { name: file.name, from: source.id })
    res.status(201).json({ file: serializeFile(file) })
  }))

  router.get('/:id/export-formats', handle(async (req, res) => {
    const file = await googleFile(req)
    const formats = file.mimeType.startsWith('application/vnd.google-apps.') ? await exportFormatsFor(file.connectedAccount, file.mimeType) : []
    res.json({ formats: formats.map((mimeType) => ({ mimeType, extension: exportExtension(mimeType) })) })
  }))

  // A shortcut lives in the same account as its target (Drive does not link across accounts).
  router.post('/:id/shortcut', handle(async (req, res) => {
    const body = z.object({ folderId: z.string().nullable() }).parse(req.body)
    const target = await googleFile(req)
    const placement = await drivePlacement(req.user!.id, target.connectedAccount, body.folderId)
    const drive = await driveFor(target.connectedAccount)
    const created = await drive.files.create({
      requestBody: { name: target.name, mimeType: GOOGLE_SHORTCUT_MIME, shortcutDetails: { targetId: target.providerFileId }, parents: [placement.parentId] },
      fields: fileFields,
      supportsAllDrives: true,
    })
    const file = await recordDriveFile(req.user!.id, target.connectedAccount, placement.folderId, created.data)
    res.status(201).json({ file: serializeFile(file) })
  }))

  // Details Google keeps about the file: description, who changed it last, image/video facts, lock.
  router.get('/:id/drive-details', handle(async (req, res) => {
    const file = await googleFile(req)
    const drive = await driveFor(file.connectedAccount)
    const details = await drive.files.get({ fileId: file.providerFileId, fields: detailFields, supportsAllDrives: true })
    res.json({ details: details.data, accountEmail: file.connectedAccount.email, canModify: canModify(file, req.user!.id) })
  }))

  router.patch('/:id/drive-details', handle(async (req, res) => {
    const body = z.object({ description: z.string().max(25_000) }).parse(req.body)
    const file = await googleFile(req, { write: true })
    const drive = await driveFor(file.connectedAccount)
    await drive.files.update({ fileId: file.providerFileId, requestBody: { description: body.description }, supportsAllDrives: true })
    res.json({ status: 'ok' })
  }))

  // Lock: Drive refuses edits to the content until someone with edit access unlocks it.
  router.post('/:id/lock', handle(async (req, res) => {
    const body = z.object({ locked: z.boolean(), reason: z.string().trim().max(500).optional() }).parse(req.body)
    const file = await googleFile(req, { write: true })
    const drive = await driveFor(file.connectedAccount)
    await drive.files.update({
      fileId: file.providerFileId,
      requestBody: { contentRestrictions: [body.locked ? { readOnly: true, ...(body.reason ? { reason: body.reason } : {}) } : { readOnly: false }] },
      supportsAllDrives: true,
    })
    await createAuditLog(req.user!.id, body.locked ? 'LOCK_FILE' : 'UNLOCK_FILE', 'file', file.id, { name: file.name })
    res.json({ status: 'ok', locked: body.locked })
  }))

  // Comments
  router.get('/:id/comments', handle(async (req, res) => {
    const file = await googleFile(req)
    const drive = await driveFor(file.connectedAccount)
    const comments: unknown[] = []
    let pageToken: string | undefined
    do {
      const page = await drive.comments.list({ fileId: file.providerFileId, fields: `nextPageToken,comments(${commentFields})`, pageSize: 100, pageToken })
      comments.push(...(page.data.comments ?? []))
      pageToken = page.data.nextPageToken ?? undefined
    } while (pageToken && comments.length < 500)
    res.json({ comments })
  }))

  router.post('/:id/comments', handle(async (req, res) => {
    const body = z.object({ content: z.string().trim().min(1).max(20_000) }).parse(req.body)
    const file = await googleFile(req)
    const drive = await driveFor(file.connectedAccount)
    const comment = await drive.comments.create({ fileId: file.providerFileId, fields: commentFields, requestBody: { content: body.content } })
    res.status(201).json({ comment: comment.data })
  }))

  // A reply, optionally resolving or reopening the thread (Drive records that as the reply's action).
  router.post('/:id/comments/:commentId/replies', handle(async (req, res) => {
    const body = z.object({ content: z.string().trim().max(20_000).optional(), action: z.enum(['resolve', 'reopen']).optional() })
      .refine((value) => Boolean(value.content) || Boolean(value.action), { message: 'content or action is required' })
      .parse(req.body)
    const file = await googleFile(req)
    const drive = await driveFor(file.connectedAccount)
    const reply = await drive.replies.create({
      fileId: file.providerFileId,
      commentId: String(req.params.commentId),
      fields: 'id,content,createdTime,action,author(displayName,photoLink,me)',
      requestBody: { content: body.content || (body.action === 'resolve' ? 'Đã đánh dấu là đã giải quyết' : 'Đã mở lại'), ...(body.action ? { action: body.action } : {}) },
    })
    res.status(201).json({ reply: reply.data })
  }))

  router.delete('/:id/comments/:commentId', handle(async (req, res) => {
    const file = await googleFile(req)
    const drive = await driveFor(file.connectedAccount)
    await drive.comments.delete({ fileId: file.providerFileId, commentId: String(req.params.commentId) })
    res.json({ status: 'ok' })
  }))

  // Version history. Google Docs keep revisions that can only be exported; other files can be kept
  // forever, deleted, downloaded and restored (re-uploaded as the newest version).
  router.get('/:id/revisions', handle(async (req, res) => {
    const file = await googleFile(req)
    const drive = await driveFor(file.connectedAccount)
    const list = await drive.revisions.list({ fileId: file.providerFileId, fields: `nextPageToken,${revisionFields}`, pageSize: 200 })
    const revisions = (list.data.revisions ?? []).map((revision) => ({
      ...revision,
      exportFormats: Object.keys(revision.exportLinks ?? {}).map((mimeType) => ({ mimeType, extension: exportExtension(mimeType) })),
      exportLinks: undefined,
    }))
    res.json({ revisions, isGoogleDoc: file.mimeType.startsWith('application/vnd.google-apps.'), canModify: canModify(file, req.user!.id) })
  }))

  router.get('/:id/revisions/:revisionId/download', handle(async (req, res) => {
    const query = z.object({ format: z.string().optional() }).parse(req.query)
    const file = await googleFile(req)
    const revisionId = String(req.params.revisionId)
    const drive = await driveFor(file.connectedAccount)
    const revision = await drive.revisions.get({ fileId: file.providerFileId, revisionId, fields: 'id,modifiedTime,originalFilename,mimeType,exportLinks' })
    const stamp = (revision.data.modifiedTime ?? '').slice(0, 16).replace(/[:T]/g, '-')
    if (revision.data.exportLinks) {
      const format = query.format && revision.data.exportLinks[query.format] ? query.format : Object.keys(revision.data.exportLinks).find((mime) => mime === 'application/pdf') ?? Object.keys(revision.data.exportLinks)[0]
      if (!format) throw shareError(400, 'NO_EXPORT_FORMAT', 'Phiên bản này không xuất được.')
      return streamDriveUrl(file.connectedAccount, revision.data.exportLinks[format], `${file.name} (${stamp})${exportExtension(format)}`, format, res)
    }
    const name = revision.data.originalFilename || file.name
    return streamDriveUrl(file.connectedAccount, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.providerFileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`, stamp ? `${stamp} ${name}` : name, revision.data.mimeType ?? file.mimeType, res)
  }))

  router.patch('/:id/revisions/:revisionId', handle(async (req, res) => {
    const body = z.object({ keepForever: z.boolean() }).parse(req.body)
    const file = await googleFile(req, { write: true })
    const drive = await driveFor(file.connectedAccount)
    await drive.revisions.update({ fileId: file.providerFileId, revisionId: String(req.params.revisionId), requestBody: { keepForever: body.keepForever } })
    res.json({ status: 'ok' })
  }))

  router.delete('/:id/revisions/:revisionId', handle(async (req, res) => {
    const file = await googleFile(req, { write: true })
    const drive = await driveFor(file.connectedAccount)
    await drive.revisions.delete({ fileId: file.providerFileId, revisionId: String(req.params.revisionId) })
    res.json({ status: 'ok' })
  }))

  router.post('/:id/revisions/:revisionId/restore', handle(async (req, res) => {
    const file = await googleFile(req, { write: true })
    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      throw shareError(400, 'RESTORE_NOT_SUPPORTED', 'Google không cho khôi phục phiên bản Docs/Sheets/Slides qua API; hãy mở tệp trên Google Drive → Lịch sử phiên bản.')
    }
    const revisionId = String(req.params.revisionId)
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const headers = Object.fromEntries(Object.entries(await auth.getRequestHeaders()).map(([key, value]) => [key, String(value)]))
    const old = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.providerFileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`, { headers, dispatcher: getUndiciDispatcher(getAccountProxyUrl(file.connectedAccount)) } as RequestInit)
    if (!old.ok || !old.body) throw shareError(old.status === 401 ? 502 : old.status, 'GOOGLE_DOWNLOAD_FAILED', await old.text().catch(() => 'Không tải được phiên bản cũ.'))
    const drive = getGoogleDriveClient(auth, getAccountProxyUrl(file.connectedAccount))
    // The old content goes up as a new version, so the versions after it stay in the history.
    const updated = await drive.files.update({
      fileId: file.providerFileId,
      media: { mimeType: old.headers.get('content-type') ?? file.mimeType, body: Readable.fromWeb(old.body as never) },
      fields: 'id,size,modifiedTime',
      supportsAllDrives: true,
    })
    await prisma.file.update({ where: { id: file.id }, data: { sizeBytes: BigInt(updated.data.size ?? 0), ...(updated.data.modifiedTime ? { createdAt: new Date(updated.data.modifiedTime) } : {}) } })
    await createAuditLog(req.user!.id, 'RESTORE_REVISION', 'file', file.id, { name: file.name, revisionId })
    res.json({ status: 'ok' })
  }))
}

/** Account-wide Drive actions, mounted on the connected-accounts router. */
export function mountAccountDriveRoutes(router: Router, requireAuthMiddleware: (req: AuthRequest, res: Response, next: NextFunction) => unknown) {
  // Empties the whole Google trash of the account (everything trashed there, not only what HCDrive lists).
  router.post('/:id/empty-trash', requireAuthMiddleware, handle(async (req, res) => {
    const account = await prisma.connectedAccount.findFirst({ where: { id: String(req.params.id), userId: req.user!.id, provider: 'google_drive', status: 'connected' } })
    if (!account) throw shareError(404, 'ACCOUNT_NOT_FOUND', 'Chỉ chủ tài khoản mới dọn được thùng rác Google của nó.')
    const drive = await driveFor(account)
    await drive.files.emptyTrash({})
    const removed = await prisma.file.deleteMany({ where: { connectedAccountId: account.id, status: 'deleted' } })
    await syncGoogleQuota(account.id).catch(() => undefined)
    await createAuditLog(req.user!.id, 'EMPTY_GOOGLE_TRASH', 'connected_account', account.id, { email: account.email, rows: removed.count })
    res.json({ status: 'ok', removed: removed.count })
  }))

  // Upload straight into any Drive folder of the account, shared drives included (Live explorer).
  // The body is the raw file; it streams through to Google without touching the disk.
  router.post('/:id/drive-items/upload', requireAuthMiddleware, handle(async (req, res) => {
    const query = z.object({ parentId: z.string().min(1), name: z.string().min(1).max(255), mimeType: z.string().min(1).max(255).optional() }).parse(req.query)
    const account = await prisma.connectedAccount.findFirst({ where: { id: String(req.params.id), provider: 'google_drive', status: 'connected', OR: [{ userId: req.user!.id }, { isShared: true }] } })
    if (!account) throw shareError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.')
    const drive = await driveFor(account)
    const created = await drive.files.create({
      requestBody: { name: query.name, parents: [query.parentId] },
      media: { mimeType: query.mimeType || 'application/octet-stream', body: req },
      fields: 'id,name,mimeType,size',
      supportsAllDrives: true,
    })
    await createAuditLog(req.user!.id, 'UPLOAD_DRIVE_FOLDER', 'connected_account', account.id, { name: query.name, parentId: query.parentId })
    syncGoogleQuota(account.id).catch(() => undefined)
    res.status(201).json({ item: created.data })
  }))
}

