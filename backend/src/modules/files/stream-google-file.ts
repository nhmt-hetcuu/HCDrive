import fs from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'
import type { ConnectedAccount, File } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from '../google/google.service.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { streamCachedOrFetch, readCacheMeta, getCacheDataPath, triggerBackgroundDownload, getCacheProgress, type CacheProgress } from '../../services/temp-cache.service.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment'; exportMimeType?: string; exportExtension?: string }

export const googleDownloadExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
}

const googlePreviewExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  ...googleDownloadExportMimeTypes,
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/pdf', extension: '.pdf' },
}

function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  return `${type}; filename="${fileName.replaceAll('"', '')}"`
}

export function withExtension(fileName: string, extension: string) {
  return fileName.toLowerCase().endsWith(extension) ? fileName : `${fileName}${extension}`
}

export function normalizeHeaders(headers: Headers | Record<string, string>) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return headers
}

export function resourceKeyHeaders(fileId: string, resourceKey: string | null | undefined): Record<string, string> {
  if (!resourceKey) return {}
  return { 'X-Goog-Drive-Resource-Keys': `${fileId}/${resourceKey}` }
}

/** Attempts to bypass Google Drive download restrictions by fetching stream from drive.usercontent.google.com / preview player / videoplayback / export */
export async function attemptGoogleBypassStream(
  account: ConnectedAccount,
  fileId: string,
  resourceKey: string | null = null,
  range?: string,
  mimeHint?: string
): Promise<globalThis.Response | null> {
  try {
    // 0. Check if file is ALREADY downloaded and saved on SSD disk!
    // If present on disk, serve directly from SSD with ZERO Selenium and ZERO network requests!
    const cached = readCacheMeta(fileId)
    if (cached) {
      const dataPath = getCacheDataPath(fileId)
      if (fs.existsSync(dataPath)) {
        const stat = fs.statSync(dataPath)
        const fileSize = stat.size
        console.log(`[bypass] File ${fileId} (${cached.fileName}) already on SSD disk (${(fileSize / (1024 * 1024)).toFixed(2)} MB). Serving directly from disk with ZERO Selenium!`)

        if (range && typeof range === 'string') {
          const parts = range.replace(/bytes=/, '').split('-')
          const start = parseInt(parts[0], 10) || 0
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
          const chunksize = end - start + 1
          const fileStream = fs.createReadStream(dataPath, { start, end })
          return new Response(Readable.toWeb(fileStream) as any, {
            status: 206,
            headers: {
              'Content-Type': cached.contentType || 'application/octet-stream',
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': chunksize.toString(),
              'Accept-Ranges': 'bytes',
            },
          })
        }

        const fileStream = fs.createReadStream(dataPath)
        return new Response(Readable.toWeb(fileStream) as any, {
          status: 200,
          headers: {
            'Content-Type': cached.contentType || 'application/octet-stream',
            'Content-Length': fileSize.toString(),
            'Accept-Ranges': 'bytes',
          },
        })
      }
    }

    let authHeaders: Record<string, string> = {}
    let accessToken: string | null = null
    let auth: any = null
    try {
      auth = await getAuthedGoogleClient(account)
      const tokenObj = await auth.getAccessToken().catch(() => null)
      accessToken = tokenObj?.token || null
      authHeaders = normalizeHeaders(await auth.getRequestHeaders())
    } catch {
      // Cookie-only account or OAuth tokens unavailable; proceed with cookie bypass
    }

    const dispatcher = getUndiciDispatcher(getAccountProxyUrl(account))
    const rkHeaders = resourceKeyHeaders(fileId, resourceKey)
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

    // Strategy 1: Modern endpoint drive.usercontent.google.com with Bearer token & access_token query param
    const usercontentUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t&authuser=0${accessToken ? `&access_token=${accessToken}` : ''}${resourceKey ? `&resourcekey=${resourceKey}` : ''}`
    const ucRes = await fetch(usercontentUrl, {
      dispatcher,
      headers: {
        ...authHeaders,
        ...rkHeaders,
        ...(range ? { Range: range } : {}),
        'User-Agent': ua,
        'Referer': 'https://drive.google.com/',
        'Accept': '*/*',
      },
      redirect: 'follow',
    } as any).catch(() => null)

    if (ucRes && (ucRes.status === 200 || ucRes.status === 206)) {
      const cType = ucRes.headers.get('content-type') ?? ''
      if (!cType.includes('text/html') || ucRes.headers.get('content-disposition')?.includes('attachment')) {
        return ucRes
      }
      // If HTML was returned, check for virus scan / large-file confirmation form (<form id="download-form" action="...">)
      const html = await ucRes.text().catch(() => '')
      const formMatch = html.match(/<form[^>]+action="([^"]+)"/i)
      if (formMatch?.[1]) {
        let actionUrl = formMatch[1].replace(/&amp;/g, '&')
        if (actionUrl.startsWith('/')) actionUrl = `https://drive.usercontent.google.com${actionUrl}`
        const inputMatches = html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)
        const params = new URLSearchParams()
        for (const m of inputMatches) params.append(m[1], m[2])
        if (accessToken && !params.has('access_token')) params.append('access_token', accessToken)
        const confirmUrl = actionUrl.includes('?') ? `${actionUrl}&${params.toString()}` : `${actionUrl}?${params.toString()}`
        const formRes = await fetch(confirmUrl, {
          dispatcher,
          headers: {
            ...authHeaders,
            ...rkHeaders,
            ...(range ? { Range: range } : {}),
            'User-Agent': ua,
            'Referer': 'https://drive.google.com/',
            'Accept': '*/*',
          },
          redirect: 'follow',
        } as any).catch(() => null)
        if (formRes && (formRes.status === 200 || formRes.status === 206)) {
          const formCType = formRes.headers.get('content-type') ?? ''
          if (!formCType.includes('text/html') || formRes.headers.get('content-disposition')?.includes('attachment')) {
            return formRes
          }
        }
      }
    }

    // Strategy 2: Legacy drive.google.com/uc?id=${fileId}&export=download&confirm=t
    const legacyUcUrl = `https://drive.google.com/uc?id=${fileId}&export=download&confirm=t&authuser=0${accessToken ? `&access_token=${accessToken}` : ''}${resourceKey ? `&resourcekey=${resourceKey}` : ''}`
    const legacyRes = await fetch(legacyUcUrl, {
      dispatcher,
      headers: {
        ...authHeaders,
        ...rkHeaders,
        ...(range ? { Range: range } : {}),
        'User-Agent': ua,
        'Referer': 'https://drive.google.com/',
      },
      redirect: 'follow',
    } as any).catch(() => null)

    if (legacyRes && (legacyRes.status === 200 || legacyRes.status === 206)) {
      const cType = legacyRes.headers.get('content-type') ?? ''
      if (!cType.includes('text/html') || legacyRes.headers.get('content-disposition')?.includes('attachment')) {
        return legacyRes
      }
    }

    // Strategy 3: Check Google Drive preview page for videoplayback / stream URLs
    const previewUrl = `https://drive.google.com/file/d/${fileId}/preview${resourceKey ? `?resourcekey=${resourceKey}` : ''}`
    const previewRes = await fetch(previewUrl, {
      dispatcher,
      headers: {
        ...authHeaders,
        ...rkHeaders,
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    } as any).catch(() => null)

    if (previewRes && previewRes.ok) {
      const html = await previewRes.text().catch(() => '')
      const streamMatch = html.match(/(https?:\\\/\\\/[^\s"']+(?:googlevideo\.com|drive\.google\.com)\\\/videoplayback[^\s"']*)/i)
        || html.match(/(https?:\/\/[^\s"']+(?:googlevideo\.com|drive\.google\.com)\/videoplayback[^\s"']*)/i)

      if (streamMatch?.[1]) {
        const streamUrl = streamMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/')
        const videoRes = await fetch(streamUrl, {
          dispatcher,
          headers: {
            ...authHeaders,
            ...(range ? { Range: range } : {}),
            'User-Agent': ua,
          },
        } as any).catch(() => null)
        if (videoRes && (videoRes.status === 200 || videoRes.status === 206)) return videoRes
      }

      const fmtMatch = html.match(/"url_encoded_fmt_stream_map"\s*:\s*"([^"]+)"/) || html.match(/"fmt_stream_map"\s*:\s*"([^"]+)"/)
      if (fmtMatch?.[1]) {
        const rawMap = fmtMatch[1].replace(/\\u0026/g, '&')
        const urls = rawMap.split(',').map((part) => {
          const urlParam = part.split('&').find((p) => p.startsWith('url='))
          return urlParam ? decodeURIComponent(urlParam.slice(4)) : null
        }).filter(Boolean) as string[]
        if (urls.length > 0) {
          const fmtRes = await fetch(urls[0], {
            dispatcher,
            headers: {
              ...(range ? { Range: range } : {}),
              'User-Agent': ua,
            },
          } as any).catch(() => null)
          if (fmtRes && (fmtRes.status === 200 || fmtRes.status === 206)) return fmtRes
        }
      }
    }

    // Strategy 4: Google Docs export for docs/sheets/slides
    if (auth) {
      const drive = getGoogleDriveClient(auth, getAccountProxyUrl(account))
      const meta = await drive.files.get({ fileId, fields: 'mimeType,name', supportsAllDrives: true }, { headers: rkHeaders }).catch(() => null)
      if (meta?.data.mimeType && googleDownloadExportMimeTypes[meta.data.mimeType]) {
        const target = googleDownloadExportMimeTypes[meta.data.mimeType]
        const expRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(target.mimeType)}`, {
          dispatcher,
          headers: { ...authHeaders, ...rkHeaders },
        } as any).catch(() => null)
        if (expRes && (expRes.status === 200 || expRes.status === 206)) return expRes
      }
    }

    return null
  } catch {
    return null
  }
}

export async function streamGoogleFile(original: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  const proxyUrl = getAccountProxyUrl(original.connectedAccount)
  const dispatcher = getUndiciDispatcher(proxyUrl)
  const auth = await getAuthedGoogleClient(original.connectedAccount)
  const headers = normalizeHeaders(await auth.getRequestHeaders())
  // A shortcut has no content of its own: open what it points to (same account).
  let file = original
  if (original.mimeType === 'application/vnd.google-apps.shortcut' && original.shortcutTargetId) {
    const target = await getGoogleDriveClient(auth, proxyUrl).files.get({ fileId: original.shortcutTargetId, fields: 'id,name,mimeType', supportsAllDrives: true })
    file = { ...original, providerFileId: original.shortcutTargetId, name: target.data.name ?? original.name, mimeType: target.data.mimeType ?? original.mimeType }
  }
  const exportTarget = options.exportMimeType && file.mimeType.startsWith('application/vnd.google-apps.')
    ? { mimeType: options.exportMimeType, extension: options.exportExtension ?? '' }
    : (options.disposition === 'inline' ? googlePreviewExportMimeTypes : googleDownloadExportMimeTypes)[file.mimeType]
  const responseMimeType = exportTarget?.mimeType ?? file.mimeType
  const responseFileName = exportTarget ? withExtension(file.name, exportTarget.extension) : file.name
  const url = exportTarget
    ? `https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`

  // Cache video/file on server for 30 minutes and stream with Range support
  const cacheKey = exportTarget ? `${file.providerFileId}_export_${exportTarget.extension}` : file.providerFileId
  let isBypassUsed = false
  const cachedSuccess = await streamCachedOrFetch(
    cacheKey,
    responseFileName,
    range,
    res,
    async (rangeForFetch?: string) => {
      let dlResponse = await fetch(url, {
        dispatcher,
        headers: {
          ...headers,
          ...(rangeForFetch && !exportTarget ? { Range: rangeForFetch } : {}),
        },
      } as any)

      if (!dlResponse.ok) {
        if (dlResponse.status === 404 && file === original) {
          await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date() } }).catch(() => undefined)
          return null
        }
        // Attempt bypass for restricted Google Drive files (e.g. 403 cannotDownloadFile)
        const bypass = await attemptGoogleBypassStream(original.connectedAccount, file.providerFileId, null, rangeForFetch, file.mimeType)
        if (bypass && (bypass.status === 200 || bypass.status === 206)) {
          dlResponse = bypass
          isBypassUsed = true
        } else {
          return null
        }
      }

      if (!dlResponse.body) return null
      const cLength = dlResponse.headers.get('content-length')
      return {
        stream: dlResponse.body,
        contentType: responseMimeType,
        sizeBytes: cLength ? parseInt(cLength, 10) : undefined,
        contentRange: dlResponse.headers.get('content-range') || undefined,
        status: dlResponse.status,
      }
    },
    {
      disposition: options.disposition,
      fileName: responseFileName,
      isPermanent: isBypassUsed, // Only bypass files are permanently saved to disk; normal files follow the admin configured TTL
    }
  )

  if (cachedSuccess) return

  // Fallback to direct stream/error if caching could not be completed
  let response = await fetch(url, {
    dispatcher,
    headers: {
      ...headers,
      ...(range && !exportTarget ? { Range: range } : {}),
    },
  } as any)

  if (!response.ok) {
    if (response.status === 404 && file === original) {
      await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date() } }).catch(() => undefined)
      return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'Tệp đã bị xóa trên Google Drive.' })
    }
    // Attempt bypass for restricted Google Drive files (e.g. 403 cannotDownloadFile)
    const bypass = await attemptGoogleBypassStream(original.connectedAccount, file.providerFileId, null, range)
    if (bypass && (bypass.status === 200 || bypass.status === 206)) {
      response = bypass
    } else {
      const message = await response.text().catch(() => response.statusText)
      return res.status(response.status === 401 ? 502 : response.status).json({ code: 'GOOGLE_FILE_STREAM_FAILED', message: message || response.statusText })
    }
  }

  res.status(response.status)
  res.setHeader('Content-Type', responseMimeType)
  res.setHeader('Accept-Ranges', 'bytes')
  if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(options.disposition, responseFileName))

  const contentLength = response.headers.get('content-length')
  const contentRange = response.headers.get('content-range')
  if (contentLength) res.setHeader('Content-Length', contentLength)
  if (contentRange) res.setHeader('Content-Range', contentRange)

  if (!response.body) {
    res.end()
    return
  }
  // pipeline() handles errors on both sides: a bare pipe() leaves Google-side stream errors unhandled,
  // which crashes the Node process, and keeps reading after the client disconnects.
  await pipeline(Readable.fromWeb(response.body as any), res).catch(() => {
    if (!res.destroyed) res.destroy()
  })
}

/**
 * Initiates an asynchronous background download of the Google Drive file to server SSD cache.
 * Runs completely in the background to 100% completion even if the user exits the app.
 */
export async function startBackgroundCacheGoogleFile(original: FileWithAccount, options: StreamOptions = {}): Promise<CacheProgress> {
  const proxyUrl = getAccountProxyUrl(original.connectedAccount)
  const dispatcher = getUndiciDispatcher(proxyUrl)
  const auth = await getAuthedGoogleClient(original.connectedAccount)
  const headers = normalizeHeaders(await auth.getRequestHeaders())

  let file = original
  if (original.mimeType === 'application/vnd.google-apps.shortcut' && original.shortcutTargetId) {
    const target = await getGoogleDriveClient(auth, proxyUrl).files.get({ fileId: original.shortcutTargetId, fields: 'id,name,mimeType', supportsAllDrives: true })
    file = { ...original, providerFileId: original.shortcutTargetId, name: target.data.name ?? original.name, mimeType: target.data.mimeType ?? original.mimeType }
  }
  const exportTarget = options.exportMimeType && file.mimeType.startsWith('application/vnd.google-apps.')
    ? { mimeType: options.exportMimeType, extension: options.exportExtension ?? '' }
    : (options.disposition === 'inline' ? googlePreviewExportMimeTypes : googleDownloadExportMimeTypes)[file.mimeType]
  const responseMimeType = exportTarget?.mimeType ?? file.mimeType
  const responseFileName = exportTarget ? withExtension(file.name, exportTarget.extension) : file.name
  const url = exportTarget
    ? `https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`

  const cacheKey = exportTarget ? `${file.providerFileId}_export_${exportTarget.extension}` : file.providerFileId

  const downloadFn = async (rangeForFetch?: string) => {
    let dlResponse = await fetch(url, {
      dispatcher,
      headers: {
        ...headers,
        ...(rangeForFetch && !exportTarget ? { Range: rangeForFetch } : {}),
      },
    } as any)

    if (!dlResponse.ok) {
      if (dlResponse.status === 404 && file === original) {
        await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date() } }).catch(() => undefined)
        return null
      }
      const bypass = await attemptGoogleBypassStream(original.connectedAccount, file.providerFileId, null, rangeForFetch, file.mimeType)
      if (bypass && (bypass.status === 200 || bypass.status === 206)) {
        dlResponse = bypass
      } else {
        return null
      }
    }

    if (!dlResponse.body) return null
    const cLength = dlResponse.headers.get('content-length')
    return {
      stream: dlResponse.body,
      contentType: responseMimeType,
      sizeBytes: cLength ? parseInt(cLength, 10) : undefined,
      contentRange: dlResponse.headers.get('content-range') || undefined,
      status: dlResponse.status,
    }
  }

  // Trigger background download to 100% completion
  triggerBackgroundDownload(cacheKey, responseFileName, downloadFn, {
    isPermanent: true,
    fileName: responseFileName,
    disposition: options.disposition || 'inline',
  }).catch(() => undefined)

  return getCacheProgress(cacheKey)
}
