import fs from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { z } from 'zod'
import type { ConnectedAccount, SavedLink } from '@prisma/client'
import type { drive_v3 } from 'googleapis'
import { prisma } from '../../config/prisma.js'
import { optionalAuth, requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { verifyAccessToken } from '../../utils/jwt.js'
import { ownedBy, requireOwned, type OwnedRequest } from '../../middleware/ownership.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, getGoogleDriveClient, syncGoogleAppFolderFiles } from '../google/google.service.js'
import { googleDownloadExportMimeTypes, normalizeHeaders, withExtension, attemptGoogleBypassStream, resourceKeyHeaders } from '../files/stream-google-file.js'
import { ZipArchive } from 'archiver'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { noteGoogleError } from '../../utils/google-backoff.js'
import { signId, verifySignedId } from '../../utils/signed-url.js'
import { decryptText, encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { isGoogleRateLimit } from '../../utils/google-backoff.js'
import { mapLimit } from '../../utils/concurrency.js'
import { streamCachedOrFetch, readCacheMeta, touchCache, getCacheDataPath, getCacheProgress } from '../../services/temp-cache.service.js'

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
    const account = await prisma.connectedAccount.findFirst({ where: { id: link.connectedAccountId, provider: 'google_drive', status: 'connected' } })
    if (account) return account
  }
  const found = await findAccountFor(link.userId, link.driveFileId, link.resourceKey)
  if (!found) return null
  await prisma.savedLink.update({ where: { id: link.id }, data: { connectedAccountId: found.account.id } })
  return found.account
}

export type ShareMeta = { token: string; allowDownload: boolean }

export function parseShareMeta(raw: string | null): ShareMeta | null {
  if (!raw) return null
  try {
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw)
      return { token: String(parsed.token), allowDownload: parsed.allowDownload !== false }
    }
  } catch {
    // fallback for raw token string
  }
  return { token: raw, allowDownload: true }
}

export function getLinkShareMeta(link: SavedLink): ShareMeta | null {
  if (!link.shareTokenEncrypted) return null
  try {
    const raw = decryptText(link.shareTokenEncrypted)
    return parseShareMeta(raw)
  } catch {
    return null
  }
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

function parseLinkNote(note: string) {
  const isCourse = !note.includes('<!--isCourse:false-->')
  const cleanNote = note.replace(/<!--isCourse:(true|false)-->/g, '').trim()
  return { isCourse, cleanNote }
}

function formatNoteWithCourse(noteText: string | undefined, isCourse: boolean | undefined, existingNote = '') {
  const clean = (noteText !== undefined ? noteText : existingNote).replace(/<!--isCourse:(true|false)-->/g, '').trim()
  const courseFlag = isCourse !== undefined ? isCourse : !existingNote.includes('<!--isCourse:false-->')
  if (!courseFlag) {
    return clean ? `${clean} <!--isCourse:false-->` : '<!--isCourse:false-->'
  }
  return clean
}

function serializeLink(link: LinkWithAccount) {
  const { isCourse, cleanNote } = parseLinkNote(link.note)
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
    teacher: link.teacher,
    note: cleanNote,
    isCourse,
    shared: Boolean(link.shareTokenHash),
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

    // Check if downloading is requested and whether sharing allows download
    const downloadName = typeof req.query.download === 'string' && req.query.download.trim() ? req.query.download.slice(0, 200).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') : null
    let shareMeta: ShareMeta | null = null
    if (link.shareTokenEncrypted) {
      try {
        shareMeta = parseShareMeta(decryptText(link.shareTokenEncrypted))
      } catch {
        shareMeta = null
      }
    }
    if (downloadName && shareMeta && shareMeta.allowDownload === false) {
      const authHeader = req.header('Authorization')
      let isOwner = false
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const payload = verifyAccessToken(authHeader.slice(7))
          if (payload.sub === link.userId) isOwner = true
        } catch {
          // not owner
        }
      }
      if (!isOwner) {
        return res.status(403).json({ code: 'DOWNLOAD_BLOCKED', message: 'Người chia sẻ đã tắt tính năng tải xuống cho liên kết này.' })
      }
    }

    const account = await accountForLink(link)
    if (!account) return noAccess(res)

    const rk = typeof req.query.rk === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(req.query.rk) ? req.query.rk : null
    const resourceKey = fileId === link.driveFileId ? link.resourceKey : rk
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined

    // Stream from 30-minute server cache or download to cache and stream with full Range support
    const cachedSuccess = await streamCachedOrFetch(
      fileId,
      downloadName || 'file',
      range,
      res,
      async (rangeForFetch?: string) => {
        let authHeaders: Record<string, string> = {}
        try {
          const auth = await getAuthedGoogleClient(account)
          authHeaders = normalizeHeaders(await auth.getRequestHeaders())
        } catch {
          // Cookie-only account or token refresh failed: proceed directly to bypass stream
        }

        const dispatcher = getUndiciDispatcher(getAccountProxyUrl(account))
        const rkHeaders = resourceKeyHeaders(fileId, resourceKey)
        let response: globalThis.Response | null = null

        if (Object.keys(authHeaders).length > 0) {
          const fetchHeaders: Record<string, string> = {
            ...authHeaders,
            ...rkHeaders,
            ...(rangeForFetch ? { Range: rangeForFetch } : {}),
          }
          response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
            dispatcher,
            headers: fetchHeaders,
          } as any).catch(() => null)
        }

        if (!response || !response.ok) {
          // Attempt bypass for blocked Google Drive download
          const bypass = await attemptGoogleBypassStream(account, fileId, resourceKey, rangeForFetch)
          if (bypass && (bypass.status === 200 || bypass.status === 206)) {
            response = bypass
          } else {
            if (response) {
              const text = await response.text().catch(() => '')
              noteGoogleError(account.id, { status: response.status, message: text })
            }
            return null
          }
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('text/html') && !response.headers.get('content-disposition')?.includes('attachment')) {
          return null
        }

        const contentLength = response.headers.get('content-length')
        const sizeBytes = contentLength ? parseInt(contentLength, 10) : undefined
        if (!response.body) return null

        return {
          stream: response.body,
          contentType: contentType || 'application/octet-stream',
          sizeBytes,
          contentRange: response.headers.get('content-range') || undefined,
          status: response.status,
        }
      },
      {
        disposition: downloadName ? 'attachment' : 'inline',
        fileName: downloadName || undefined,
      }
    )

    if (!cachedSuccess && !res.headersSent) {
      return res.status(403).json({
        code: 'GOOGLE_STREAM_RESTRICTED',
        message: 'Google Drive giới hạn quyền stream/tải tệp này hoặc không thể kết nối tới Google Drive.',
      })
    }
  } catch (error) {
    return next(error)
  }
})

// Progress endpoint for stream/caching of a signed library item
libraryRouter.get('/stream-progress/:token', async (req, res, next) => {
  try {
    const signed = verifySignedId('library', String(req.params.token))
    const [_linkId, fileId] = signed?.split('~') ?? []
    if (!fileId || !DRIVE_ID.test(fileId)) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' })
    }
    const progress = getCacheProgress(fileId)
    return res.json(progress)
  } catch (error) {
    return next(error)
  }
})

// ---- Download a course (or one chapter) as a ZIP. Signed URL, so the browser saves it as it streams. ----
// Only what the owner lets this account download goes in; the rest is listed in a text file inside.

const ZIP_FIELDS = 'nextPageToken,files(id,name,mimeType,resourceKey,capabilities(canDownload),shortcutDetails(targetId,targetMimeType,targetResourceKey))'

type ZipEntry = { id: string; resourceKey: string | null; path: string; mimeType: string }

/** A name that is safe as a path segment inside a ZIP on Windows, macOS and Linux. */
function zipSafeName(name: string | null | undefined) {
  const cleaned = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim()
  return cleaned || 'untitled'
}

async function collectZipEntries(account: ConnectedAccount, drive: drive_v3.Drive, folderId: string, resourceKey: string | null, prefix: string, entries: ZipEntry[], skipped: string[], depth = 0) {
  if (depth > 20) return
  const children: drive_v3.Schema$File[] = []
  let pageToken: string | undefined
  do {
    const page: { data: drive_v3.Schema$FileList } = await withRetry(account.id, () => drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: ZIP_FIELDS,
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }, { headers: resourceKeyHeaders(folderId, resourceKey) }))
    children.push(...(page.data.files ?? []))
    pageToken = page.data.nextPageToken ?? undefined
  } while (pageToken)

  children.sort((a, b) => naturalName.compare(a.name ?? '', b.name ?? ''))
  const used = new Set<string>()
  for (const child of children) {
    const id = child.shortcutDetails?.targetId ?? child.id
    if (!id) continue
    const mimeType = child.shortcutDetails?.targetMimeType ?? child.mimeType ?? 'application/octet-stream'
    const key = child.shortcutDetails ? child.shortcutDetails.targetResourceKey ?? null : child.resourceKey ?? null
    const exportTarget = googleDownloadExportMimeTypes[mimeType]
    let name = zipSafeName(child.name)
    if (exportTarget) name = withExtension(name, exportTarget.extension)
    // Two items with the same name in one folder: "name (2).ext".
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = name.replace(/( \(\d+\))?(\.[^.]*)?$/, (_m, _d, ext = '') => ` (${n})${ext}`)
    used.add(name.toLowerCase())

    if (mimeType === FOLDER_MIME) {
      await collectZipEntries(account, drive, id, key, `${prefix}${name}/`, entries, skipped, depth + 1)
    } else if (mimeType.startsWith('application/vnd.google-apps.') && !exportTarget) {
      skipped.push(`${prefix}${name} (loại tệp Google không tải được)`)
    } else {
      // Do not skip if capabilities.canDownload === false; bypass stream will handle it if blocked
      entries.push({ id, resourceKey: key, path: `${prefix}${name}`, mimeType })
    }
  }
}

libraryRouter.get('/download/:token', async (req, res, next) => {
  try {
    const signed = verifySignedId('library-zip', String(req.params.token))
    const [linkId, folderPart] = signed?.split('~') ?? []
    if (!linkId || !folderPart || (folderPart !== 'root' && !DRIVE_ID.test(folderPart))) return res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' })
    const link = await prisma.savedLink.findUnique({ where: { id: linkId } })
    if (!link) return res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' })

    const shareMeta = getLinkShareMeta(link)
    if (shareMeta && shareMeta.allowDownload === false) {
      const authHeader = req.header('Authorization')
      let isOwner = false
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const payload = verifyAccessToken(authHeader.slice(7))
          if (payload.sub === link.userId) isOwner = true
        } catch {}
      }
      if (!isOwner) {
        return res.status(403).json({ code: 'DOWNLOAD_BLOCKED', message: 'Người chia sẻ đã tắt tính năng tải xuống cho liên kết này.' })
      }
    }

    const account = await accountForLink(link)
    if (!account) return noAccess(res)

    const baseName = zipSafeName(link.teacher ? `${link.title} - ${link.teacher}` : link.title)
    // A single shared file: plain download through the stream route.
    if (link.mimeType !== FOLDER_MIME) {
      const target = streamPath(link.id, link.driveFileId, link.resourceKey).replace('/library/', '../')
      return res.redirect(`${target}${target.includes('?') ? '&' : '?'}download=${encodeURIComponent(link.title)}`)
    }

    const rk = typeof req.query.rk === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(req.query.rk) ? req.query.rk : null
    const rootId = folderPart === 'root' ? link.driveFileId : folderPart
    const drive = await driveFor(account)
    const entries: ZipEntry[] = []
    const skipped: string[] = []
    await collectZipEntries(account, drive, rootId, folderPart === 'root' ? link.resourceKey : rk, '', entries, skipped)
    if (entries.length === 0 && skipped.length === 0) return res.status(404).json({ code: 'FOLDER_EMPTY', message: 'Khóa học không có tệp nào để tải.' })

    // The chapter name only names the file; the signed folder id decides what goes in.
    const chapter = typeof req.query.name === 'string' && req.query.name.trim() ? zipSafeName(req.query.name.slice(0, 150)) : null
    const zipName = folderPart === 'root' || !chapter ? baseName : `${baseName} - ${chapter}`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName.replace(/[^\x20-\x7e]/g, '_')}.zip"; filename*=UTF-8''${encodeURIComponent(zipName)}.zip`)
    res.setHeader('Cache-Control', 'no-store')

    // Videos do not shrink, so entries are stored, not compressed: less CPU, same size.
    const archive = new ZipArchive({ store: true })
    let closed = false
    req.on('close', () => {
      closed = true
      archive.abort()
    })
    archive.on('error', () => {
      if (!res.destroyed) res.destroy()
    })
    archive.pipe(res)

    for (const entry of entries) {
      if (closed) break
      try {
        // If file is already cached in temp cache, read directly from server disk
        const cached = readCacheMeta(entry.id)
        if (cached) {
          touchCache(entry.id)
          const added = new Promise((resolve) => archive.once('entry', resolve))
          archive.append(fs.createReadStream(getCacheDataPath(entry.id)), { name: `${zipName}/${entry.path}` })
          await added
          continue
        }

        // Asked per file: a long download outlives the hour an access token lasts.
        let authHeaders: Record<string, string> = {}
        try {
          const auth = await getAuthedGoogleClient(account)
          authHeaders = normalizeHeaders(await auth.getRequestHeaders())
        } catch {
          // Cookie-only account or token refresh failed: proceed directly to bypass stream
        }

        const exportTarget = googleDownloadExportMimeTypes[entry.mimeType]
        const url = exportTarget
          ? `https://www.googleapis.com/drive/v3/files/${entry.id}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
          : `https://www.googleapis.com/drive/v3/files/${entry.id}?alt=media&supportsAllDrives=true`

        let response: globalThis.Response | null = null
        if (Object.keys(authHeaders).length > 0) {
          response = await fetch(url, {
            dispatcher: getUndiciDispatcher(getAccountProxyUrl(account)),
            headers: { ...authHeaders, ...resourceKeyHeaders(entry.id, entry.resourceKey) },
          } as any).catch(() => null)
        }

        if (!response || !response.ok || !response.body) {
          await response?.body?.cancel().catch(() => undefined)
          // Attempt Google download bypass
          const bypassRes = await attemptGoogleBypassStream(account, entry.id, entry.resourceKey)
          if (bypassRes && bypassRes.ok && bypassRes.body) {
            response = bypassRes
          } else {
            skipped.push(`${entry.path} (${response?.status === 403 ? 'người chia sẻ chặn tải xuống' : `lỗi ${response?.status || 'kết nối'}`})`)
            continue
          }
        }
        const added = new Promise((resolve) => archive.once('entry', resolve))
        archive.append(Readable.fromWeb(response.body as any), { name: `${zipName}/${entry.path}` })
        await added
      } catch (error) {
        noteGoogleError(account.id, error)
        skipped.push(`${entry.path} (lỗi: ${error instanceof Error ? error.message : String(error)})`)
      }
    }
    if (closed) return
    if (skipped.length) {
      archive.append(`Các tệp sau không có trong file ZIP:\r\n\r\n${skipped.join('\r\n')}\r\n`, { name: `${zipName}/_KHONG_TAI_DUOC.txt` })
    }
    await archive.finalize()
  } catch (error) {
    return next(error)
  }
})

// ---- Public share endpoints (can be accessed with or without login) ----

libraryRouter.get('/shared/:token', optionalAuth, async (req: AuthRequest, res, next) => {
  try {
    const token = String(req.params.token)
    const link = await prisma.savedLink.findUnique({
      where: { shareTokenHash: hashToken(token) },
      include: { user: { select: { name: true } } },
    })
    if (!link) return res.status(404).json({ code: 'SHARE_NOT_FOUND', message: 'Link chia sẻ không tồn tại hoặc đã bị tắt.' })

    const shareMeta = getLinkShareMeta(link)
    const allowDownload = shareMeta ? shareMeta.allowDownload : true

    const userId = req.user?.id
    let mine: { id: string } | null = null
    let access: { account: { email: string } } | null = null
    let accounts: { email: string }[] = []

    if (userId) {
      const [mineRes, accessRes, accountsRes] = await Promise.all([
        prisma.savedLink.findFirst({ where: { userId, driveFileId: link.driveFileId }, select: { id: true } }),
        findAccountFor(userId, link.driveFileId, link.resourceKey),
        ownGoogleAccounts(userId),
      ])
      mine = mineRes
      access = accessRes
      accounts = accountsRes
    }

    return res.json({
      course: {
        id: link.id,
        title: link.title,
        teacher: link.teacher,
        collection: link.collection,
        mimeType: link.mimeType,
        isFolder: link.mimeType === FOLDER_MIME,
        url: link.url,
        ownerName: link.ownerName,
        ownerEmail: link.ownerEmail,
        sharedBy: link.user.name,
        allowDownload,
        isCourse: parseLinkNote(link.note).isCourse,
      },
      savedLinkId: mine?.id ?? null,
      isLoggedIn: Boolean(userId),
      access: access ? { ok: true, accountEmail: access.account.email } : { ok: Boolean(link.connectedAccountId), accountEmail: null },
      accountEmails: accounts.map((account) => account.email),
    })
  } catch (error) {
    return next(error)
  }
})

libraryRouter.get('/shared/:token/items', async (req, res, next) => {
  try {
    const token = String(req.params.token)
    const link = await prisma.savedLink.findUnique({ where: { shareTokenHash: hashToken(token) } })
    if (!link) return res.status(404).json({ code: 'SHARE_NOT_FOUND', message: 'Link chia sẻ không tồn tại hoặc đã bị tắt.' })

    const shareMeta = getLinkShareMeta(link)
    const allowDownload = shareMeta ? shareMeta.allowDownload : true

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

    const items = files
      .filter((file) => file.id && file.name)
      .map((file) => {
        const id = file.shortcutDetails?.targetId ?? file.id!
        const mimeType = file.shortcutDetails?.targetMimeType ?? file.mimeType ?? 'application/octet-stream'
        const resourceKey = file.shortcutDetails ? file.shortcutDetails.targetResourceKey ?? null : file.resourceKey ?? null
        const isFolder = mimeType === FOLDER_MIME
        const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.')
        // canDownload reflects owner's share configuration (allowDownload) - HCDrive server bypasses Google Drive restrictions
        const canDownload = allowDownload
        return {
          id,
          name: file.name!,
          mimeType,
          isFolder,
          size: file.size ?? null,
          durationSeconds: file.videoMediaMetadata?.durationMillis ? Math.round(Number(file.videoMediaMetadata.durationMillis) / 1000) : null,
          canDownload,
          resourceKey,
          webViewLink: file.webViewLink ?? (id ? `https://drive.google.com/file/d/${id}/view` : null),
          previewUrl: isFolder ? null : previewUrl(id, resourceKey),
          streamUrl: !isFolder && !isGoogleDoc ? streamPath(link.id, id, resourceKey) : null,
          completed: false,
          positionSeconds: 0,
        }
      })
      .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || naturalName.compare(a.name, b.name))

    return res.json({ items, allowDownload })
  } catch (error) {
    return next(error)
  }
})

libraryRouter.post('/shared/:token/download-link', async (req, res, next) => {
  try {
    const body = downloadLinkSchema.parse(req.body ?? {})
    const link = await prisma.savedLink.findUnique({ where: { shareTokenHash: hashToken(String(req.params.token)) } })
    if (!link) return res.status(404).json({ code: 'SHARE_NOT_FOUND', message: 'Link chia sẻ không tồn tại hoặc đã bị tắt.' })
    const shareMeta = getLinkShareMeta(link)
    if (shareMeta && shareMeta.allowDownload === false) {
      return res.status(403).json({ code: 'DOWNLOAD_BLOCKED', message: 'Người chia sẻ đã tắt tính năng tải xuống cho liên kết này.' })
    }
    const token = signId('library-zip', `${link.id}~${body.folderId ?? 'root'}`)
    const query = new URLSearchParams()
    if (body.folderId && body.rk) query.set('rk', body.rk)
    if (body.folderId && body.name) query.set('name', body.name)
    return res.json({ path: `/library/download/${token}${query.size ? `?${query}` : ''}` })
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
  teacher: z.string().trim().max(200).optional(),
  note: z.string().max(5000).optional(),
  isCourse: z.boolean().optional(),
}).refine((body) => body.url || body.fileId, { message: 'url or fileId is required' })

type NewLink = {
  fileId: string
  resourceKey: string | null
  url?: string
  accountId?: string
  fallbackAccountId?: string
  collection?: string
  title?: string
  teacher?: string
  note?: string
  isCourse?: boolean
  mimeType?: string
  ownerName?: string | null
  ownerEmail?: string | null
}

/** Saves a link for the user, opened through one of their own Google accounts; null when none can open it. */
async function createSavedLink(userId: string, input: NewLink) {
  const existing = await prisma.savedLink.findFirst({ where: { userId, driveFileId: input.fileId }, include: linkInclude })
  if (existing) {
    const data: Record<string, unknown> = {
      ...(input.collection !== undefined && input.collection !== existing.collection ? { collection: input.collection } : {}),
      ...(input.teacher && !existing.teacher ? { teacher: input.teacher } : {}),
      ...(input.accountId && input.accountId !== existing.connectedAccountId ? { connectedAccountId: input.accountId } : {}),
      ...(input.isCourse !== undefined || input.note !== undefined ? { note: formatNoteWithCourse(input.note, input.isCourse, existing.note) } : {}),
    }
    const updated = Object.keys(data).length ? await prisma.savedLink.update({ where: { id: existing.id }, data, include: linkInclude }) : existing
    return { link: updated, existed: true }
  }

  let fileId = input.fileId
  let resourceKey = input.resourceKey
  let found = await findAccountFor(userId, fileId, resourceKey, input.accountId)
  // A shortcut in "Shared with me" points at the real item: save that one.
  if (found?.meta.mimeType === SHORTCUT_MIME && found.meta.shortcutDetails?.targetId) {
    const target = found.meta.shortcutDetails
    fileId = target.targetId!
    resourceKey = target.targetResourceKey ?? null
    found = await findAccountFor(userId, fileId, resourceKey, found.account.id)
  }

  // If user has no connected account with direct access, fall back to sharer's connected account
  if (!found && input.fallbackAccountId) {
    const fallbackAcc = await prisma.connectedAccount.findFirst({
      where: { id: input.fallbackAccountId, provider: 'google_drive', status: 'connected' },
    })
    if (fallbackAcc) {
      const link = await prisma.savedLink.create({
        data: {
          userId,
          connectedAccountId: fallbackAcc.id,
          driveFileId: fileId,
          resourceKey,
          url: input.url ?? `https://drive.google.com/open?id=${fileId}`,
          title: input.title || fileId,
          mimeType: input.mimeType ?? 'application/octet-stream',
          ownerName: input.ownerName ?? null,
          ownerEmail: input.ownerEmail ?? null,
          collection: input.collection ?? '',
          teacher: input.teacher ?? '',
          note: formatNoteWithCourse(input.note, input.isCourse),
        },
        include: linkInclude,
      })
      return { link, existed: false }
    }
  }

  if (!found) return null

  const meta = found.meta
  const owner = meta.owners?.[0]
  const link = await prisma.savedLink.create({
    data: {
      userId,
      connectedAccountId: found.account.id,
      driveFileId: fileId,
      resourceKey: meta.resourceKey ?? resourceKey,
      url: input.url ?? meta.webViewLink ?? `https://drive.google.com/open?id=${fileId}`,
      title: input.title || meta.name || fileId,
      mimeType: meta.mimeType ?? 'application/octet-stream',
      ownerName: owner?.displayName ?? null,
      ownerEmail: owner?.emailAddress ?? null,
      collection: input.collection ?? '',
      teacher: input.teacher ?? '',
      note: formatNoteWithCourse(input.note, input.isCourse),
    },
    include: linkInclude,
  })
  return { link, existed: false }
}

libraryRouter.post('/', async (req: AuthRequest, res, next) => {
  try {
    const body = addSchema.parse(req.body)
    const parsed = body.url ? parseDriveLink(body.url) : { fileId: body.fileId!, resourceKey: null }
    if (!parsed) return res.status(400).json({ code: 'INVALID_LINK', message: 'Link không phải link Google Drive / Google Docs.' })
    const result = await createSavedLink(req.user!.id, {
      ...parsed,
      url: body.url,
      accountId: body.accountId,
      collection: body.collection,
      title: body.title,
      teacher: body.teacher,
      note: body.note,
      isCourse: body.isCourse,
    })
    if (!result) return noAccess(res)
    return res.status(result.existed ? 200 : 201).json({ link: serializeLink(result.link), existed: result.existed })
  } catch (error) {
    return next(error)
  }
})

// ---- Save shared link into user's own library ----

const sharePath = (token: string) => `/library/s/${token}`

libraryRouter.post('/shared/:token/save', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ collection: z.string().trim().max(120).optional() }).parse(req.body ?? {})
    const link = await prisma.savedLink.findUnique({ where: { shareTokenHash: hashToken(String(req.params.token)) } })
    if (!link) return res.status(404).json({ code: 'SHARE_NOT_FOUND', message: 'Link chia sẻ không tồn tại hoặc đã bị tắt.' })
    const result = await createSavedLink(req.user!.id, {
      fileId: link.driveFileId,
      resourceKey: link.resourceKey,
      url: link.url,
      collection: body.collection ?? link.collection,
      title: link.title,
      teacher: link.teacher,
      mimeType: link.mimeType,
      ownerName: link.ownerName,
      ownerEmail: link.ownerEmail,
      fallbackAccountId: link.connectedAccountId ?? undefined,
    })
    if (!result) {
      return res.status(404).json({
        code: 'LINK_NOT_ACCESSIBLE',
        message: 'Không thể lưu khóa học này. Hãy thử lại sau hoặc kết nối tài khoản Google.',
      })
    }
    return res.status(result.existed ? 200 : 201).json({ link: serializeLink(result.link), existed: result.existed })
  } catch (error) {
    return next(error)
  }
})

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  collection: z.string().trim().max(120).optional(),
  teacher: z.string().trim().max(200).optional(),
  note: z.string().max(5000).optional(),
  isCourse: z.boolean().optional(),
  accountId: z.string().trim().uuid().nullable().optional(),
})

libraryRouter.patch('/:id', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    const data = patchSchema.parse(req.body)
    const link = req.owned!
    const updateData: {
      title?: string
      collection?: string
      teacher?: string
      note?: string
      connectedAccountId?: string | null
    } = {}

    if (data.title !== undefined) updateData.title = data.title
    if (data.collection !== undefined) updateData.collection = data.collection
    if (data.teacher !== undefined) updateData.teacher = data.teacher
    if (data.note !== undefined || data.isCourse !== undefined) {
      updateData.note = formatNoteWithCourse(data.note, data.isCourse, link.note)
    }

    if (data.accountId !== undefined) {
      if (data.accountId === null) {
        const found = await findAccountFor(req.user!.id, link.driveFileId, link.resourceKey)
        if (found) {
          updateData.connectedAccountId = found.account.id
        }
      } else {
        const account = await prisma.connectedAccount.findFirst({
          where: { id: data.accountId, userId: req.user!.id, provider: 'google_drive', status: 'connected' },
        })
        if (!account) {
          return res.status(400).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Tài khoản Google không tồn tại hoặc chưa kết nối.' })
        }
        updateData.connectedAccountId = account.id
      }
    }

    const updated = await prisma.savedLink.update({ where: { id: link.id }, data: updateData, include: linkInclude })
    return res.json({ link: serializeLink(updated) })
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
        const entry = progressById.get(id)
        return {
          id,
          name: file.name!,
          mimeType,
          isFolder,
          size: file.size ?? null,
          durationSeconds: file.videoMediaMetadata?.durationMillis ? Math.round(Number(file.videoMediaMetadata.durationMillis) / 1000) : null,
          canDownload: true, // In user's own library, all items can be downloaded/streamed via server bypass
          resourceKey,
          webViewLink: file.webViewLink ?? (id ? `https://drive.google.com/file/d/${id}/view` : null),
          previewUrl: isFolder ? null : previewUrl(id, resourceKey),
          streamUrl: !isFolder && !isGoogleDoc ? streamPath(link.id, id, resourceKey) : null,
          completed: Boolean(entry?.completedAt),
          positionSeconds: entry?.positionSeconds ?? 0,
        }
      })
      .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || naturalName.compare(a.name, b.name))

    return res.json({ items, account: { id: account.id, email: account.email, hasCookie: Boolean(account.cookieEncrypted) } })
  } catch (error) {
    return next(error)
  }
})

libraryRouter.post('/:id/cookie', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const link = await prisma.savedLink.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
    })
    if (!link) return res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' })
    const account = await accountForLink(link)
    if (!account) return noAccess(res)

    const cookie = typeof req.body?.cookie === 'string' ? req.body.cookie.trim() : ''
    const cookieEncrypted = cookie ? encryptText(cookie) : null

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { cookieEncrypted },
    })

    return res.json({ success: true, hasCookie: Boolean(cookieEncrypted) })
  } catch (error) {
    return next(error)
  }
})

const shareConfigSchema = z.object({
  allowDownload: z.boolean().optional(),
})

libraryRouter.get('/:id/share', loadOwnedLink, (req: OwnedRequest<SavedLink>, res) => {
  const link = req.owned!
  const meta = getLinkShareMeta(link)
  return res.json({
    path: meta ? sharePath(meta.token) : null,
    allowDownload: meta ? meta.allowDownload : true,
  })
})

libraryRouter.post('/:id/share', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    const body = shareConfigSchema.parse(req.body ?? {})
    const link = req.owned!
    const allowDownload = body.allowDownload !== false
    let token: string | null = null

    if (link.shareTokenEncrypted) {
      try {
        const meta = parseShareMeta(decryptText(link.shareTokenEncrypted))
        token = meta?.token ?? null
      } catch {
        token = null
      }
    }
    if (!token) {
      token = randomToken(24)
    }

    const payload = JSON.stringify({ token, allowDownload })
    await prisma.savedLink.update({
      where: { id: link.id },
      data: {
        shareTokenHash: hashToken(token),
        shareTokenEncrypted: encryptText(payload),
      },
    })
    return res.status(201).json({ path: sharePath(token), allowDownload })
  } catch (error) {
    return next(error)
  }
})

libraryRouter.delete('/:id/share', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    await prisma.savedLink.update({ where: { id: req.owned!.id }, data: { shareTokenHash: null, shareTokenEncrypted: null } })
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

const downloadLinkSchema = z.object({
  folderId: z.string().regex(DRIVE_ID).optional(),
  rk: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
  name: z.string().max(150).optional(),
})

/** A signed URL that downloads the course (or the chapter `folderId`) as a ZIP; valid for a few hours. */
libraryRouter.post('/:id/download-link', loadOwnedLink, (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    const body = downloadLinkSchema.parse(req.body ?? {})
    const link = req.owned!
    const token = signId('library-zip', `${link.id}~${body.folderId ?? 'root'}`)
    const query = new URLSearchParams()
    if (body.folderId && body.rk) query.set('rk', body.rk)
    if (body.folderId && body.name) query.set('name', body.name)
    return res.json({ path: `/library/download/${token}${query.size ? `?${query}` : ''}` })
  } catch (error) {
    return next(error)
  }
})

// ---- Save the course into the user's own Drive (real copies, not shortcuts) ----

type CopyJob = {
  status: 'running' | 'done' | 'failed'
  accountEmail: string
  folderName: string
  folderUrl: string | null
  copied: number
  folders: number
  /** Files the owner does not allow copying (Drive refuses them). */
  skipped: number
  failed: number
  current: string | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

const copyJobs = new Map<string, CopyJob>()
const COPY_FIELDS = 'nextPageToken,files(id,name,mimeType,resourceKey,capabilities(canCopy),shortcutDetails(targetId,targetMimeType,targetResourceKey))'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs a Drive call, waiting out per-minute limits instead of failing the whole copy. */
async function withRetry<T>(accountId: string, call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call()
    } catch (error) {
      if (!isGoogleRateLimit(error) || attempt >= 3) {
        noteGoogleError(accountId, error)
        throw error
      }
      await wait(30_000 * (attempt + 1))
    }
  }
}

async function copyFolderTree(
  sourceAccount: ConnectedAccount,
  sourceDrive: drive_v3.Drive,
  targetAccount: ConnectedAccount,
  targetDrive: drive_v3.Drive,
  sourceId: string,
  resourceKey: string | null,
  targetParentId: string,
  job: CopyJob
) {
  const children: drive_v3.Schema$File[] = []
  let pageToken: string | undefined
  do {
    const page: { data: drive_v3.Schema$FileList } = await withRetry(sourceAccount.id, () => sourceDrive.files.list({
      q: `'${sourceId}' in parents and trashed = false`,
      fields: COPY_FIELDS,
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }, { headers: resourceKeyHeaders(sourceId, resourceKey) }))
    children.push(...(page.data.files ?? []))
    pageToken = page.data.nextPageToken ?? undefined
  } while (pageToken)

  const folders = children.filter((child) => (child.shortcutDetails?.targetMimeType ?? child.mimeType) === FOLDER_MIME)
  const files = children.filter((child) => !folders.includes(child))

  await mapLimit(files, 3, async (file) => {
    // A shortcut inside the course is copied as the file it points to.
    const id = file.shortcutDetails?.targetId ?? file.id!
    const key = file.shortcutDetails ? file.shortcutDetails.targetResourceKey ?? null : file.resourceKey ?? null
    job.current = file.name ?? id
    let copied = false

    // If source and target account are identical, try native Drive copy
    if (sourceAccount.id === targetAccount.id && (file.shortcutDetails || file.capabilities?.canCopy !== false)) {
      try {
        await withRetry(targetAccount.id, () => targetDrive.files.copy({
          fileId: id,
          requestBody: { name: file.name ?? undefined, parents: [targetParentId] },
          fields: 'id',
          supportsAllDrives: true,
        }, { headers: resourceKeyHeaders(id, key) }))
        job.copied += 1
        copied = true
      } catch {
        // failed copy - try stream/bypass below
      }
    }

    // Direct media stream from source
    if (!copied) {
      const cached = readCacheMeta(id)
      if (cached) {
        try {
          touchCache(id)
          await withRetry(targetAccount.id, () => targetDrive.files.create({
            requestBody: { name: file.name ?? id, parents: [targetParentId] },
            media: { mimeType: cached.contentType || file.mimeType || 'application/octet-stream', body: fs.createReadStream(getCacheDataPath(id)) },
            fields: 'id',
            supportsAllDrives: true,
          }))
          job.copied += 1
          copied = true
        } catch {
          // fallback to direct media stream
        }
      }
    }

    if (!copied) {
      try {
        const res = await withRetry(sourceAccount.id, () => sourceDrive.files.get(
          { fileId: id, alt: 'media', supportsAllDrives: true },
          { responseType: 'stream', headers: resourceKeyHeaders(id, key) }
        ))
        if (res.data) {
          await withRetry(targetAccount.id, () => targetDrive.files.create({
            requestBody: { name: file.name ?? id, parents: [targetParentId] },
            media: { mimeType: file.mimeType ?? 'application/octet-stream', body: res.data as Readable },
            fields: 'id',
            supportsAllDrives: true,
          }))
          job.copied += 1
          copied = true
        }
      } catch {
        // stream get failed
      }
    }

    // Bypass stream for restricted files
    if (!copied) {
      try {
        const bypass = await attemptGoogleBypassStream(sourceAccount, id, key)
        if (bypass && bypass.ok && bypass.body) {
          await withRetry(targetAccount.id, () => targetDrive.files.create({
            requestBody: { name: file.name ?? id, parents: [targetParentId] },
            media: { mimeType: file.mimeType ?? 'application/octet-stream', body: Readable.fromWeb(bypass.body as any) },
            fields: 'id',
            supportsAllDrives: true,
          }))
          job.copied += 1
          copied = true
        }
      } catch {
        // bypass failed
      }
    }
    if (!copied) {
      job.skipped += 1
    }
  })

  for (const folder of folders) {
    const id = folder.shortcutDetails?.targetId ?? folder.id!
    const key = folder.shortcutDetails ? folder.shortcutDetails.targetResourceKey ?? null : folder.resourceKey ?? null
    const created = await withRetry(targetAccount.id, () => targetDrive.files.create({
      requestBody: { name: folder.name ?? id, mimeType: FOLDER_MIME, parents: [targetParentId] },
      fields: 'id',
      supportsAllDrives: true,
    }))
    job.folders += 1
    await copyFolderTree(sourceAccount, sourceDrive, targetAccount, targetDrive, id, key, created.data.id!, job)
  }
}

async function runCopyJob(link: SavedLink, sourceAccount: ConnectedAccount, targetAccount: ConnectedAccount, job: CopyJob) {
  try {
    const sourceDrive = await driveFor(sourceAccount)
    const targetDrive = await driveFor(targetAccount)
    const parentId = await ensureGoogleAppFolder(targetAccount)
    if (link.mimeType === FOLDER_MIME) {
      const description = [link.teacher ? `Giảng viên: ${link.teacher}` : '', `Nguồn: ${link.url}`].filter(Boolean).join('\n')
      const folder = await withRetry(targetAccount.id, () => targetDrive.files.create({
        requestBody: { name: job.folderName, mimeType: FOLDER_MIME, parents: [parentId], description },
        fields: 'id,webViewLink',
        supportsAllDrives: true,
      }))
      job.folderUrl = folder.data.webViewLink ?? null
      job.folders += 1
      await copyFolderTree(sourceAccount, sourceDrive, targetAccount, targetDrive, link.driveFileId, link.resourceKey, folder.data.id!, job)
    } else {
      job.current = link.title
      let copied = false
      if (sourceAccount.id === targetAccount.id) {
        const meta = await withRetry(sourceAccount.id, () => sourceDrive.files.get({ fileId: link.driveFileId, fields: 'capabilities(canCopy),mimeType', supportsAllDrives: true }, { headers: resourceKeyHeaders(link.driveFileId, link.resourceKey) }))
        if (meta.data.capabilities?.canCopy !== false) {
          try {
            const copiedFile = await withRetry(targetAccount.id, () => targetDrive.files.copy({
              fileId: link.driveFileId,
              requestBody: { name: job.folderName, parents: [parentId] },
              fields: 'id,webViewLink',
              supportsAllDrives: true,
            }, { headers: resourceKeyHeaders(link.driveFileId, link.resourceKey) }))
            job.folderUrl = copiedFile.data.webViewLink ?? null
            job.copied += 1
            copied = true
          } catch {
            // try bypass
          }
        }
      }
      if (!copied) {
        try {
          const res = await withRetry(sourceAccount.id, () => sourceDrive.files.get(
            { fileId: link.driveFileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream', headers: resourceKeyHeaders(link.driveFileId, link.resourceKey) }
          ))
          if (res.data) {
            const created = await withRetry(targetAccount.id, () => targetDrive.files.create({
              requestBody: { name: job.folderName, parents: [parentId] },
              media: { mimeType: link.mimeType || 'application/octet-stream', body: res.data as Readable },
              fields: 'id,webViewLink',
              supportsAllDrives: true,
            }))
            job.folderUrl = created.data.webViewLink ?? null
            job.copied += 1
            copied = true
          }
        } catch {
          // stream failed
        }
      }
      if (!copied) {
        try {
          const bypass = await attemptGoogleBypassStream(sourceAccount, link.driveFileId, link.resourceKey)
          if (bypass && bypass.ok && bypass.body) {
            const created = await withRetry(targetAccount.id, () => targetDrive.files.create({
              requestBody: { name: job.folderName, parents: [parentId] },
              media: { mimeType: link.mimeType || 'application/octet-stream', body: Readable.fromWeb(bypass.body as any) },
              fields: 'id,webViewLink',
              supportsAllDrives: true,
            }))
            job.folderUrl = created.data.webViewLink ?? null
            job.copied += 1
            copied = true
          }
        } catch {
          // bypass failed
        }
      }
      if (!copied) {
        job.skipped += 1
      }
    }
    job.status = 'done'
  } catch (error) {
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
  } finally {
    job.current = null
    job.finishedAt = new Date().toISOString()
    // Bring the new copies into "Drive của tôi".
    syncGoogleAppFolderFiles(targetAccount.id, targetAccount.userId, { force: true }).catch(() => undefined)
  }
}

libraryRouter.get('/:id/save-to-drive', loadOwnedLink, (req: OwnedRequest<SavedLink>, res) => {
  return res.json({ job: copyJobs.get(req.owned!.id) ?? null })
})

const saveToDriveSchema = z.object({
  targetAccountId: z.string().uuid().optional(),
})

libraryRouter.post('/:id/save-to-drive', loadOwnedLink, async (req: OwnedRequest<SavedLink>, res, next) => {
  try {
    const body = saveToDriveSchema.parse(req.body ?? {})
    const link = req.owned!
    const running = copyJobs.get(link.id)
    if (running?.status === 'running') return res.status(202).json({ job: running })
    const sourceAccount = await accountForLink(link)
    if (!sourceAccount) return noAccess(res)

    let targetAccount = sourceAccount
    if (body.targetAccountId && body.targetAccountId !== sourceAccount.id) {
      const chosen = await prisma.connectedAccount.findFirst({
        where: { id: body.targetAccountId, userId: req.user!.id, provider: 'google_drive', status: 'connected' }
      })
      if (!chosen) {
        return res.status(400).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Tài khoản Google đích không tồn tại hoặc chưa kết nối.' })
      }
      targetAccount = chosen
    }

    const job: CopyJob = {
      status: 'running',
      accountEmail: targetAccount.email,
      folderName: link.teacher ? `${link.title} - ${link.teacher}` : link.title,
      folderUrl: null,
      copied: 0,
      folders: 0,
      skipped: 0,
      failed: 0,
      current: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    copyJobs.set(link.id, job)
    runCopyJob(link, sourceAccount, targetAccount, job).catch(() => undefined)
    return res.status(202).json({ job })
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
