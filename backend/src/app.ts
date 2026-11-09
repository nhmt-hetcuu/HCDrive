import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { env } from './config/env.js'
import { errorMiddleware } from './middleware/error.middleware.js'
import { limiters } from './middleware/rate-limit.js'
import { autoClientIp, loadProxyMode, refreshCloudflareRanges } from './utils/client-ip.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { providerConfigRouter } from './modules/provider-configs/provider-config.routes.js'
import { connectedAccountRouter } from './modules/connected-accounts/connected-account.routes.js'
import { storageRouter } from './modules/storage/storage.routes.js'
import { uploadRouter } from './modules/uploads/upload.routes.js'
import { fileRouter } from './modules/files/file.routes.js'
import { folderRouter } from './modules/folders/folder.routes.js'
import { publicRouter } from './modules/public/public.routes.js'
import { inviteRouter } from './modules/invites/invite.routes.js'
import { apiKeyRouter } from './modules/api-keys/api-key.routes.js'
import { publicApiRouter } from './modules/public-api/public-api.routes.js'
import { auditLogRouter } from './modules/audit-logs/audit-log.routes.js'
import { systemRouter } from './modules/system/system.routes.js'
import { homeRouter } from './modules/home/home.routes.js'
import { libraryRouter } from './modules/library/library.routes.js'

export const app = express()

// Client IP. Trusting every X-Forwarded-For / CF-Connecting-IP let any client pick its own IP and
// step around IP-based rate limits. Without TRUST_PROXY, HCDrive detects Cloudflare and private-network
// proxies (nginx, Docker) itself and trusts only their headers (utils/client-ip.ts, mode set in
// Settings → Security). TRUST_PROXY in the environment overrides that (see env.ts).
const trustProxy = env.TRUST_PROXY?.trim()
const behindCloudflare = trustProxy === 'cloudflare'
if (!trustProxy) {
  app.set('trust proxy', false)
  loadProxyMode().catch(() => undefined)
  refreshCloudflareRanges().catch(() => undefined)
  setInterval(() => refreshCloudflareRanges().catch(() => undefined), 24 * 60 * 60_000).unref()
  app.use(autoClientIp)
} else if (behindCloudflare || trustProxy === 'true') app.set('trust proxy', true)
else if (trustProxy !== 'false') app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)
else app.set('trust proxy', false)

if (behindCloudflare) {
  app.use((req, _res, next) => {
    const cfIp = req.header('cf-connecting-ip')
    if (cfIp) Object.defineProperty(req, 'ip', { value: cfIp, configurable: true })
    next()
  })
}

function isInternalOrLanOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/.test(hostname)) return true
    if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.lan')) return true
    return false
  } catch {
    return false
  }
}

// CORS: allow same-origin, configured FRONTEND_URL, LAN / internal IPs, or requests to the same host.
app.use(cors((req, callback) => {
  const origin = req.header('Origin')
  const host = (req.header('x-forwarded-host') || req.header('host') || '').split(',')[0].trim()
  let allowed = !origin || !env.FRONTEND_URL || origin === env.FRONTEND_URL || isInternalOrLanOrigin(origin)
  if (!allowed && origin && host) {
    try {
      const originHost = new URL(origin).host
      if (originHost === host) allowed = true
    } catch {}
  }
  callback(null, { origin: allowed, credentials: true })
}))

app.use(express.json({ limit: '1mb' }))

// Health check endpoint
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// API documentation route -> redirect to frontend in-app docs
app.get(['/docs', '/api/docs'], (_req, res) => {
  return res.redirect('/api-docs')
})

// API Router bundle
const apiRouter = express.Router()
// Every API request counts against its user's (or IP's) limit; auth routes add stricter ones.
apiRouter.use(limiters.api(env.RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_MINUTES))
apiRouter.use('/public', publicRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/api-keys', apiKeyRouter)
apiRouter.use('/provider-configs', providerConfigRouter)
apiRouter.use('/connected-accounts', connectedAccountRouter)
apiRouter.use('/storage', storageRouter)
apiRouter.use('/uploads', uploadRouter)
apiRouter.use('/files', fileRouter)
apiRouter.use('/folders', folderRouter)
apiRouter.use('/invites', inviteRouter)
apiRouter.use('/audit-logs', auditLogRouter)
apiRouter.use('/system', systemRouter)
apiRouter.use('/home', homeRouter)
apiRouter.use('/library', libraryRouter)
// Developer API aliases & public API
apiRouter.use('/upload', uploadRouter)
apiRouter.use('/v1/files', fileRouter)
apiRouter.use('/v1/folders', folderRouter)
apiRouter.use('/v1/storage', storageRouter)
apiRouter.use(publicApiRouter)
// Gracefully handle duplicated /api/api/... paths from client libraries/cURLs
apiRouter.use('/api', apiRouter)

// Serve frontend static files if present (single-container all-in-one mode)
const candidateDirs = [
  path.resolve(process.cwd(), 'public_html'),
  path.resolve(process.cwd(), '..', 'frontend', 'dist'),
  path.resolve(process.cwd(), 'frontend', 'dist'),
  path.resolve(process.cwd(), 'dist', 'public_html'),
]
const frontendDist = candidateDirs.find((dir) => fs.existsSync(path.join(dir, 'index.html')))
const wantsHtml = (req: express.Request) => req.method === 'GET' && req.accepts(['json', 'html']) === 'html'

app.use('/api', apiRouter)

if (frontendDist) {
  console.log(`[app] Serving frontend static assets from: ${frontendDist}`)
  app.use(express.static(frontendDist))

  // SPA fallback for browser navigations (Accept: text/html).
  // MUST run before the root apiRouter fallback mount so routes like /home, /files, /storage
  // serve index.html when refreshed (Ctrl+F5) instead of hitting requireAuth and returning 401 JSON.
  app.use((req, res, next) => {
    if (wantsHtml(req) && !req.path.startsWith('/api/')) {
      // Allow OAuth callbacks to reach apiRouter
      if (req.path.includes('/callback')) {
        return next()
      }
      return res.sendFile(path.join(frontendDist, 'index.html'))
    }
    return next()
  })
}

// Root mount kept for Google OAuth redirect URIs, the dev frontend and older API clients.
app.use('/', apiRouter)

app.use(errorMiddleware)
