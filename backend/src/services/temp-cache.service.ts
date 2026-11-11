import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import cluster from 'node:cluster'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { Response as ExpressResponse } from 'express'
import { prisma } from '../config/prisma.js'
import { redisPublish, redisSubscribe, redisSet } from '../config/redis.js'

export type CacheMeta = {
  fileId: string
  fileName: string
  contentType: string
  sizeBytes: number
  createdAt: number
  lastAccessedAt: number
  completed: boolean
  isPermanent?: boolean
}

export type CacheProgress = {
  fileId: string
  fileName: string
  status: 'idle' | 'downloading' | 'completed' | 'error' | 'queued'
  downloadedBytes: number
  totalBytes: number
  percent: number
  speedBytesPerSec: number
  startedAt: number
  lastUpdatedAt: number
  error?: string
  queuePosition?: number
  activeCount?: number
  maxConcurrent?: number
  message?: string
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
  cacheTTLMinutes = Math.max(0, Math.min(val, 525600)) // 0 = permanent / never expire, up to 1 year
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
  return cacheTTLMinutes <= 0 ? 0 : cacheTTLMinutes * 60 * 1000
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
        if (!isNaN(parsed) && parsed >= 0) cacheTTLMinutes = parsed
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

// Broadcast progress across worker threads and cluster instances via IPC and Redis
export function notifyProgressIPC(progress: CacheProgress) {
  if (process.send) {
    try {
      process.send({ type: 'TEMP_CACHE_PROGRESS', data: { ...progress } })
    } catch {}
  }
  // Distributed Redis Pub/Sub & Key Cache
  redisPublish('hcdrive:temp-cache:progress', progress).catch(() => undefined)
  redisSet(`temp-cache:progress:${progress.fileId}`, progress, 15).catch(() => undefined)
}

// Receive progress broadcasts from other worker threads
if (typeof process.on === 'function') {
  process.on('message', (msg: any) => {
    if (msg?.type === 'TEMP_CACHE_PROGRESS' && msg.data?.fileId) {
      activeProgress.set(msg.data.fileId, msg.data)
      if (msg.data.status === 'completed' || msg.data.status === 'error') {
        setTimeout(() => activeProgress.delete(msg.data.fileId), 10_000)
      }
    }
  })
}

// Subscribe to distributed Redis progress updates
redisSubscribe('hcdrive:temp-cache:progress', (progress: CacheProgress) => {
  if (progress?.fileId) {
    activeProgress.set(progress.fileId, progress)
    if (progress.status === 'completed' || progress.status === 'error') {
      setTimeout(() => activeProgress.delete(progress.fileId), 10_000)
    }
  }
})

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

export function findDownloadingFile(fileId: string): string | null {
  try {
    const dir = ensureCacheDir()
    const target = path.join(dir, `${safeKey(fileId)}.downloading`)
    if (fs.existsSync(target)) return target

    const prefix = safeKey(fileId)
    const entries = fs.readdirSync(dir)
    for (const name of entries) {
      if (name.startsWith(prefix) && name.endsWith('.downloading')) {
        return path.join(dir, name)
      }
    }
  } catch {}
  return null
}

export function readCacheMeta(fileId: string): CacheMeta | null {
  try {
    if (!cacheEnabled) return null

    let metaPath = getCacheMetaPath(fileId)
    let dataPath = getCacheDataPath(fileId)

    // If exact hash path doesn't exist, search directory by fileId prefix
    if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) {
      const dir = ensureCacheDir()
      const entries = fs.readdirSync(dir)
      const clean = fileId.slice(0, 16).replace(/[^A-Za-z0-9_-]/g, '_')
      for (const name of entries) {
        if (name.startsWith(clean) && name.endsWith('.meta.json')) {
          const testMeta = path.join(dir, name)
          const testData = path.join(dir, name.replace('.meta.json', '.data'))
          if (fs.existsSync(testMeta) && fs.existsSync(testData)) {
            metaPath = testMeta
            dataPath = testData
            break
          }
        }
      }
    }

    if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) return null

    const raw = fs.readFileSync(metaPath, 'utf8')
    const meta: CacheMeta = JSON.parse(raw)
    if (!meta.completed) return null

    // Check if expired: files marked isPermanent NEVER expire by TTL!
    const ttlMs = getCacheTTLMs()
    if (!meta.isPermanent && ttlMs > 0 && Date.now() - meta.lastAccessedAt > ttlMs) {
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
    const dlPath = findDownloadingFile(fileId)
    if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath)
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
    if (dlPath && fs.existsSync(dlPath)) fs.unlinkSync(dlPath)
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
      activeCount: activeBgDownloads.size,
      maxConcurrent: MAX_CONCURRENT_BG_DOWNLOADS,
    }
  }

  const active = activeProgress.get(fileId)
  if (active) {
    return {
      ...active,
      activeCount: activeBgDownloads.size,
      maxConcurrent: MAX_CONCURRENT_BG_DOWNLOADS,
    }
  }

  // Cross-worker disk fallback: check if another worker thread is actively writing .downloading file
  const dlPath = findDownloadingFile(fileId)
  if (dlPath && fs.existsSync(dlPath)) {
    try {
      const stat = fs.statSync(dlPath)
      return {
        fileId,
        fileName: 'file',
        status: 'downloading',
        downloadedBytes: stat.size,
        totalBytes: stat.size,
        percent: 0,
        speedBytesPerSec: 0,
        startedAt: stat.birthtimeMs || Date.now(),
        lastUpdatedAt: stat.mtimeMs || Date.now(),
        activeCount: activeBgDownloads.size,
        maxConcurrent: MAX_CONCURRENT_BG_DOWNLOADS,
      }
    } catch {}
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
    activeCount: activeBgDownloads.size,
    maxConcurrent: MAX_CONCURRENT_BG_DOWNLOADS,
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

    const validFiles: Array<{ fileId: string; size: number; lastAccessedAt: number; isPermanent?: boolean }> = []
    const metaFileIds = new Set<string>()

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

        // Clean expired meta and data files (if TTL is set > 0; 0 means permanent)
        if (name.endsWith('.meta.json')) {
          const raw = fs.readFileSync(fullPath, 'utf8')
          const meta: CacheMeta = JSON.parse(raw)
          metaFileIds.add(safeKey(meta.fileId))

          // Permanent files (such as Selenium/Bypass extracted streams) are NEVER purged by TTL
          if (!meta.isPermanent && ttlMs > 0 && now - meta.lastAccessedAt > ttlMs) {
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
                  isPermanent: Boolean(meta.isPermanent),
                })
              } catch {}
            }
          }
        }
      } catch {}
    }

    // Clean orphaned .data files without a corresponding .meta.json file
    for (const name of entries) {
      if (name.endsWith('.data')) {
        const key = name.slice(0, -5)
        if (!metaFileIds.has(key)) {
          try {
            const orphanPath = path.join(dir, name)
            const stat = fs.statSync(orphanPath)
            freedBytes += stat.size
            fs.unlinkSync(orphanPath)
            deleted++
          } catch {}
        }
      }
    }

    // Check Max Cache Size (LRU eviction)
    if (cacheMaxGB > 0) {
      const maxBytes = cacheMaxGB * 1024 * 1024 * 1024
      let currentTotalBytes = validFiles.reduce((acc, f) => acc + f.size, 0)
      if (currentTotalBytes > maxBytes) {
        // Evict non-permanent cache files first, then oldest accessed
        validFiles.sort((a, b) => {
          if (Boolean(a.isPermanent) !== Boolean(b.isPermanent)) {
            return a.isPermanent ? 1 : -1
          }
          return a.lastAccessedAt - b.lastAccessedAt
        })
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

export function recoverDownloadingFiles() {
  try {
    const dir = ensureCacheDir()
    const entries = fs.readdirSync(dir)
    const now = Date.now()
    for (const name of entries) {
      if (name.endsWith('.downloading')) {
        const fullPath = path.join(dir, name)
        try {
          const stat = fs.statSync(fullPath)
          // Clean up stale or interrupted .downloading files inactive for > 15 minutes
          if (now - stat.mtimeMs > 15 * 60 * 1000) {
            try { fs.unlinkSync(fullPath) } catch {}
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn('[temp-cache] Notice during recovery cleanup:', err)
  }
}

export function startTempCacheCleanup() {
  if (cleanupTimer) return
  ensureCacheDir()
  recoverDownloadingFiles()
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
  res.setHeader('Cache-Control', cacheTTLMinutes <= 0 ? 'private, max-age=31536000' : `private, max-age=${Math.min(cacheTTLMinutes * 60, 86400)}`)
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

// Concurrency limiter for background cache downloads (up to 3 concurrent downloads)
export const MAX_CONCURRENT_BG_DOWNLOADS = 3

interface ActiveBackgroundTask {
  fileId: string
  fileName: string
  downloadFn: (range?: string) => Promise<DownloadSource | null>
  options: { isPermanent?: boolean; disposition?: 'inline' | 'attachment'; fileName?: string }
  clients: Set<ExpressResponse>
  startedAt: number
  totalBytes: number
  downloadedBytes: number
  contentType: string
  promise: Promise<CacheMeta | null>
  abortController: AbortController
}

interface QueuedDownload {
  fileId: string
  fileName: string
  downloadFn: (range?: string) => Promise<DownloadSource | null>
  options: { isPermanent?: boolean; disposition?: 'inline' | 'attachment'; fileName?: string }
  resolve: (meta: CacheMeta | null) => void
  reject: (err: any) => void
  enqueuedAt: number
}

const activeBgDownloads = new Map<string, ActiveBackgroundTask>()
const bgDownloadQueue: QueuedDownload[] = []

/**
 * Get status of background downloads and queue.
 */
export function getBackgroundQueueStatus() {
  return {
    activeCount: activeBgDownloads.size,
    queuedCount: bgDownloadQueue.length,
    maxConcurrent: MAX_CONCURRENT_BG_DOWNLOADS,
    activeFiles: Array.from(activeBgDownloads.values()).map((t) => ({
      fileId: t.fileId,
      fileName: t.fileName,
      downloadedBytes: t.downloadedBytes,
      totalBytes: t.totalBytes,
      startedAt: t.startedAt,
    })),
    queuedFiles: bgDownloadQueue.map((q, idx) => ({
      fileId: q.fileId,
      fileName: q.fileName,
      queuePosition: idx + 1,
      enqueuedAt: q.enqueuedAt,
    })),
  }
}

/**
 * Trigger a background 100% download task for a file.
 * If concurrent limit is reached, file is placed into the queue.
 * Runs completely detached from any HTTP response so exiting the app does not stop it!
 */
export function triggerBackgroundDownload(
  fileId: string,
  fileName: string,
  downloadFn: (range?: string) => Promise<DownloadSource | null>,
  options: { isPermanent?: boolean; disposition?: 'inline' | 'attachment'; fileName?: string } = {},
  initialClient?: ExpressResponse
): Promise<CacheMeta | null> {
  if (!cacheEnabled) return Promise.resolve(null)

  // 1. If already completed in cache
  const existing = readCacheMeta(fileId)
  if (existing) return Promise.resolve(touchCache(fileId))

  // 2. If already actively downloading in this process
  const active = activeBgDownloads.get(fileId)
  if (active) {
    if (initialClient && !initialClient.destroyed && !initialClient.writableEnded && active.downloadedBytes === 0) {
      active.clients.add(initialClient)
      initialClient.on('close', () => active.clients.delete(initialClient))
    }
    return active.promise
  }

  // 3. If already waiting in queue
  const alreadyQueued = bgDownloadQueue.find((q) => q.fileId === fileId)
  if (alreadyQueued) {
    return new Promise<CacheMeta | null>((resolve) => {
      const orig = alreadyQueued.resolve
      alreadyQueued.resolve = (meta) => {
        orig(meta)
        resolve(meta)
      }
    })
  }

  // 4. Check if actively downloading in another cluster worker
  const dlPath = findDownloadingFile(fileId)
  if (dlPath && fs.existsSync(dlPath)) {
    return (async () => {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const found = readCacheMeta(fileId)
        if (found) return found
        if (!findDownloadingFile(fileId)) break
      }
      return readCacheMeta(fileId)
    })()
  }

  // 5. Concurrency check: if at capacity, add to queue and notify user
  if (activeBgDownloads.size >= MAX_CONCURRENT_BG_DOWNLOADS) {
    return new Promise<CacheMeta | null>((resolve, reject) => {
      bgDownloadQueue.push({
        fileId,
        fileName,
        downloadFn,
        options,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      })

      const queuePos = bgDownloadQueue.length
      const progress: CacheProgress = {
        fileId,
        fileName: options.fileName || fileName || 'file',
        status: 'queued',
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 0,
        speedBytesPerSec: 0,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        queuePosition: queuePos,
        activeCount: activeBgDownloads.size,
        maxConcurrent: MAX_CONCURRENT_BG_DOWNLOADS,
        message: `Đang có ${activeBgDownloads.size}/${MAX_CONCURRENT_BG_DOWNLOADS} video đang tải nền. Tệp này đã vào hàng đợi (vị trí #${queuePos}) và sẽ tự động tải khi hoàn tất.`,
      }
      activeProgress.set(fileId, progress)
      notifyProgressIPC(progress)
      console.log(`[temp-cache] Enqueued background download for ${fileName} (Queue position: #${queuePos}, Active: ${activeBgDownloads.size})`)
    })
  }

  return executeBackgroundDownload(fileId, fileName, downloadFn, options, initialClient)
}

function executeBackgroundDownload(
  fileId: string,
  fileName: string,
  downloadFn: (range?: string) => Promise<DownloadSource | null>,
  options: { isPermanent?: boolean; disposition?: 'inline' | 'attachment'; fileName?: string } = {},
  initialClient?: ExpressResponse
): Promise<CacheMeta | null> {
  const abortController = new AbortController()
  const outFileName = options.fileName || fileName || 'file'
  const dlPath = path.join(ensureCacheDir(), `${safeKey(fileId)}.downloading`)
  const finalDataPath = getCacheDataPath(fileId)

  let resolvePromise: (meta: CacheMeta | null) => void = () => {}
  let rejectPromise: (err: any) => void = () => {}
  const downloadPromise = new Promise<CacheMeta | null>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const clients = new Set<ExpressResponse>()
  if (initialClient && !initialClient.destroyed && !initialClient.writableEnded) {
    clients.add(initialClient)
    initialClient.on('close', () => clients.delete(initialClient))
  }

  const task: ActiveBackgroundTask = {
    fileId,
    fileName: outFileName,
    downloadFn,
    options,
    clients,
    startedAt: Date.now(),
    totalBytes: 0,
    downloadedBytes: 0,
    contentType: 'application/octet-stream',
    promise: downloadPromise,
    abortController,
  }

  activeBgDownloads.set(fileId, task)
  activeDownloads.set(fileId, downloadPromise)

  const progress: CacheProgress = {
    fileId,
    fileName: outFileName,
    status: 'downloading',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    speedBytesPerSec: 0,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    activeCount: activeBgDownloads.size,
    maxConcurrent: MAX_CONCURRENT_BG_DOWNLOADS,
  }
  activeProgress.set(fileId, progress)
  notifyProgressIPC(progress)

  ;(async () => {
    try {
      console.log(`[temp-cache] 🚀 Starting 100% background download for ${outFileName} (${fileId}). Active: ${activeBgDownloads.size}/${MAX_CONCURRENT_BG_DOWNLOADS}`)

      const source = await downloadFn()
      if (!source || !source.stream) {
        throw new Error('No stream from provider')
      }

      task.contentType = source.contentType || 'application/octet-stream'
      task.totalBytes = source.sizeBytes || 0

      if (!task.totalBytes && source.contentRange) {
        const match = source.contentRange.match(/\/(\d+)/)
        if (match?.[1]) task.totalBytes = parseInt(match[1], 10)
      }

      // Configure headers on all connected clients
      for (const client of task.clients) {
        if (!client.headersSent) {
          client.status(source.status || 200)
          client.setHeader('Content-Type', task.contentType)
          client.setHeader('Accept-Ranges', 'bytes')
          client.setHeader('Cache-Control', cacheTTLMinutes <= 0 ? 'private, max-age=31536000' : `private, max-age=${Math.min(cacheTTLMinutes * 60, 86400)}`)
          client.setHeader('Content-Disposition', formatContentDisposition(options.disposition || 'inline', outFileName))
          if (source.contentRange) client.setHeader('Content-Range', source.contentRange)
          if (task.totalBytes > 0) client.setHeader('Content-Length', task.totalBytes.toString())
        }
      }

      progress.totalBytes = task.totalBytes
      notifyProgressIPC(progress)

      const fileWriteStream = fs.createWriteStream(dlPath)
      const readable: Readable = 'pipe' in (source.stream as any)
        ? (source.stream as any)
        : (Readable.fromWeb(source.stream as any) as Readable)

      let lastReport = Date.now()
      let bytesSinceLast = 0

      readable.on('data', (chunk: Buffer | Uint8Array) => {
        task.downloadedBytes += chunk.length
        progress.downloadedBytes = task.downloadedBytes
        bytesSinceLast += chunk.length

        // Write to disk cache with backpressure support
        const canWrite = fileWriteStream.write(chunk)
        if (!canWrite) {
          readable.pause()
          fileWriteStream.once('drain', () => readable.resume())
        }

        // Forward chunk to any listening client streams
        for (const client of task.clients) {
          if (!client.destroyed && !client.writableEnded) {
            client.write(chunk)
          } else {
            task.clients.delete(client)
          }
        }

        const now = Date.now()
        if (now - lastReport >= 500) {
          const durSec = (now - lastReport) / 1000
          progress.speedBytesPerSec = durSec > 0 ? Math.round(bytesSinceLast / durSec) : 0
          progress.percent = progress.totalBytes > 0
            ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
            : 0
          progress.lastUpdatedAt = now
          lastReport = now
          bytesSinceLast = 0
          notifyProgressIPC(progress)
        }
      })

      await new Promise<void>((res, rej) => {
        readable.on('end', () => {
          fileWriteStream.end(() => res())
        })
        readable.on('error', (err) => {
          fileWriteStream.destroy()
          rej(err)
        })
      })

      // End all client responses safely
      for (const client of task.clients) {
        if (!client.destroyed && !client.writableEnded) {
          client.end()
        }
      }
      task.clients.clear()

      if (!fs.existsSync(dlPath)) {
        throw new Error('Downloaded file missing on disk')
      }

      const stat = fs.statSync(dlPath)
      const isComplete = stat.size > 0 && (!task.totalBytes || stat.size >= task.totalBytes || Math.abs(stat.size - task.totalBytes) < 2048)

      if (isComplete) {
        if (fs.existsSync(finalDataPath)) {
          try { fs.unlinkSync(finalDataPath) } catch {}
        }
        fs.renameSync(dlPath, finalDataPath)

        const meta: CacheMeta = {
          fileId,
          fileName: outFileName,
          contentType: task.contentType,
          sizeBytes: stat.size,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          completed: true,
          isPermanent: options.isPermanent !== false,
        }
        writeCacheMeta(meta)

        progress.status = 'completed'
        progress.downloadedBytes = stat.size
        progress.totalBytes = stat.size
        progress.percent = 100
        progress.speedBytesPerSec = 0
        progress.lastUpdatedAt = Date.now()
        notifyProgressIPC(progress)

        console.log(`[temp-cache] ✅ 100% Download complete: ${outFileName} (${(stat.size / (1024 * 1024)).toFixed(2)} MB) saved to cache!`)
        resolvePromise(meta)
      } else {
        try { fs.unlinkSync(dlPath) } catch {}
        progress.status = 'error'
        progress.error = `Tải gián đoạn (${stat.size}/${task.totalBytes} bytes)`
        notifyProgressIPC(progress)
        resolvePromise(null)
      }
    } catch (err: any) {
      try { if (fs.existsSync(dlPath)) fs.unlinkSync(dlPath) } catch {}
      console.warn(`[temp-cache] Background download error for ${outFileName}:`, err?.message || err)
      progress.status = 'error'
      progress.error = err?.message || 'Download failed'
      notifyProgressIPC(progress)
      resolvePromise(null)
    } finally {
      activeBgDownloads.delete(fileId)
      activeDownloads.delete(fileId)

      // Automatically pop and start next queued download!
      processNextQueuedDownload()
    }
  })()

  return downloadPromise
}

function processNextQueuedDownload() {
  if (bgDownloadQueue.length === 0) return
  if (activeBgDownloads.size >= MAX_CONCURRENT_BG_DOWNLOADS) return

  const next = bgDownloadQueue.shift()
  if (!next) return

  console.log(`[temp-cache] ⚡ Dequeueing next download: ${next.fileName} (Remaining in queue: ${bgDownloadQueue.length})`)

  // Update remaining queue positions
  bgDownloadQueue.forEach((item, idx) => {
    const qProgress = activeProgress.get(item.fileId)
    if (qProgress && qProgress.status === 'queued') {
      qProgress.queuePosition = idx + 1
      notifyProgressIPC(qProgress)
    }
  })

  executeBackgroundDownload(next.fileId, next.fileName, next.downloadFn, next.options)
    .then((meta) => next.resolve(meta))
    .catch((err) => next.reject(err))
}

/**
 * Downloads a Google Drive stream completely to the server cache and records its metadata,
 * updating activeProgress continuously.
 */
export async function downloadToCache(
  fileId: string,
  fileName: string,
  downloadFn: (range?: string) => Promise<DownloadSource | null>,
  options: { isPermanent?: boolean } = {}
): Promise<CacheMeta | null> {
  return triggerBackgroundDownload(fileId, fileName, downloadFn, options)
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
  options: { disposition?: 'inline' | 'attachment'; fileName?: string; isPermanent?: boolean } = {}
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

  // 2. Determine if partial range / seeking is requested
  let isPartialRange = false
  if (rangeHeader && typeof rangeHeader === 'string') {
    const rangeClean = rangeHeader.trim().toLowerCase()
    if (rangeClean !== 'bytes=0-') {
      isPartialRange = true
    }
  }

  const disposition = options.disposition || 'inline'
  const outFileName = options.fileName || fileName || 'file'
  const dlPath = path.join(ensureCacheDir(), `${safeKey(fileId)}.downloading`)

  // 3. If partial Range or seeking:
  if (isPartialRange) {
    // Check if requested byte range is already present in the active downloading file on disk!
    if (fs.existsSync(dlPath)) {
      try {
        const stat = fs.statSync(dlPath)
        const parts = rangeHeader!.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10) || 0
        const end = parts[1] ? parseInt(parts[1], 10) : undefined

        if (stat.size > 0 && start < stat.size && (!end || end < stat.size)) {
          const effectiveEnd = end !== undefined ? end : stat.size - 1
          const chunkSize = effectiveEnd - start + 1
          const activeTask = activeBgDownloads.get(fileId)
          const totalSize = activeTask?.totalBytes || stat.size

          res.status(206)
          res.setHeader('Content-Type', activeTask?.contentType || 'video/mp4')
          res.setHeader('Content-Range', `bytes ${start}-${effectiveEnd}/${totalSize}`)
          res.setHeader('Content-Length', chunkSize.toString())
          res.setHeader('Accept-Ranges', 'bytes')
          res.setHeader('Content-Disposition', formatContentDisposition(disposition, outFileName))

          const readStream = fs.createReadStream(dlPath, { start, end: effectiveEnd })
          await pipeline(readStream, res).catch(() => {
            if (!res.destroyed) res.destroy()
          })
          return true
        }
      } catch {}
    }

    // Trigger background cache download in parallel if not already active
    triggerBackgroundDownload(fileId, fileName, downloadFn, options).catch(() => undefined)

    // Direct proxy the requested Range from provider immediately so user doesn't wait
    const rangeSource = await downloadFn(rangeHeader)
    if (rangeSource && rangeSource.stream) {
      res.status(rangeSource.status || 206)
      res.setHeader('Content-Type', rangeSource.contentType || 'application/octet-stream')
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Cache-Control', cacheTTLMinutes <= 0 ? 'private, max-age=31536000' : `private, max-age=${Math.min(cacheTTLMinutes * 60, 86400)}`)
      res.setHeader('Content-Disposition', formatContentDisposition(disposition, outFileName))
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
    return false
  }

  // 4. Initial Play / Full Stream (bytes=0- or no Range):
  // Check if an active background task is currently streaming
  const activeTask = activeBgDownloads.get(fileId)
  if (activeTask) {
    if (activeTask.downloadedBytes === 0) {
      activeTask.clients.add(res)
      res.on('close', () => activeTask.clients.delete(res))
      res.on('error', () => activeTask.clients.delete(res))

      await new Promise<boolean>((resolve) => {
        res.on('finish', () => resolve(true))
        res.on('close', () => resolve(true))
        activeTask.promise.then(() => resolve(true)).catch(() => resolve(true))
      })
      return true
    }

    // Portions already on disk: stream from dlPath
    if (fs.existsSync(dlPath)) {
      try {
        const stat = fs.statSync(dlPath)
        if (stat.size > 0) {
          res.status(rangeHeader ? 206 : 200)
          res.setHeader('Content-Type', activeTask.contentType || 'video/mp4')
          res.setHeader('Accept-Ranges', 'bytes')
          res.setHeader('Cache-Control', cacheTTLMinutes <= 0 ? 'private, max-age=31536000' : `private, max-age=${Math.min(cacheTTLMinutes * 60, 86400)}`)
          res.setHeader('Content-Disposition', formatContentDisposition(disposition, outFileName))
          if (activeTask.totalBytes > 0) {
            if (rangeHeader) {
              res.setHeader('Content-Range', `bytes 0-${activeTask.totalBytes - 1}/${activeTask.totalBytes}`)
            }
            res.setHeader('Content-Length', activeTask.totalBytes.toString())
          }

          const readStream = fs.createReadStream(dlPath)
          await pipeline(readStream, res).catch(() => {
            if (!res.destroyed) res.destroy()
          })
          return true
        }
      } catch {}
    }
  }

  // No active task: Start background download with res attached as client!
  // SINGLE request to Google Drive: simultaneously writes to SSD cache AND streams directly to res!
  const bgPromise = triggerBackgroundDownload(fileId, fileName, downloadFn, options, res)
  await bgPromise.catch(() => null)
  return true
}

// Start auto cleanup on primary/main process or worker 1
if (!cluster.isWorker || cluster.worker?.id === 1) {
  startTempCacheCleanup()
}

// Synchronize cache config updates across all workers via Redis Pub/Sub
redisSubscribe('hcdrive:temp-cache:config-updated', (cfg: any) => {
  if (cfg.ttlMinutes !== undefined) setCacheTTLMinutes(cfg.ttlMinutes)
  if (cfg.maxGB !== undefined) setCacheMaxGB(cfg.maxGB)
  if (cfg.enabled !== undefined) setCacheEnabled(cfg.enabled)
})
