import Busboy from 'busboy'
import type { NextFunction, Response as ExpressResponse } from 'express'
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { z } from 'zod'
import { google } from 'googleapis'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, getGoogleDriveClient, syncGoogleQuota } from '../google/google.service.js'
import { ensureAccountFolderPath } from '../folders/merged-folders.js'
import { conversionTargetFor } from '../google/drive-features.js'
import { googlePausedFor } from '../../utils/google-backoff.js'
import { buildS3ObjectKey, getS3ConfigForAccount, syncS3Quota, uploadS3Object } from '../s3/s3.service.js'
import { createAuditLog } from '../../utils/audit.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'

export const uploadRouter = Router()

// A folder opened while the upload finished may already have recorded the new Drive file (the live
// refresh lists it as soon as Drive has it). That row becomes the upload's row instead of a second one.
async function recordUploadedDriveFile(data: { userId: string; connectedAccountId: string; folderId: string | null; provider: string; providerFileId: string; name: string; mimeType: string; sizeBytes: bigint; status: string; deletedAt: null }) {
  const known = await prisma.file.findFirst({ where: { connectedAccountId: data.connectedAccountId, providerFileId: data.providerFileId } })
  return known ? prisma.file.update({ where: { id: known.id }, data }) : prisma.file.create({ data })
}

// Clean up any stale temp directories on disk
try {
  const base = process.env.TEMP_UPLOAD_DIR || path.resolve(process.cwd(), 'data', 'temp_uploads')
  if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true })
} catch {}

type UploadMeta = { fieldName: string; fileName: string; mimeType: string; sizeBytes: bigint; folderId?: string; targetAccountId?: string }
type RoutingMode = 'most_available' | 'round_robin' | 'priority'

function logUpload(message: string, metadata?: Record<string, unknown>) {
  console.info('[upload]', message, metadata ?? '')
}

function syncQuotaInBackground(accountId: string, sessionId: string) {
  logUpload('quota sync started', { accountId, sessionId })
  syncGoogleQuota(accountId)
    .then(() => logUpload('quota sync completed', { accountId, sessionId }))
    .catch((error) => logUpload('quota sync failed', { accountId, sessionId, message: error instanceof Error ? error.message : 'Unknown error' }))
}

async function fetchWithRetry(url: string, options: any, maxRetries = 4): Promise<globalThis.Response> {
  let attempt = 0
  let delay = 1500
  while (true) {
    const res = await fetch(url, options)
    if (res.status === 403 || res.status === 429) {
      const clone = res.clone()
      const text = await clone.text().catch(() => '')
      if (text.includes('rateLimitExceeded') || text.includes('Quota exceeded') || res.status === 429) {
        if (attempt < maxRetries) {
          attempt++
          console.warn(`[Google API Rate Limit] 403/429 hit, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`)
          await new Promise((r) => setTimeout(r, delay))
          delay *= 2
          continue
        }
      }
    }
    return res
  }
}

function normalizePriorityAccountIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function byPriority<T extends { account: { id: string; createdAt: Date } }>(items: T[], priorityAccountIds: string[]) {
  const order = new Map(priorityAccountIds.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const aOrder = order.get(a.account.id)
    const bOrder = order.get(b.account.id)
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
    if (aOrder !== undefined) return -1
    if (bOrder !== undefined) return 1
    return a.account.createdAt.getTime() - b.account.createdAt.getTime()
  })
}

async function selectAccount(userId: string, sizeBytes: bigint, reservedBytesByAccount = new Map<string, bigint>(), targetAccountId?: string | null) {
  const whereClause = {
    OR: [
      { userId },
      { isShared: true },
    ],
    provider: { in: ['google_drive', 's3'] },
    status: 'connected',
    ...(targetAccountId ? { id: targetAccountId } : {}),
  }

  const accounts = await prisma.connectedAccount.findMany({
    where: whereClause,
    include: { storageAccount: true },
  })

  const stale = accounts.filter((account) => (!account.storageAccount?.lastSyncedAt || account.storageAccount.lastSyncedAt.getTime() < Date.now() - 5 * 60_000) && googlePausedFor(account.id) === 0)
  await Promise.allSettled(stale.map(async (account) => {
    try {
      if (account.provider === 's3') {
        await syncS3Quota(account.id)
      } else {
        await syncGoogleQuota(account.id)
      }
    } catch (err: any) {
      console.error(`[upload] failed to sync quota for account ${account.email} (${account.id}):`, err.message || err)
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: { lastError: err.message || 'Quota sync failed' }
      }).catch(() => undefined)
    }
  }))

  const fresh = await prisma.connectedAccount.findMany({
    where: {
      OR: [
        { userId },
        { isShared: true },
      ],
      provider: { in: ['google_drive', 's3'] },
      status: 'connected',
    },
    include: { storageAccount: true },
  })

  const eligible = fresh
    .map((account) => ({ account, availableBytes: account.storageAccount?.availableBytes === null || account.storageAccount?.availableBytes === undefined ? null : account.storageAccount.availableBytes - (reservedBytesByAccount.get(account.id) ?? 0n) }))
    .filter(({ availableBytes }) => availableBytes === null || availableBytes >= sizeBytes)

  if (eligible.length === 0) return null

  if (targetAccountId) {
    const target = eligible.find(e => e.account.id === targetAccountId)
    return target?.account ?? null
  }

  // Google refused requests from an account a moment ago (per-minute limit): send the upload to
  // another account, unless none is left.
  const ready = eligible.filter(({ account }) => googlePausedFor(account.id) === 0)
  if (ready.length > 0 && ready.length < eligible.length) eligible.splice(0, eligible.length, ...ready)

  const policy = await prisma.uploadRoutingPolicy.upsert({ where: { userId }, create: { userId, mode: 'most_available', priorityAccountIds: [] }, update: {} })
  const mode = (['most_available', 'round_robin', 'priority'].includes(policy.mode) ? policy.mode : 'most_available') as RoutingMode
  const priorityAccountIds = normalizePriorityAccountIds(policy.priorityAccountIds)

  if (mode === 'priority') return byPriority(eligible, priorityAccountIds)[0]?.account ?? null

  if (mode === 'round_robin') {
    const ordered = byPriority(eligible, priorityAccountIds)
    const selected = ordered[policy.roundRobinCursor % ordered.length]?.account ?? ordered[0]?.account ?? null
    await prisma.uploadRoutingPolicy.update({ where: { userId }, data: { roundRobinCursor: policy.roundRobinCursor + 1 } })
    return selected
  }

  return eligible
    .sort((a, b) => {
      if (a.availableBytes === null && b.availableBytes === null) return a.account.provider === 's3' ? -1 : 1
      if (a.availableBytes === null) return a.account.provider === 's3' ? -1 : 1
      if (b.availableBytes === null) return b.account.provider === 's3' ? 1 : -1
      return Number(b.availableBytes - a.availableBytes)
    })[0]?.account
}

// Uploads into a folder prefer the folder's own account. My Drive merges folders across accounts,
// so when that account is full the file goes to another account (into its copy of the folder).
async function selectAccountForFolder(userId: string, sizeBytes: bigint, reservedBytesByAccount: Map<string, bigint> | undefined, targetAccountId: string | null | undefined, folderId: string | null) {
  if (targetAccountId) return selectAccount(userId, sizeBytes, reservedBytesByAccount, targetAccountId)
  if (folderId) {
    const folderRecord = await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId, deletedAt: null } })
    if (folderRecord.connectedAccountId) {
      const preferred = await selectAccount(userId, sizeBytes, reservedBytesByAccount, folderRecord.connectedAccountId)
      if (preferred) return preferred
    }
  }
  return selectAccount(userId, sizeBytes, reservedBytesByAccount)
}

export async function handleUpload(req: AuthRequest, res: ExpressResponse, next: NextFunction) {
  try {
    logUpload('request started', { userId: req.user!.id, contentLength: req.headers['content-length'] })
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) return res.status(400).json({ code: 'UPLOAD_INVALID_CONTENT_TYPE', message: 'multipart/form-data required.' })

    const busboy = Busboy({ headers: req.headers, limits: { files: 25, fileSize: env.MAX_UPLOAD_BYTES } })
    const fields: { sizeBytes?: bigint; fileName?: string; mimeType?: string; folderId?: string; targetAccountId?: string } = {}
    let batchMeta: UploadMeta[] | null = null
    let responded = false
    let fileSeen = false
    const reservedBytesByAccount = new Map<string, bigint>()
    const completed: Array<Record<string, unknown>> = []
    const failed: Array<{ fileName: string; code: string; message: string }> = []
    const pendingUploads: Array<Promise<void>> = []

    const fail = async (status: number, code: string, message: string) => {
      if (responded) return
      responded = true
      req.unpipe(busboy)
      req.resume()
      return res.status(status).json({ code, message })
    }

    const parseBatchMeta = (value: string) => JSON.parse(value).map((item: { fieldName: string; fileName: string; mimeType: string; sizeBytes: string | number; folderId?: string; targetAccountId?: string }) => ({
      fieldName: item.fieldName,
      fileName: item.fileName,
      mimeType: item.mimeType,
      sizeBytes: BigInt(item.sizeBytes),
      folderId: item.folderId,
      targetAccountId: item.targetAccountId,
    })) as UploadMeta[]

    const metaForFile = (fieldName: string, info: { filename: string; mimeType: string }) => {
      if (batchMeta) {
        const found = batchMeta.find((item) => item.fieldName === fieldName)
        if (found) return found
      }
      return {
        fieldName,
        sizeBytes: fields.sizeBytes ?? 0n,
        fileName: fields.fileName || info.filename || 'uploaded-file',
        mimeType: fields.mimeType || info.mimeType || 'application/octet-stream',
        folderId: fields.folderId,
        targetAccountId: fields.targetAccountId,
      }
    }

    const uploadOne = async (fieldName: string, fileStream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      const meta = metaForFile(fieldName, info)
      const fileName = meta?.fileName || info.filename || 'uploaded-file'
      try {
        fileStream.on('limit', () => logUpload('file stream size limit reached', { fileName }))
        if (meta.sizeBytes > 0n && meta.sizeBytes > BigInt(env.MAX_UPLOAD_BYTES)) {
          fileStream.resume()
          failed.push({ fileName, code: 'UPLOAD_TOO_LARGE', message: 'File exceeds max upload size.' })
          return
        }

        const folderId = meta.folderId || null
        const account = await selectAccountForFolder(req.user!.id, meta.sizeBytes, reservedBytesByAccount, meta.targetAccountId, folderId)
        if (!account) {
          fileStream.resume()
          failed.push({ fileName, code: 'NO_ACCOUNT_WITH_ENOUGH_SPACE', message: 'No connected storage account has enough space for this upload.' })
          return
        }
        if (meta.sizeBytes > 0n) {
          reservedBytesByAccount.set(account.id, (reservedBytesByAccount.get(account.id) ?? 0n) + meta.sizeBytes)
        }

        const session = await prisma.uploadSession.create({ data: { userId: req.user!.id, targetConnectedAccountId: account.id, folderId, fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, status: 'uploading' } })
        logUpload('file upload started', { sessionId: session.id, accountId: account.id, fileName, sizeBytes: meta.sizeBytes.toString() })

        try {
          let providerFileId = ''
          let uploadedName = fileName
          let uploadedMimeType = meta.mimeType
          let googleFolderId = folderId
          let actualSize = meta.sizeBytes

          if (account.provider === 's3') {
            const config = await getS3ConfigForAccount(account.id, req.user!.id)
            const provisionalFile = await prisma.file.create({
              data: { userId: req.user!.id, connectedAccountId: account.id, folderId, provider: 's3', providerFileId: 'pending', name: fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, status: 'uploading' },
            })
            providerFileId = buildS3ObjectKey(config, req.user!.id, provisionalFile.id, fileName)
            await uploadS3Object(config, providerFileId, fileStream, meta.mimeType)
            await prisma.file.update({ where: { id: provisionalFile.id }, data: { providerFileId, status: 'active' } })
            completed.push({ ...provisionalFile, providerFileId, status: 'active', sizeBytes: meta.sizeBytes.toString() })
            logUpload('s3 upload completed', { sessionId: session.id, accountId: account.id, fileName })
          } else {
            const proxyUrl = getAccountProxyUrl(account)
            const auth = await getAuthedGoogleClient(account)
            const drive = getGoogleDriveClient(auth, proxyUrl)
            let targetParentId = await ensureGoogleAppFolder(account)
            if (folderId) {
              // The merged folder may not exist in this account yet; create its path there.
              const target = await ensureAccountFolderPath(req.user!.id, account.id, drive, folderId)
              if (target) {
                targetParentId = target.providerFolderId
                googleFolderId = target.folderId
              }
            }
            const hasParent = targetParentId && targetParentId !== 'root'
            const owner = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { convertUploads: true } })
            const convertTo = owner?.convertUploads ? conversionTargetFor(meta.mimeType, fileName) : null
            const uploaded = await drive.files.create({
              requestBody: {
                name: convertTo ? fileName.replace(/\.(docx?|odt|rtf|xlsx?|ods|csv|pptx?|odp)$/i, '') : fileName,
                ...(convertTo ? { mimeType: convertTo } : {}),
                ...(hasParent ? { parents: [targetParentId] } : {})
              },
              media: { mimeType: meta.mimeType, body: fileStream },
              fields: 'id,name,mimeType,size',
              supportsAllDrives: true,
            })
            providerFileId = uploaded.data.id ?? ''
            uploadedName = uploaded.data.name ?? fileName
            uploadedMimeType = uploaded.data.mimeType ?? meta.mimeType
            if (uploaded.data.size) {
              actualSize = BigInt(uploaded.data.size)
            }
            logUpload('google upload completed', { sessionId: session.id, accountId: account.id, fileName, actualSize: actualSize.toString() })
          }

          const fileData = { userId: req.user!.id, connectedAccountId: account.id, folderId: googleFolderId, provider: account.provider, providerFileId, name: uploadedName, mimeType: uploadedMimeType, sizeBytes: actualSize, status: 'active', deletedAt: null }
          const file = account.provider === 's3' ? null : await recordUploadedDriveFile(fileData)
          if (file) {
            logUpload('database file created', { sessionId: session.id, fileId: file.id, accountId: account.id })
            completed.push({ ...file, sizeBytes: file.sizeBytes.toString() })
          }
          await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'completed', completedAt: new Date() } })
          if (account.provider === 's3') syncS3Quota(account.id).catch(() => undefined)
          else syncQuotaInBackground(account.id, session.id)
        } catch (uploadErr: any) {
          const errMsg = uploadErr?.message || 'Upload failed'
          await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'failed', errorMessage: errMsg } }).catch(() => undefined)
          failed.push({ fileName, code: 'UPLOAD_FAILED', message: errMsg })
        }
      } catch (error) {
        fileStream.resume()
        logUpload('file upload failed', { fileName, message: error instanceof Error ? error.message : 'Upload failed' })
        failed.push({ fileName, code: 'UPLOAD_FAILED', message: error instanceof Error ? error.message : 'Upload failed' })
      }
    }

    busboy.on('field', (name, value) => {
      if (name === 'sizeBytes') fields.sizeBytes = BigInt(value)
      if (name === 'fileName') fields.fileName = value
      if (name === 'mimeType') fields.mimeType = value
      if (name === 'folderId') fields.folderId = value
      if (name === 'targetAccountId') fields.targetAccountId = value
      if (name === 'filesMeta') batchMeta = parseBatchMeta(value)
    })

    busboy.on('file', (name, fileStream, info) => {
      fileSeen = true
      pendingUploads.push(uploadOne(name, fileStream, info))
    })

    busboy.on('error', (error) => {
      logUpload('multipart parser failed', { message: error instanceof Error ? error.message : 'Unknown error' })
      if (!responded) {
        responded = true
        next(error)
      }
    })

    busboy.on('finish', () => {
      if (!responded && !fileSeen) return fail(400, 'UPLOAD_FILE_REQUIRED', 'file field required.')
      Promise.all(pendingUploads).then(() => {
        if (responded) return
        responded = true
        logUpload('response sent', { completed: completed.length, failed: failed.length })
        if (completed.length === 0) return res.status(400).json({ code: failed[0]?.code ?? 'UPLOAD_FAILED', message: failed[0]?.message ?? 'Upload failed', failed })
        if (completed.length === 1 && !batchMeta) return res.status(201).json({ file: completed[0], files: completed, failed })
        return res.status(201).json({ files: completed, failed })
      }).catch(next)
    })

    req.pipe(busboy)
  } catch (error) {
    return next(error)
  }
}

uploadRouter.post('/', requireAuth, handleUpload)

// Resumable upload endpoints

// 1. Initialize resumable session
uploadRouter.post('/resumable/init', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      fileName: z.string().min(1),
      mimeType: z.string().min(1),
      sizeBytes: z.string(),
      folderId: z.string().nullable().optional(),
      targetAccountId: z.string().nullable().optional()
    }).parse(req.body)

    const sizeBytes = BigInt(body.sizeBytes)
    if (sizeBytes <= 0n) return res.status(400).json({ code: 'UPLOAD_SIZE_REQUIRED', message: 'Valid sizeBytes required.' })
    if (sizeBytes > BigInt(env.MAX_UPLOAD_BYTES)) return res.status(400).json({ code: 'UPLOAD_TOO_LARGE', message: 'File exceeds max upload size.' })

    const folderId = body.folderId || null
    const account = await selectAccountForFolder(req.user!.id, sizeBytes, undefined, body.targetAccountId, folderId)
    if (!account) return res.status(400).json({ code: 'NO_ACCOUNT_WITH_ENOUGH_SPACE', message: 'No connected storage account has enough space.' })

    if (account.provider !== 'google_drive') {
      const session = await prisma.uploadSession.create({
        data: {
          userId: req.user!.id,
          targetConnectedAccountId: account.id,
          folderId,
          fileName: body.fileName,
          mimeType: body.mimeType,
          sizeBytes,
          status: 'uploading'
        }
      })
      return res.status(201).json({ sessionId: session.id, provider: account.provider, offset: 0, targetAccountId: account.id })
    }

    const auth = await getAuthedGoogleClient(account)
    let targetParentId = await ensureGoogleAppFolder(account)
    let sessionFolderId = folderId
    if (folderId) {
      // A Drive folder id only works in its own account: use (or create) this account's copy of the merged folder.
      const target = await ensureAccountFolderPath(req.user!.id, account.id, getGoogleDriveClient(auth, getAccountProxyUrl(account)), folderId)
      if (target) {
        targetParentId = target.providerFolderId
        sessionFolderId = target.folderId
      }
    }

    // Office files become Google Docs/Sheets/Slides when the user turned that on (Settings → General).
    const owner = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { convertUploads: true } })
    const convertTo = owner?.convertUploads ? conversionTargetFor(body.mimeType, body.fileName) : null

    // Initiate Google Drive Resumable Session
    const headers = new Headers()
    const token = await auth.getAccessToken()
    headers.set('Authorization', `Bearer ${token.token}`)
    headers.set('Content-Type', 'application/json')
    headers.set('X-Upload-Content-Type', body.mimeType)
    headers.set('X-Upload-Content-Length', sizeBytes.toString())

    const proxyUrl = getAccountProxyUrl(account)
    const dispatcher = getUndiciDispatcher(proxyUrl)

    const hasParent = targetParentId && targetParentId !== 'root'
    const initRes = await fetchWithRetry('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: convertTo ? body.fileName.replace(/\.(docx?|odt|rtf|xlsx?|ods|csv|pptx?|odp)$/i, '') : body.fileName,
        ...(convertTo ? { mimeType: convertTo } : {}),
        ...(hasParent ? { parents: [targetParentId] } : {})
      }),
      dispatcher,
    } as any)

    if (!initRes.ok) {
      const errText = await initRes.text()
      throw new Error(`Google API Init Error: ${errText}`)
    }

    const sessionUri = initRes.headers.get('location')
    if (!sessionUri) throw new Error('Google API did not return Location header.')

    const session = await prisma.uploadSession.create({
      data: {
        userId: req.user!.id,
        targetConnectedAccountId: account.id,
        folderId: sessionFolderId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes,
        status: 'uploading',
        googleSessionUri: sessionUri
      }
    })

    return res.status(201).json({ sessionId: session.id, provider: 'google_drive', offset: 0 })
  } catch (error) {
    return next(error)
  }
})

// 2. Query/Resume resumable status
uploadRouter.get('/resumable/status/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const session = await prisma.uploadSession.findFirstOrThrow({
      where: { id: String(req.params.id), userId: req.user!.id }
    })

    if (session.status === 'completed') {
      return res.json({ status: 'completed', offset: session.sizeBytes.toString() })
    }

    if (!session.googleSessionUri || !session.targetConnectedAccountId) {
      return res.json({ status: 'uploading', offset: '0' })
    }

    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: {
        id: session.targetConnectedAccountId,
        OR: [{ userId: req.user!.id }, { isShared: true }],
      }
    })
    const proxyUrl = getAccountProxyUrl(account)
    const dispatcher = getUndiciDispatcher(proxyUrl)
    const auth = await getAuthedGoogleClient(account)
    const token = await auth.getAccessToken()

    // Query Google Drive for uploaded offset
    const queryHeaders = new Headers()
    queryHeaders.set('Authorization', `Bearer ${token.token}`)
    queryHeaders.set('Content-Range', `bytes */${session.sizeBytes}`)

    const queryRes = await fetch(session.googleSessionUri, {
      method: 'PUT',
      headers: queryHeaders,
      dispatcher,
    } as any)

    if (queryRes.status === 308) {
      const range = queryRes.headers.get('range')
      if (range) {
        // e.g. bytes=0-1048575
        const parts = range.split('-')
        const lastByte = BigInt(parts[1])
        return res.json({ status: 'uploading', offset: (lastByte + 1n).toString() })
      }
    } else if (queryRes.ok) {
      return res.json({ status: 'completed', offset: session.sizeBytes.toString() })
    }

    return res.json({ status: 'uploading', offset: '0' })
  } catch (error) {
    return res.json({ status: 'failed', offset: '0' })
  }
})

// 3. Upload chunk
uploadRouter.put('/resumable/chunk/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const session = await prisma.uploadSession.findFirstOrThrow({
      where: { id: String(req.params.id), userId: req.user!.id }
    })

    const rangeHeader = req.headers['content-range']
    if (!rangeHeader || typeof rangeHeader !== 'string') {
      return res.status(400).json({ code: 'MISSING_CONTENT_RANGE', message: 'Content-Range header is required.' })
    }

    // Parse Content-Range, e.g. bytes 0-5242879/10485760
    const match = rangeHeader.match(/bytes\s+(\d+)-(\d+)\/(\d+)/)
    if (!match) return res.status(400).json({ code: 'INVALID_CONTENT_RANGE', message: 'Invalid Content-Range format.' })

    const startByte = BigInt(match[1])
    const endByte = BigInt(match[2])
    const totalBytes = BigInt(match[3])

    if (!session.googleSessionUri || !session.targetConnectedAccountId) {
      return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Only Google Drive resumable uploads supported.' })
    }

    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: {
        id: session.targetConnectedAccountId,
        OR: [{ userId: req.user!.id }, { isShared: true }],
      }
    })
    const proxyUrl = getAccountProxyUrl(account)
    const dispatcher = getUndiciDispatcher(proxyUrl)
    const auth = await getAuthedGoogleClient(account)
    const token = await auth.getAccessToken()

    // Stream chunk body from client to Google Drive resumable URI
    const putHeaders = new Headers()
    putHeaders.set('Authorization', `Bearer ${token.token}`)
    putHeaders.set('Content-Range', rangeHeader)
    putHeaders.set('Content-Length', (endByte - startByte + 1n).toString())

    const putRes = await fetch(session.googleSessionUri, {
      method: 'PUT',
      headers: putHeaders,
      body: req as any,
      duplex: 'half',
      dispatcher,
    } as any)

    if (putRes.status === 308) {
      return res.json({ status: 'uploading', offset: (endByte + 1n).toString() })
    }

    if (putRes.ok) {
      // Completed! Parse metadata
      const fileMeta = await putRes.json() as { id: string; name: string; mimeType: string }

      const existingFile = await recordUploadedDriveFile({
        userId: req.user!.id,
        connectedAccountId: account.id,
        folderId: session.folderId,
        provider: 'google_drive',
        providerFileId: fileMeta.id,
        name: fileMeta.name || session.fileName,
        mimeType: fileMeta.mimeType || session.mimeType,
        sizeBytes: totalBytes,
        status: 'active',
        deletedAt: null,
      })

      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: 'completed', completedAt: new Date() }
      })

      await createAuditLog(req.user!.id, 'UPLOAD_FILE', 'file', existingFile.id, { name: existingFile.name, size: existingFile.sizeBytes.toString() })

      syncQuotaInBackground(account.id, session.id)

      return res.status(201).json({ status: 'completed', file: { ...existingFile, sizeBytes: existingFile.sizeBytes.toString() } })
    }

    const errorMsg = await putRes.text()
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: errorMsg }
    })

    return res.status(putRes.status).json({ code: 'UPLOAD_FAILED', message: errorMsg })
  } catch (error) {
    return next(error)
  }
})
