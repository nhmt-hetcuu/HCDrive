import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { Response as ExpressResponse } from 'express'

export type CacheMeta = {
  fileId: string
  fileName: string
  contentType: string
  sizeBytes: number
  createdAt: number
  lastAccessedAt: number
  completed: boolean
}

// Default cache directory: inside persistent data folder /app/data/temp_cache or local ./data/temp_cache
const CACHE_DIR = process.env.TEMP_CACHE_DIR || path.join(process.cwd(), 'data', 'temp_cache')
// Expiration: 30 minutes in milliseconds
const CACHE_TTL_MS = 30 * 60 * 1000

// In-memory registry of active downloads to prevent duplicate concurrent downloads of the same file
const activeDownloads = new Map<string, Promise<CacheMeta | null>>()

function ensureCacheDir(): string {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
  } catch (err) {
    console.warn('[temp-cache] Failed to create cache directory:', err)
  }
  return CACHE_DIR
}

function safeKey(fileId: string): string {
  const hash = crypto.createHash('sha256').update(fileId).digest('hex').slice(0, 24)
  const cleanPrefix = fileId.slice(0, 20).replace(/[^A-Za-z0-9_-]/g, '_')
  return `${cleanPrefix}_${hash}`
}

export function getCacheDataPath(fileId: string): string {
  return path.join(ensureCacheDir(), `${safeKey(fileId)}.data`)
}

export function getCacheMetaPath(fileId: string): string {
  return path.join(ensureCacheDir(), `${safeKey(fileId)}.meta.json`)
}

export function getCacheDownloadingPath(fileId: string): string {
  return path.join(ensureCacheDir(), `${safeKey(fileId)}.downloading`)
}

export function readCacheMeta(fileId: string): CacheMeta | null {
  try {
    const metaPath = getCacheMetaPath(fileId)
    const dataPath = getCacheDataPath(fileId)
    if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) return null

    const raw = fs.readFileSync(metaPath, 'utf8')
    const meta: CacheMeta = JSON.parse(raw)
    if (!meta.completed) return null

    // Check if expired (> 30 minutes since lastAccessedAt)
    if (Date.now() - meta.lastAccessedAt > CACHE_TTL_MS) {
      deleteCacheFile(fileId)
      return null
    }

    return meta
  } catch {
    return null
  }
}

export function writeCacheMeta(meta: CacheMeta) {
  try {
    const metaPath = getCacheMetaPath(meta.fileId)
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  } catch (err) {
    console.warn(`[temp-cache] Failed to write meta for ${meta.fileId}:`, err)
  }
}

export function touchCache(fileId: string): CacheMeta | null {
  const meta = readCacheMeta(fileId)
  if (!meta) return null
  meta.lastAccessedAt = Date.now()
  writeCacheMeta(meta)
  return meta
}

export function deleteCacheFile(fileId: string) {
  try {
    const dataPath = getCacheDataPath(fileId)
    const metaPath = getCacheMetaPath(fileId)
    const dlPath = getCacheDownloadingPath(fileId)
    if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath)
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
    if (fs.existsSync(dlPath)) fs.unlinkSync(dlPath)
  } catch (err) {
    console.warn(`[temp-cache] Error deleting cache for ${fileId}:`, err)
  }
}

/**
 * Periodically purge files older than 30 minutes from lastAccessedAt.
 */
export function purgeExpiredCache(): { deleted: number; freedBytes: number } {
  let deleted = 0
  let freedBytes = 0
  try {
    const dir = ensureCacheDir()
    const entries = fs.readdirSync(dir)
    const now = Date.now()

    for (const name of entries) {
      const fullPath = path.join(dir, name)
      try {
        const stat = fs.statSync(fullPath)
        // Clean stale .downloading files older than 15 minutes
        if (name.endsWith('.downloading')) {
          if (now - stat.mtimeMs > 15 * 60 * 1000) {
            freedBytes += stat.size
            fs.unlinkSync(fullPath)
            deleted++
          }
          continue
        }

        // Clean expired meta and data files
        if (name.endsWith('.meta.json')) {
          const raw = fs.readFileSync(fullPath, 'utf8')
          const meta: CacheMeta = JSON.parse(raw)
          if (now - meta.lastAccessedAt > CACHE_TTL_MS) {
            const dataFile = path.join(dir, `${meta.fileId}.data`)
            if (fs.existsSync(dataFile)) {
              try {
                freedBytes += fs.statSync(dataFile).size
                fs.unlinkSync(dataFile)
              } catch {}
            }
            fs.unlinkSync(fullPath)
            deleted++
          }
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[temp-cache] Purge check encountered error:', err)
  }

  if (deleted > 0) {
    console.log(`[temp-cache] Purged ${deleted} expired cache files (${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed)`)
  }
  return { deleted, freedBytes }
}

// Background cleanup every 3 minutes
let cleanupTimer: NodeJS.Timeout | null = null
export function startTempCacheCleanup() {
  if (cleanupTimer) return
  ensureCacheDir()
  purgeExpiredCache()
  cleanupTimer = setInterval(() => {
    purgeExpiredCache()
  }, 3 * 60 * 1000)
  if (cleanupTimer.unref) cleanupTimer.unref()
}

/**
 * Serve an already-cached file from disk with full HTTP 206 Range support.
 */
export async function serveCachedFile(
  meta: CacheMeta,
  rangeHeader: string | undefined,
  res: ExpressResponse,
  options: { disposition?: 'inline' | 'attachment'; fileName?: string } = {}
): Promise<void> {
  if (res.headersSent) return

  const filePath = getCacheDataPath(meta.fileId)
  if (!fs.existsSync(filePath)) {
    throw new Error('Cache data file missing')
  }

  touchCache(meta.fileId)
  const fileSize = meta.sizeBytes
  const contentType = meta.contentType || 'application/octet-stream'
  const disposition = options.disposition || 'inline'
  const outFileName = options.fileName || meta.fileName || 'file'

  res.setHeader('Content-Type', contentType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'private, max-age=1800')
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${encodeURIComponent(outFileName)}"; filename*=UTF-8''${encodeURIComponent(outFileName)}`
  )

  if (rangeHeader && typeof rangeHeader === 'string') {
    const rangeMatch = rangeHeader.trim().replace(/^bytes=/, '')
    const [startStr, endStr] = rangeMatch.split('-')

    let start: number
    let end: number

    if (startStr === '' && endStr !== undefined) {
      // Suffix range: bytes=-500 means last 500 bytes
      const suffix = parseInt(endStr, 10)
      start = isNaN(suffix) ? 0 : Math.max(0, fileSize - suffix)
      end = fileSize - 1
    } else {
      start = startStr ? parseInt(startStr, 10) : 0
      end = endStr && endStr !== '' ? parseInt(endStr, 10) : fileSize - 1
    }

    if (isNaN(start) || start < 0) start = 0
    if (isNaN(end) || end >= fileSize) end = fileSize - 1

    if (start >= fileSize || start > end) {
      res.setHeader('Content-Range', `bytes */${fileSize}`)
      res.status(416).end()
      return
    }

    const chunksize = end - start + 1
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
    res.setHeader('Content-Length', chunksize)

    const fileStream = fs.createReadStream(filePath, { start, end })
    await pipeline(fileStream, res).catch(() => {
      if (!res.destroyed) res.destroy()
    })
    return
  }

  // No range header: send whole file
  res.status(200)
  res.setHeader('Content-Length', fileSize)
  const fileStream = fs.createReadStream(filePath)
  await pipeline(fileStream, res).catch(() => {
    if (!res.destroyed) res.destroy()
  })
}

/**
 * Downloads a Google Drive stream completely to the server cache and records its metadata.
 */
export async function downloadToCache(
  fileId: string,
  fileName: string,
  downloadFn: () => Promise<{ stream: NodeJS.ReadableStream | ReadableStream<any>; contentType?: string; sizeBytes?: number } | null>
): Promise<CacheMeta | null> {
  const existing = readCacheMeta(fileId)
  if (existing) return touchCache(fileId)

  // Avoid concurrent duplicate downloads of the same file
  if (activeDownloads.has(fileId)) {
    return activeDownloads.get(fileId)!
  }

  const downloadPromise = (async () => {
    ensureCacheDir()
    const dlPath = getCacheDownloadingPath(fileId)
    const finalDataPath = getCacheDataPath(fileId)

    try {
      const source = await downloadFn()
      if (!source || !source.stream) return null

      const writeStream = fs.createWriteStream(dlPath)
      const readable = 'pipe' in (source.stream as any)
        ? (source.stream as NodeJS.ReadableStream)
        : Readable.fromWeb(source.stream as any)

      await pipeline(readable, writeStream)
      const stat = fs.statSync(dlPath)
      if (stat.size === 0) {
        if (fs.existsSync(dlPath)) fs.unlinkSync(dlPath)
        return null
      }

      // Rename downloading -> final .data
      if (fs.existsSync(finalDataPath)) fs.unlinkSync(finalDataPath)
      fs.renameSync(dlPath, finalDataPath)

      const meta: CacheMeta = {
        fileId,
        fileName: fileName || 'file',
        contentType: source.contentType || 'application/octet-stream',
        sizeBytes: stat.size,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        completed: true,
      }
      writeCacheMeta(meta)
      console.log(`[temp-cache] Successfully cached ${fileName} (${(stat.size / (1024 * 1024)).toFixed(2)} MB) for 30 minutes.`)
      return meta
    } catch (err) {
      console.warn(`[temp-cache] Download failed for ${fileId}:`, err)
      if (fs.existsSync(dlPath)) {
        try { fs.unlinkSync(dlPath) } catch {}
      }
      return null
    } finally {
      activeDownloads.delete(fileId)
    }
  })()

  activeDownloads.set(fileId, downloadPromise)
  return downloadPromise
}

/**
 * Stream cached file if already present, or download and stream seamlessly.
 */
export async function streamCachedOrFetch(
  fileId: string,
  fileName: string,
  rangeHeader: string | undefined,
  res: ExpressResponse,
  downloadFn: () => Promise<{ stream: NodeJS.ReadableStream | ReadableStream<any>; contentType?: string; sizeBytes?: number } | null>,
  options: { disposition?: 'inline' | 'attachment'; fileName?: string } = {}
): Promise<boolean> {
  // 1. If already in cache and complete, serve directly with Range
  const cached = readCacheMeta(fileId)
  if (cached) {
    await serveCachedFile(cached, rangeHeader, res, options)
    return true
  }

  // 2. Not cached: download to cache
  const meta = await downloadToCache(fileId, fileName, downloadFn)
  if (meta) {
    await serveCachedFile(meta, rangeHeader, res, options)
    return true
  }

  return false
}

// Start auto cleanup on module load
startTempCacheCleanup()
