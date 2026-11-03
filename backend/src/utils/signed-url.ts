import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

// Short-lived signed tokens for URLs an <img> loads without the Authorization header (thumbnails).
// The token names one id and an expiry; it gives access to nothing else.

const WINDOW_SECONDS = 6 * 60 * 60

function sign(payload: string) {
  return createHmac('sha256', `${env.JWT_ACCESS_SECRET}:signed-url`).update(payload).digest('base64url')
}

/**
 * Expiry is rounded to a 6-hour window and valid for one more, so a listing made twice in a row
 * returns the same URL and the browser cache keeps working.
 */
export function signId(purpose: string, id: string) {
  const now = Math.floor(Date.now() / 1000)
  const expires = (Math.floor(now / WINDOW_SECONDS) + 2) * WINDOW_SECONDS
  const payload = `${purpose}.${id}.${expires}`
  return `${id}.${expires}.${sign(payload)}`
}

export function verifySignedId(purpose: string, token: string): string | null {
  const [id, expires, signature] = token.split('.')
  if (!id || !expires || !signature) return null
  if (Number(expires) * 1000 < Date.now()) return null
  const expected = Buffer.from(sign(`${purpose}.${id}.${expires}`))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return id
}
