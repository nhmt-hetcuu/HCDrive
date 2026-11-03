import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'
import type { ConnectedAccount, File } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from '../google/google.service.js'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'

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
  const response = await fetch(url, {
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
    const message = await response.text().catch(() => response.statusText)
    // A Google 401 must not reach the browser as-is: the frontend would read it as an expired HCDrive session.
    return res.status(response.status === 401 ? 502 : response.status).json({ code: 'GOOGLE_FILE_STREAM_FAILED', message: message || response.statusText })
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
