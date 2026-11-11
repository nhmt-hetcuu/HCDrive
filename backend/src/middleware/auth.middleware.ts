import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../config/prisma.js'
import { verifyAccessToken } from '../utils/jwt.js'
import { hashToken } from '../utils/crypto.js'
import { redisGet, redisSet } from '../config/redis.js'

export type AuthRequest = Request & {
  user?: { id: string; sessionId: string }
  apiKey?: { id: string; scopes: string[] }
}

export function extractAuthToken(req: Request): string | null {
  const xApiKey = req.header('X-API-Key')
  if (xApiKey?.trim()) return xApiKey.trim()

  const authHeader = req.header('Authorization')
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim()
    }
    if (authHeader.startsWith('9d_')) {
      return authHeader.trim()
    }
  }

  const queryKey = req.query.apiKey || req.query.api_key
  if (queryKey && typeof queryKey === 'string' && queryKey.startsWith('9d_')) {
    return queryKey.trim()
  }

  return null
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rawKey = extractAuthToken(req)
    if (!rawKey) return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Bearer token or API key required.' })

    // If token is an API Key (starts with 9d_)
    if (rawKey.startsWith('9d_')) {
      const keyHash = hashToken(rawKey)
      const cacheKey = `auth:apikey:${keyHash}`
      type CachedApiKey = { id: string; userId: string; status: string; revokedAt: string | null; expiresAt: string | null; scopes: string[] }

      let apiKey = await redisGet<CachedApiKey>(cacheKey)
      if (!apiKey) {
        const dbApiKey = await prisma.apiKey.findUnique({ where: { keyHash } })
        if (!dbApiKey) return res.status(401).json({ code: 'API_KEY_INVALID', message: 'Invalid or expired API key.' })
        apiKey = {
          id: dbApiKey.id,
          userId: dbApiKey.userId,
          status: dbApiKey.status,
          revokedAt: dbApiKey.revokedAt ? dbApiKey.revokedAt.toISOString() : null,
          expiresAt: dbApiKey.expiresAt ? dbApiKey.expiresAt.toISOString() : null,
          scopes: Array.isArray(dbApiKey.scopes) ? dbApiKey.scopes.filter((s): s is string => typeof s === 'string') : [],
        }
        if (apiKey.status === 'active' && !apiKey.revokedAt && (!apiKey.expiresAt || new Date(apiKey.expiresAt) > new Date())) {
          await redisSet(cacheKey, apiKey, 60)
        }
      }

      if (apiKey.status !== 'active' || apiKey.revokedAt || (apiKey.expiresAt && new Date(apiKey.expiresAt) <= new Date())) {
        return res.status(401).json({ code: 'API_KEY_INVALID', message: 'Invalid or expired API key.' })
      }
      req.user = { id: apiKey.userId, sessionId: `api-key:${apiKey.id}` }
      req.apiKey = { id: apiKey.id, scopes: apiKey.scopes }
      await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
      return next()
    }

    // Otherwise treat as JWT Access Token with high-speed Redis session caching
    const payload = verifyAccessToken(rawKey)
    const sessionCacheKey = `auth:session:${payload.sid}`
    type CachedSession = { id: string; userId: string; revokedAt: string | null; expiresAt: string }

    let session = await redisGet<CachedSession>(sessionCacheKey)
    if (!session) {
      const dbSession = await prisma.userSession.findUnique({ where: { id: payload.sid } })
      if (!dbSession) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Session expired.' })
      session = {
        id: dbSession.id,
        userId: dbSession.userId,
        revokedAt: dbSession.revokedAt ? dbSession.revokedAt.toISOString() : null,
        expiresAt: dbSession.expiresAt.toISOString(),
      }
      if (!session.revokedAt && new Date(session.expiresAt) > new Date()) {
        await redisSet(sessionCacheKey, session, 60)
      }
    }

    if (session.revokedAt || new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Session expired.' })
    }
    req.user = { id: payload.sub, sessionId: payload.sid }
    return next()
  } catch {
    return res.status(401).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid token.' })
  }
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const rawKey = extractAuthToken(req)
    if (!rawKey) return next()

    if (rawKey.startsWith('9d_')) {
      const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(rawKey) } })
      if (apiKey && apiKey.status === 'active' && !apiKey.revokedAt && (!apiKey.expiresAt || apiKey.expiresAt > new Date())) {
        req.user = { id: apiKey.userId, sessionId: `api-key:${apiKey.id}` }
        const scopes = Array.isArray(apiKey.scopes) ? apiKey.scopes.filter((s): s is string => typeof s === 'string') : []
        req.apiKey = { id: apiKey.id, scopes }
      }
      return next()
    }

    const payload = verifyAccessToken(rawKey)
    const session = await prisma.userSession.findUnique({ where: { id: payload.sid } })
    if (session && !session.revokedAt && session.expiresAt >= new Date()) {
      req.user = { id: payload.sub, sessionId: payload.sid }
    }
  } catch {
    // ignore invalid token for optional auth
  }
  return next()
}

