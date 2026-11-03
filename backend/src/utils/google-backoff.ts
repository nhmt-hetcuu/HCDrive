// "Quota exceeded for quota metric 'Queries' ... 'Requests per minute'" is Google refusing more
// requests from one OAuth client this minute. The default (rclone) client shares that limit with
// every rclone user in the world, so it is hit often. Retrying at once only spends more of the same
// limit, so when an account hits it, HCDrive's background work for that account (sync, live folder
// reads, thumbnails, quota checks) waits a minute. Things the user asked for still go through.

const pausedUntil = new Map<string, number>()
const PAUSE_MS = 60_000

type GoogleError = {
  status?: number
  code?: number | string
  message?: string
  response?: { status?: number; data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } | string } }
}

export function isGoogleRateLimit(error: unknown) {
  const e = error as GoogleError
  const status = e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : undefined)
  const data = e?.response?.data
  const reason = typeof data?.error === 'object' ? data.error?.errors?.[0]?.reason : undefined
  const message = `${typeof data?.error === 'object' ? data.error?.message ?? '' : ''} ${e?.message ?? ''}`
  return status === 429
    || (status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'quotaExceeded'))
    || /quota exceeded|rate limit exceeded/i.test(message)
}

/** Records the error; returns true when it was a rate limit (and the account is now paused). */
export function noteGoogleError(accountId: string, error: unknown) {
  if (!isGoogleRateLimit(error)) return false
  pausedUntil.set(accountId, Date.now() + PAUSE_MS)
  return true
}

/** Milliseconds the account's background Google work should still wait (0 = go ahead). */
export function googlePausedFor(accountId: string) {
  const until = pausedUntil.get(accountId)
  if (!until) return 0
  const left = until - Date.now()
  if (left <= 0) pausedUntil.delete(accountId)
  return Math.max(0, left)
}
