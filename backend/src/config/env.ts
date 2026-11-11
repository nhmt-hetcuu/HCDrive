import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().default(5 * 1024 * 1024 * 1024),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  RECAPTCHA_SITE_KEY: z.string().optional(),
  // true: skip every captcha check (for an admin locked out by a wrong key in Settings → Security).
  DISABLE_CAPTCHA: z.string().optional(),
  // Comma-separated admin emails. Empty = the first registered user is admin.
  ADMIN_EMAILS: z.string().optional(),
  // Which proxies may set X-Forwarded-For (and so the client IP that rate limits and the session list
  // use). Unset: detect Cloudflare and private-network proxies (nginx, Docker) automatically, see
  // utils/client-ip.ts; Settings → Security can turn that off. "false": none, for a backend reached directly. "cloudflare": also trust CF-Connecting-IP
  // (only behind Cloudflare, where clients cannot reach the backend another way). Anything else goes
  // to Express "trust proxy" as is, e.g. "loopback", "1", "172.16.0.0/12".
  TRUST_PROXY: z.string().optional(),
  // General API limit per signed-in user (or per IP before sign-in).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(2000),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  REDIS_URL: z.string().optional(),
})

export const env = envSchema.parse(process.env)
