import { prisma } from '../config/prisma.js'
import { hashToken, randomToken } from './crypto.js'
import { findOrCreateGoogleLoginUser } from './registration.js'

export type GoogleProfile = { id: string; email: string; name?: string | null; picture?: string | null }

// Scopes for linking a Google sign-in to an existing user: identity only, no Drive access.
export const GOOGLE_LINK_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

/**
 * The HCDrive user a Google sign-in belongs to. A Google account linked in Settings wins; otherwise
 * the user whose email is the Gmail address (created on first sign-in when registration is open),
 * and that Google account is recorded as linked to it. Returns null when sign-in is not allowed.
 */
export async function resolveGoogleLoginUser(profile: GoogleProfile) {
  const identity = await prisma.userIdentity.findUnique({
    where: { provider_providerSubject: { provider: 'google', providerSubject: profile.id } },
    include: { user: true },
  })
  if (identity) {
    if (identity.user.status !== 'active') return null
    await prisma.userIdentity.update({
      where: { id: identity.id },
      data: { email: profile.email, displayName: profile.name, avatarUrl: profile.picture, lastLoginAt: new Date() },
    })
    return identity.user
  }

  const name = profile.name || profile.email.split('@')[0] || 'Google User'
  const user = await findOrCreateGoogleLoginUser(profile.email, name)
  if (!user) return null
  await prisma.userIdentity.create({
    data: { userId: user.id, provider: 'google', providerSubject: profile.id, email: profile.email, displayName: profile.name, avatarUrl: profile.picture, lastLoginAt: new Date() },
  })
  return user
}

export type GoogleLinkResult = 'success' | 'linked_other' | 'email_taken'

/** Lets this Google account sign in to `userId`. */
export async function linkGoogleIdentity(userId: string, profile: GoogleProfile): Promise<GoogleLinkResult> {
  const identity = await prisma.userIdentity.findUnique({
    where: { provider_providerSubject: { provider: 'google', providerSubject: profile.id } },
  })
  if (identity && identity.userId !== userId) return 'linked_other'
  // A Gmail address that is another user's HCDrive email would sign in here instead of there.
  const emailOwner = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } })
  if (emailOwner && emailOwner.id !== userId) return 'email_taken'

  const data = { email: profile.email, displayName: profile.name, avatarUrl: profile.picture }
  if (identity) await prisma.userIdentity.update({ where: { id: identity.id }, data })
  else await prisma.userIdentity.create({ data: { ...data, userId, provider: 'google', providerSubject: profile.id } })
  return 'success'
}

// Google accounts waiting to be linked. The OAuth callback cannot tell which browser it runs in, so
// it only parks the profile here; the link happens when the same HCDrive user, signed in, confirms
// the one-time token. Otherwise someone could send their own link URL to a victim and get the
// victim's Google account attached to the attacker's HCDrive account. Kept in memory: a restart
// only means clicking "Link" again.
const pendingLinks = new Map<string, { userId: string; profile: GoogleProfile; expiresAt: number }>()

export function parkGoogleLink(userId: string, profile: GoogleProfile) {
  const now = Date.now()
  for (const [key, entry] of pendingLinks) if (entry.expiresAt < now) pendingLinks.delete(key)
  const token = randomToken()
  pendingLinks.set(hashToken(token), { userId, profile, expiresAt: now + 10 * 60_000 })
  return token
}

export function takeGoogleLink(token: string, userId: string) {
  const key = hashToken(token)
  const entry = pendingLinks.get(key)
  if (!entry || entry.expiresAt < Date.now() || entry.userId !== userId) return null
  pendingLinks.delete(key)
  return entry.profile
}
