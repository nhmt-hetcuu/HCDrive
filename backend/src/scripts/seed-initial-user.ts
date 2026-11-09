import { prisma } from '../config/prisma.js'
import { hashPassword, verifyPassword } from '../utils/password.js'

async function main() {
  const email = (process.env.INITIAL_USER_EMAIL || process.env.ADMIN_EMAIL || 'admin@hcdrive.local').trim().toLowerCase()
  const password = process.env.INITIAL_USER_PASSWORD || 'admin'
  const name = (process.env.INITIAL_USER_NAME || process.env.ADMIN_USER || 'Admin').trim()

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { name },
      ],
    },
  })

  if (existing) {
    const isSamePassword = await verifyPassword(existing.passwordHash, password)
    if (!isSamePassword) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: await hashPassword(password),
          hasPassword: true,
          status: 'active',
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
        },
      })
      console.log(`[seed-user] Synchronized user password from .env for: ${existing.name} (${existing.email})`)
    } else {
      if (existing.status !== 'active') {
        await prisma.user.update({
          where: { id: existing.id },
          data: { status: 'active' },
        })
        console.log(`[seed-user] Reactivated user: ${existing.name} (${existing.email})`)
      } else {
        console.log(`[seed-user] User already exists and password matches .env: ${existing.name} (${existing.email})`)
      }
    }
    return
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      status: 'active',
      hasPassword: true,
    },
  })
  console.log(`[seed-user] Created initial user: ${user.name} (${user.email})`)
}

main()
  .catch((error) => {
    console.error('[seed-user] Error seeding user:', error)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
