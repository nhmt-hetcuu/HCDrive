import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { Response as ExpressResponse } from 'express'
import { prisma } from '../config/prisma.js'

export type CacheMeta = {
  fileId: string
  fileName: string
  contentType: string
  sizeBytes: number
  createdAt: number
  lastAccessedAt: number
  completed: boolean
}

export type CacheProgress = {
  fileId: string
  fileName: string
  status: 'idle' | 'downloading' | 'completed' | 'error'
  downloadedBytes: number
  totalBytes: number
  percent: number
  speedBytesPerSec: number
  startedAt: number
  lastUpdatedAt: number
  error?: string
}

export type DownloadSource = {
  stream: NodeJS.ReadableStream | ReadableStream<any>
  contentType?: string
  sizeBytes?: number
  contentRange?: string | null
  status?: number
}

// Default cache directory: inside persistent data folder /app/data/temp_cache or local ./data/temp_cache
const CACHE_DIR = process.env.TEMP_CACHE_DIR || path.join(process.cwd(), 'data', 'temp_cache')

// Dynamic cache configurations (can be tuned via Settings)
let cacheTTLMinutes = 30
let cacheMaxGB = 10 // 0 = unlimited
let cacheEnabled = true

export function getCacheTTLMinutes(): number {
  return cacheTTLMinutes
}

export function setCacheTTLMinutes(val: number) {
  cacheTTLMinutes = Math.max(1, Math.min(val, 43200)) // 1 min to 30 days
}

export function getCacheMaxGB(): number {
  return cacheMaxGB
}

export function setCacheMaxGB(val: number) {
  cacheMaxGB = Math.max(0, val)
}

export function isCacheEnabled(): boolean {
  return cacheEnabled
}

export function setCacheEnabled(val: boolean) {
  cacheEnabled = val
}

export function getCacheTTLMs(): number {
  return cacheTTLMinutes * 60 * 1000
}

export async function initTempCacheConfig() {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: ['temp_cache_ttl_minutes', 'temp_cache_max_gb', 'temp_cache_enabled'],
        },
      },
    })
    for (const s of settings) {
      if (s.key === 'temp_cache_ttl_minutes') {
        const parsed = parseInt(s.value, 10)
        if (!isNaN(parsed) && parsed > 0) cacheTTLMinutes = parsed
      } else if (s.key === 'temp_cache_max_gb') {
        const parsed = parseFloat(s.value)
        if (!isNaN(parsed) && parsed >= 0) cacheMaxGB = parsed
      } else if (s.key === 'temp_cache_enabled') {
        cacheEnabled = s.value !== 'false'
      }
    }
  } catch (err) {
    console.warn('[temp-cache] Could not load temp cache settings from DB, using defaults:', err)
  }
}

// In-memory active downloads & progress
const activeProgress = new Map<string, CacheProgress>()
const activeDownloads = new Map<string, Promise<CacheMeta | null>>()

function formatContentDisposition(disposition: string, fileName: string): string {
  const safeAscii = fileName.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_')
  const utf8Encoded = encodeURIComponent(fileName)
  return `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`
}

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
    if (!cacheEnabled) return null

    const metaPath = getCacheMetaPath(fileId)
    const dataPath = getCacheDataPath(fileId)
    if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) return null

    const raw = fs.readFileSync(metaPath, 'utf8')
    const meta: CacheMeta = JSON.parse(raw)
    if (!meta.completed) return null

    // Check if expired
    if (Date.now() - meta.lastAccessedAt > getCacheTTLMs()) {
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
    activeProgress.delete(fileId)
  } catch (err) {
    console.warn(`[temp-cache] Error deleting cache for ${fileId}:`, err)
  }
}

/**
 * Get current caching progress of a file.
 */
export function getCacheProgress(fileId: string): CacheProgress {
  const cached = readCacheMeta(fileId)
  if (cached) {
    return {
      fileId,
      fileName: cached.fileName,
      status: 'completed',
      downloadedBytes: cached.sizeBytes,
      totalBytes: cached.sizeBytes,
      percent: 100,
      speedBytesPerSec: 0,
      startedAt: cached.createdAt,
      lastUpdatedAt: cached.lastAccessedAt,
    }
  }

  const active = activeProgress.get(fileId)
  if (active) {
    return active
  }

  return {
    fileId,
    fileName: '',
    status: 'idle',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    speedBytesPerSec: 0,
    startedAt: 0,
    lastUpdatedAt: Date.now(),
  }
}

/**
 * Get current stats of temp cache (disk usage, file count, active settings).
 */
export function getTempCacheStats() {
  const dir = ensureCacheDir()
  let totalBytes = 0
  let fileCount = 0
  try {
    const entries = fs.readdirSync(dir)
    for (const name of entries) {
      if (name.endsWith('.data')) {
        fileCount++
        try {
          const stat = fs.statSync(path.join(dir, name))
          totalBytes += stat.size
        } catch {}
      }
    }
  } catch {}

  return {
    totalBytes,
    fileCount,
    cacheDir: CACHE_DIR,
    ttlMinutes: cacheTTLMinutes,
    maxGB: cacheMaxGB,
    enabled: cacheEnabled,
  }
}

/**
 * Instantly wipe all temporary cache files.
 */
export function purgeAllTempCache(): { deleted: number; freedBytes: number } {
  let deleted = 0
  let freedBytes = 0
  try {
    const dir = ensureCacheDir()
    const entries = fs.readdirSync(dir)
    for (const name of entries) {
      try {
        const fullPath = path.join(dir, name)
        const stat = fs.statSync(fullPath)
        freedBytes += stat.size
        fs.unlinkSync(fullPath)
        deleted++
      } catch {}
    }
  } catch (err) {
    console.warn('[temp-cache] Purge all error:', err)
  }
  activeProgress.clear()
  activeDownloads.clear()
  return { deleted, freedBytes }
}

/**
 * Periodically purge files expired past TTL or exceeding max allowed disk quota (LRU).
 */
export function purgeExpiredCache(): { deleted: number; freedBytes: number } {
  let deleted = 0
  let freedBytes = 0

  if (!cacheEnabled) {
    return purgeAllTempCache()
  }

  try {
    const dir = ensureCacheDir()
    const entries = fs.readdirSync(dir)
    const now = Date.now()
    const ttlMs = getCacheTTLMs()

    const validFiles: Array<{ fileId: string; size: number; lastAccessedAt: number }> = []

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
          if (now - meta.lastAccessedAt > ttlMs) {
            const dataFile = path.join(dir, `${safeKey(meta.fileId)}.data`)
            if (fs.existsSync(dataFile)) {
              try {
                freedBytes += fs.statSync(dataFile).size
                fs.unlinkSync(dataFile)
              } catch {}
            }
            fs.unlinkSync(fullPath)
            deleted++
            activeProgress.delete(meta.fileId)
          } else {
            const dataFile = path.join(dir, `${safeKey(meta.fileId)}.data`)
            if (fs.existsSync(dataFile)) {
              try {
                const dataStat = fs.statSync(dataFile)
                validFiles.push({
                  fileId: meta.fileId,
                  size: dataStat.size,
                  lastAccessedAt: meta.lastAccessedAt || meta.createdAt || now,
                })
              } catch {}
            }
          }
        }
      } catch {}
    }

    // Check Max Cache Size (LRU eviction)
    if (cacheMaxGB > 0) {
      const maxBytes = cacheMaxGB * 1024 * 1024 * 1024
      let currentTotalBytes = validFiles.reduce((acc, f) => acc + f.size, 0)
      if (currentTotalBytes > maxBytes) {
        // Sort oldest accessed first
        validFiles.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
        const targetBytes = maxBytes * 0.85 // 15% headroom
        for (const item of validFiles) {
          if (currentTotalBytes <= targetBytes) break
          deleteCacheFile(item.fileId)
          deleted++
          freedBytes += item.size
          currentTotalBytes -= item.size
        }
      }
    }
  } catch (err) {
    console.warn('[temp-cache] Purge check encountered error:', err)
  }

  if (deleted > 0) {
    console.log(`[temp-cache] Purged ${deleted} cache files (${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed)`)
  }
  return { deleted, freedBytes }
}

// Background cleanup every 3 minutes
let cleanupTimer: NodeJS.Timeout | null = null
export function startTempCacheCleanup() {
  if (cleanupTimer) return
  ensureCacheDir()
  initTempCacheConfig()
    .then(() => {
      purgeExpiredCache()
    })
    .catch(() => undefined)
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
  res.setHeader('Content-Disposition', formatContentDisposition(disposition, outFileName))

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
 * Downloads a Google Drive stream completely to the server cache and records its metadata,
 * updating activeProgress continuously.
 */
export async function downloadToCache(
  fileId: string,
  fileName: string,
  downloadFn: (range?: string) => Promise<DownloadSource | null>
): Promise<CacheMeta | null> {
  if (!cacheEnabled) return null

  const existing = readCacheMeta(fileId)
  if (existing) return touchCache(fileId)

  if (activeDownloads.has(fileId)) {
    return activeDownloads.get(fileId)!
  }

  const downloadPromise = (async () => {
    ensureCacheDir()
    const dlPath = getCacheDownloadingPath(fileId)
    const finalDataPath = getCacheDataPath(fileId)

    const progress: CacheProgress = {
      fileId,
      fileName: fileName || 'file',
      status: 'downloading',
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      speedBytesPerSec: 0,
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
    }
    activeProgress.set(fileId, progress)

    try {
      const source = await downloadFn()
      if (!source || !source.stream) {
        progress.status = 'error'
        progress.error = 'No stream from provider'
        return null
      }

      const totalSize = source.sizeBytes || 0
      progress.totalBytes = totalSize

      const writeStream = fs.createWriteStream(dlPath)
      const readable: Readable = 'pipe' in (source.stream as any)
        ? (source.stream as any)
        : (Readable.fromWeb(source.stream as any) as Readable)

      let lastReport = Date.now()
      let bytesSinceLast = 0

      readable.on('data', (chunk: Buffer | Uint8Array) => {
        progress.downloadedBytes += chunk.length
        bytesSinceLast += chunk.length
        const now = Date.now()
        if (now - lastReport >= 500) {
          const durationSec = (now - lastReport) / 1000
          progress.speedBytesPerSec = Math.round(bytesSinceLast / durationSec)
          progress.percent = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)) : 0
          progress.lastUpdatedAt = now
          lastReport = now
          bytesSinceLast = 0
        }
      })

      await pipeline(readable, writeStream)

      const stat = fs.statSync(dlPath)
      if (stat.size === 0) {
        if (fs.existsSync(dlPath)) fs.unlinkSync(dlPath)
        progress.status = 'error'
        return null
      }

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

      progress.status = 'completed'
      progress.downloadedBytes = stat.size
      progress.totalBytes = stat.size
      progress.percent = 100
      progress.lastUpdatedAt = Date.now()
      console.log(`[temp-cache] Cached ${fileName} (${(stat.size / (1024 * 1024)).toFixed(2)} MB) for 30 minutes.`)
      return meta
    } catch (err: any) {
      console.warn(`[temp-cache] Background cache download failed for ${fileId}:`, err?.message || err)
      progress.status = 'error'
      progress.error = err?.message || String(err)
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
 * Stream cached file if already present, or stream pass-through IMMEDIATELY to res
 * while caching in background so playback/download starts with 0s latency!
 */
export async function streamCachedOrFetch(
  fileId: string,
  fileName: string,
  rangeHeader: string | undefined,
  res: ExpressResponse,
  downloadFn: (range?: string) => Promise<DownloadSource | null>,
  options: { disposition?: 'inline' | 'attachment'; fileName?: string } = {}
): Promise<boolean> {
  // If caching is globally disabled, proxy directly without saving to disk
  if (!cacheEnabled) {
    const directSource = await downloadFn(rangeHeader)
    if (!directSource || !directSource.stream) return false
    const disposition = options.disposition || 'inline'
    const outFileName = options.fileName || fileName || 'file'

    res.status(directSource.status || (rangeHeader ? 206 : 200))
    res.setHeader('Content-Type', directSource.contentType || 'application/octet-stream')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Disposition', formatContentDisposition(disposition, outFileName))
    if (directSource.contentRange) res.setHeader('Content-Range', directSource.contentRange)
    if (directSource.sizeBytes) res.setHeader('Content-Length', directSource.sizeBytes)

    const readable = 'pipe' in (directSource.stream as any)
      ? (directSource.stream as NodeJS.ReadableStream)
      : (Readable.fromWeb(directSource.stream as any) as NodeJS.ReadableStream)

    await pipeline(readable, res).catch(() => {
      if (!res.destroyed) res.destroy()
    })
    return true
  }

  // 1. If already in cache and complete, serve directly from SSD with full HTTP 206 Range
  const cached = readCacheMeta(fileId)
  if (cached) {
    await serveCachedFile(cached, rangeHeader, res, options)
    return true
  }

  // 2. Check if a non-zero Range request is made (user seeking into video before full cache)
  let isSeeking = false
  if (rangeHeader && typeof rangeHeader === 'string') {
    const rangeMatch = rangeHeader.trim().replace(/^bytes=/, '')
    const [startStr] = rangeMatch.split('-')
    const startNum = parseInt(startStr, 10)
    if (!isNaN(startNum) && startNum > 0) {
      isSeeking = true
    }
  }

  // 3. If seeking or active download exists, handle Range directly
  if (isSeeking) {
    // If background download isn't running, start it in background so full file gets cached for 30 min
    if (!activeDownloads.has(fileId)) {
      downloadToCache(fileId, fileName, downloadFn).catch(() => undefined)
    }

    // Direct proxy the requested Range from provider immediately so user doesn't wait
    const rangeSource = await downloadFn(rangeHeader)
    if (rangeSource && rangeSource.stream) {
      const disposition = options.disposition || 'inline'
      const outFileName = options.fileName || fileName || 'file'

      res.status(rangeSource.status || 206)
      res.setHeader('Content-Type', rangeSource.contentType || 'application/octet-stream')
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Cache-Control', 'private, max-age=1800')
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${encodeURIComponent(outFileName)}"; filename*=UTF-8''${encodeURIComponent(outFileName)}`
      )
      if (rangeSource.contentRange) res.setHeader('Content-Range', rangeSource.contentRange)
      if (rangeSource.sizeBytes) res.setHeader('Content-Length', rangeSource.sizeBytes)

      const readable = 'pipe' in (rangeSource.stream as any)
        ? (rangeSource.stream as NodeJS.ReadableStream)
        : Readable.fromWeb(rangeSource.stream as any)

      await pipeline(readable, res).catch(() => {
        if (!res.destroyed) res.destroy()
      })
      return true
    }
  }

  // 4. Initial Play / Full Download (bytes=0- or no Range):
  // Fetch from provider and stream directly to client AND write to disk simultaneously (Pass-Through Tee)
  const source = await downloadFn(rangeHeader)
  if (!source || !source.stream) return false

  const disposition = options.disposition || 'inline'
  const outFileName = options.fileName || fileName || 'file'
  const contentType = source.contentType || 'application/octet-stream'
  const sizeBytes = source.sizeBytes

  res.status(rangeHeader ? (source.status || 206) : 200)
  res.setHeader('Content-Type', contentType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'private, max-age=1800')
  res.setHeader('Content-Disposition', formatContentDisposition(disposition, outFileName))
  if (source.contentRange) res.setHeader('Content-Range', source.contentRange)
  if (sizeBytes) res.setHeader('Content-Length', sizeBytes)

  const dlPath = getCacheDownloadingPath(fileId)
  const finalDataPath = getCacheDataPath(fileId)
  ensureCacheDir()
  const fileWriteStream = fs.createWriteStream(dlPath)

  const progress: CacheProgress = {
    fileId,
    fileName: outFileName,
    status: 'downloading',
    downloadedBytes: 0,
    totalBytes: sizeBytes || 0,
    percent: 0,
    speedBytesPerSec: 0,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  }
  activeProgress.set(fileId, progress)

  const readable: Readable = 'pipe' in (source.stream as any)
    ? (source.stream as any)
    : (Readable.fromWeb(source.stream as any) as Readable)

  let resClosed = false
  res.on('close', () => { resClosed = true })
  res.on('error', () => { resClosed = true })

  let lastReport = Date.now()
  let bytesSinceLast = 0

  return new Promise<boolean>((resolve) => {
    readable.on('data', (chunk: Buffer | Uint8Array) => {
      // Send to client immediately
      if (!resClosed && !res.destroyed && !res.writableEnded) {
        res.write(chunk)
      }
      // Write to disk cache with backpressure support
      const canWrite = fileWriteStream.write(chunk)
      if (!canWrite) {
        readable.pause()
        fileWriteStream.once('drain', () => {
          readable.resume()
        })
      }

      progress.downloadedBytes += chunk.length
      bytesSinceLast += chunk.length
      const now = Date.now()
      if (now - lastReport >= 500) {
        const durationSec = (now - lastReport) / 1000
        progress.speedBytesPerSec = Math.round(bytesSinceLast / durationSec)
        progress.percent = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)) : 0
        progress.lastUpdatedAt = now
        lastReport = now
        bytesSinceLast = 0
      }
    })

    readable.on('end', () => {
      if (!resClosed && !res.destroyed && !res.writableEnded) {
        res.end()
      }
      fileWriteStream.end(() => {
        try {
          const stat = fs.statSync(dlPath)
          if (stat.size > 0) {
            if (fs.existsSync(finalDataPath)) fs.unlinkSync(finalDataPath)
            fs.renameSync(dlPath, finalDataPath)
            const meta: CacheMeta = {
              fileId,
              fileName: outFileName,
              contentType,
              sizeBytes: stat.size,
              createdAt: Date.now(),
              lastAccessedAt: Date.now(),
              completed: true,
            }
            writeCacheMeta(meta)
            progress.status = 'completed'
            progress.downloadedBytes = stat.size
            progress.totalBytes = stat.size
            progress.percent = 100
            progress.lastUpdatedAt = Date.now()
            console.log(`[temp-cache] Cached ${outFileName} (${(stat.size / (1024 * 1024)).toFixed(2)} MB) for ${cacheTTLMinutes} minutes.`)
          }
        } catch (err) {
          console.warn('[temp-cache] Error finalizing cache file:', err)
        }
        resolve(true)
      })
    })

    readable.on('error', (err: any) => {
      console.warn('[temp-cache] Stream error from provider:', err)
      if (!resClosed && !res.destroyed && !res.writableEnded) {
        res.destroy(err)
      }
      fileWriteStream.destroy()
      if (fs.existsSync(dlPath)) {
        try { fs.unlinkSync(dlPath) } catch {}
      }
      progress.status = 'error'
      progress.error = err.message || String(err)
      resolve(false)
    })
  })
}

// Start auto cleanup on module load
startTempCacheCleanup()
