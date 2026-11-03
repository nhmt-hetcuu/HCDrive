import { prisma } from '../config/prisma.js'
import { encryptText } from '../utils/crypto.js'

const scopes = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const frontendUrl = (process.env.FRONTEND_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '')
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${frontendUrl}/connected-accounts/google/callback`

  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.')

  const existing = await prisma.providerConfig.findFirst({
    where: { userId: null, provider: 'google_drive', status: 'active' },
  })

  let config
  if (existing) {
    config = await prisma.providerConfig.update({
      where: { id: existing.id },
      data: {
        clientIdEncrypted: encryptText(clientId),
        clientSecretEncrypted: encryptText(clientSecret),
        redirectUri,
        scopes,
      },
    })
    console.log(`Updated active global Google Drive config: ${config.id}`)
  } else {
    config = await prisma.providerConfig.create({
      data: {
        userId: null,
        provider: 'google_drive',
        clientIdEncrypted: encryptText(clientId),
        clientSecretEncrypted: encryptText(clientSecret),
        redirectUri,
        scopes,
        status: 'active',
      },
    })
    console.log(`Seeded global Google Drive config: ${config.id}`)
  }

  // Clean up any old duplicate disabled configs
  await prisma.providerConfig.deleteMany({
    where: { userId: null, provider: 'google_drive', status: 'disabled' },
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
