import type { NextFunction, Response } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import type { AuthRequest } from './auth.middleware.js'

const adminEmails = (env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)

export async function isAdminUser(userId: string) {
  if (adminEmails.length > 0) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    return Boolean(user && adminEmails.includes(user.email.toLowerCase()))
  }
  const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  return firstUser?.id === userId
}

// Must run after requireAuth.
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user || !(await isAdminUser(req.user.id))) return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Only the HCDrive administrator can perform this action.' })
    return next()
  } catch (error) {
    return next(error)
  }
}
