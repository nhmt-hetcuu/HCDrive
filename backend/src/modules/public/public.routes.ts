import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { prisma } from '../../config/prisma.js'
import { hashToken } from '../../utils/crypto.js'
import { streamProviderFile } from '../files/stream-file.js'
import { limiters } from '../../middleware/rate-limit.js'
import { verifySignedId } from '../../utils/signed-url.js'
import { cachedThumbnailLink, forgetThumbnailLink, rememberThumbnailLink } from '../../utils/thumbnail-cache.js'
import { googlePausedFor, noteGoogleError } from '../../utils/google-backoff.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from '../google/google.service.js'
import { getCacheProgress } from '../../services/temp-cache.service.js'

export const publicRouter = Router()

// Link chia sẻ công khai không cần đăng nhập nên giới hạn theo IP.
publicRouter.use(limiters.publicShare)

// Thumbnails for <img> tags, which cannot send the Authorization header: the URL carries a signed,
// expiring token for one file (see thumbnailUrlFor). Google's thumbnail link needs the account's
// token, so the image goes through HCDrive; the link itself is cached for 50 minutes.
publicRouter.get('/thumbnails/:token', async (req, res, next) => {
  try {
    const fileId = verifySignedId('thumbnail', String(req.params.token))
    if (!fileId) return res.status(404).end()
    const size = Math.min(Math.max(Number(req.query.size) || 400, 64), 1600)
    const file = await prisma.file.findFirst({ where: { id: fileId, provider: 'google_drive', connectedAccount: { status: 'connected' } }, include: { connectedAccount: true } })
    if (!file) return res.status(404).end()
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    // Usually known from the folder listing; asking Drive is the fallback, skipped while rate limited.
    let link = cachedThumbnailLink(file.providerFileId)
    if (!link) {
      if (googlePausedFor(file.connectedAccountId) > 0) return res.status(503).setHeader('Retry-After', '60').end()
      try {
        const meta = await getGoogleDriveClient(auth, getAccountProxyUrl(file.connectedAccount)).files.get({ fileId: file.providerFileId, fields: 'thumbnailLink', supportsAllDrives: true })
        link = meta.data.thumbnailLink ?? null
      } catch (error) {
        noteGoogleError(file.connectedAccountId, error)
        throw error
      }
      if (!link) return res.status(404).end()
      rememberThumbnailLink(file.providerFileId, link)
    }
    const url = link.replace(/=s\d+$/, `=s${size}`)
    const headers = Object.fromEntries(Object.entries(await auth.getRequestHeaders()).map(([key, value]) => [key, String(value)]))
    const image = await fetch(url, { headers, dispatcher: getUndiciDispatcher(getAccountProxyUrl(file.connectedAccount)) } as RequestInit)
    if (!image.ok || !image.body) {
      forgetThumbnailLink(file.providerFileId)
      return res.status(404).end()
    }
    res.setHeader('Content-Type', image.headers.get('content-type') ?? 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=21600')
    await pipeline(Readable.fromWeb(image.body as never), res).catch(() => {
      if (!res.destroyed) res.destroy()
    })
  } catch (error) {
    return next(error)
  }
})

async function findSharedFile(token: string) {
  const share = await prisma.fileShare.findFirst({
    where: { enabled: true, AND: [{ OR: [{ token }, { tokenHash: hashToken(token) }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] },
    include: { file: { include: { connectedAccount: true } } },
  })
  if (!share || share.file.status !== 'active') throw Object.assign(new Error('Shared file not found'), { status: 404, code: 'SHARE_NOT_FOUND' })
  return share.file
}

publicRouter.get('/files/:token', async (req, res, next) => {
  try {
    const file = await findSharedFile(String(req.params.token))
    return res.json({ file: { id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes.toString(), createdAt: file.createdAt } })
  } catch (error) {
    return next(error)
  }
})

publicRouter.get('/files/:token/download', async (req, res, next) => {
  try {
    const file = await findSharedFile(String(req.params.token))
    return streamProviderFile(file, req.headers.range, res, { disposition: 'attachment' })
  } catch (error) {
    return next(error)
  }
})

publicRouter.get('/files/:token/preview', async (req, res, next) => {
  try {
    const file = await findSharedFile(String(req.params.token))
    return streamProviderFile(file, req.headers.range, res, { disposition: 'inline' })
  } catch (error) {
    return next(error)
  }
})

publicRouter.get('/files/:token/cache-progress', async (req, res, next) => {
  try {
    const file = await findSharedFile(String(req.params.token))
    return res.json(getCacheProgress(file.providerFileId || file.id))
  } catch (error) {
    return next(error)
  }
})
