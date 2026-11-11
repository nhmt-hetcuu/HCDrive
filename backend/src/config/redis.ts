import { env } from './env.js'

let RedisClass: any = null
try {
  // Use CommonJS require safely wrapped in try-catch
  // If ioredis is not present or has missing modules, app falls back to memory cache without crashing
  RedisClass = require('ioredis')
  if (RedisClass && RedisClass.default) {
    RedisClass = RedisClass.default
  }
} catch (err: any) {
  console.warn('[redis] ioredis library not available, continuing with local memory cache:', err?.message || err)
}

let redis: any = null
let redisSub: any = null
let isConnected = false
const inMemoryCache = new Map<string, { value: any; expiresAt?: number }>()
const inMemorySubscribers = new Map<string, Set<(data: any) => void>>()

const redisUrl = env.REDIS_URL || process.env.REDIS_URL

if (redisUrl && RedisClass) {
  try {
    redis = new RedisClass(redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy(times: number) {
        if (times > 10) {
          console.warn('[redis] Max reconnection attempts reached; using in-memory fallback')
          return null
        }
        return Math.min(times * 200, 3000)
      },
      enableReadyCheck: true,
      lazyConnect: false,
    })

    redis.on('connect', () => {
      isConnected = true
      console.log(`[redis] Connected to Redis at ${redisUrl.replace(/:[^:@]+@/, ':***@')}`)
    })

    redis.on('ready', () => {
      isConnected = true
    })

    redis.on('error', (err: any) => {
      isConnected = false
      console.warn('[redis] Connection warning:', err.message || err)
    })

    redis.on('close', () => {
      isConnected = false
    })

    // Dedicated subscriber connection for Pub/Sub
    redisSub = new RedisClass(redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy: () => 2000,
      lazyConnect: false,
    })
    redisSub.on('error', () => undefined)
    if (typeof redisSub.setMaxListeners === 'function') {
      redisSub.setMaxListeners(100)
    }
  } catch (err: any) {
    console.warn('[redis] Could not initialize Redis client, operating with local memory cache:', err?.message || err)
  }
} else if (!redisUrl) {
  console.log('[redis] REDIS_URL not set; running with high-performance local memory cache & SQLite.')
}

export function isRedisAvailable(): boolean {
  return isConnected && redis !== null && redis.status === 'ready'
}

export { redis as redisClient }

/**
 * Get cached item from Redis or local memory fallback
 */
export async function redisGet<T = any>(key: string): Promise<T | null> {
  if (isRedisAvailable()) {
    try {
      const data = await redis.get(key)
      if (!data) return null
      return JSON.parse(data) as T
    } catch {
      // Fallback on transient error
    }
  }

  // Memory fallback
  const item = inMemoryCache.get(key)
  if (!item) return null
  if (item.expiresAt && Date.now() > item.expiresAt) {
    inMemoryCache.delete(key)
    return null
  }
  return item.value as T
}

/**
 * Set cached item in Redis or local memory fallback
 */
export async function redisSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const jsonStr = JSON.stringify(value)

  if (isRedisAvailable()) {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await redis.set(key, jsonStr, 'EX', ttlSeconds)
      } else {
        await redis.set(key, jsonStr)
      }
      return
    } catch {
      // Fallback on transient error
    }
  }

  // Memory fallback
  const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined
  inMemoryCache.set(key, { value, expiresAt })
}

/**
 * Delete key(s) from Redis and memory fallback
 */
export async function redisDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return

  for (const k of keys) {
    inMemoryCache.delete(k)
  }

  if (isRedisAvailable()) {
    try {
      await redis.del(...keys)
    } catch {
      // Silent error
    }
  }
}

/**
 * Publish real-time events across workers and cluster nodes
 */
export async function redisPublish(channel: string, data: any): Promise<void> {
  const payload = JSON.stringify(data)

  if (isRedisAvailable()) {
    try {
      await redis.publish(channel, payload)
      return
    } catch {}
  }

  // Fallback to local in-memory listeners when Redis is not available
  const subs = inMemorySubscribers.get(channel)
  if (subs) {
    for (const cb of subs) {
      try { cb(data) } catch {}
    }
  }
}

/**
 * Subscribe to real-time events across workers and cluster nodes
 */
export function redisSubscribe(channel: string, callback: (data: any) => void): () => void {
  if (!inMemorySubscribers.has(channel)) {
    inMemorySubscribers.set(channel, new Set())
  }
  inMemorySubscribers.get(channel)!.add(callback)

  if (redisSub) {
    try {
      redisSub.subscribe(channel).catch(() => undefined)
      const onMessage = (ch: string, message: string) => {
        if (ch === channel) {
          try {
            const parsed = JSON.parse(message)
            callback(parsed)
          } catch {}
        }
      }
      redisSub.on('message', onMessage)

      return () => {
        inMemorySubscribers.get(channel)?.delete(callback)
        redisSub?.removeListener('message', onMessage)
      }
    } catch {}
  }

  return () => {
    inMemorySubscribers.get(channel)?.delete(callback)
  }
}
