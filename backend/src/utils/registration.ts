import { prisma } from '../config/prisma.js'
import { randomToken } from './crypto.js'
import { hashPassword } from './password.js'

export async function isRegistrationAllowed() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'allow_registration' } })
  return setting?.value !== 'false'
}

// Google sign-in creates the HCDrive user on first login, so it has to follow the same rules as
// /auth/register (registration toggle) and /auth/login (disabled accounts). Returns null when sign-in is not allowed.
export async function findOrCreateGoogleLoginUser(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return existing.status === 'active' ? existing : null
  if (!(await isRegistrationAllowed())) return null
  return prisma.user.create({ data: { email, name, hasPassword: false, passwordHash: await hashPassword(randomToken(32)) } })
}
