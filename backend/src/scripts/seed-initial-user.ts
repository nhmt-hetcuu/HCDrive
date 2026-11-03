import { prisma } from '../config/prisma.js'
import { hashPassword } from '../utils/password.js'

async function main() {
  const email = (process.env.INITIAL_USER_EMAIL || process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.INITIAL_USER_PASSWORD || ''
  const name = (process.env.INITIAL_USER_NAME || process.env.ADMIN_USER || 'Admin').trim()

  if (!email || !password) {
    return
  }

  const existing = await prisma.user.findUnique({
    where: { email },
  })

  // Runs on every container start: only create the user. Overwriting an existing one would undo
  // password/name changes made in the app and re-enable an account the admin disabled.
  if (existing) {
    console.log(`[seed-user] Initial user already exists, leaving it unchanged: ${email}`)
    return
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      status: 'active',
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
