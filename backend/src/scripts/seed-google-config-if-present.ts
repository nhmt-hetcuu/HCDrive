import { prisma } from '../config/prisma.js'
import { decryptText, encryptText } from '../utils/crypto.js'

const scopes = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

function safeDecrypt(value: string) {
  try {
    return decryptText(value)
  } catch {
    return null
  }
}

function isConfigured(value: string | undefined, placeholders: string[]) {
  if (!value?.trim()) return false
  return !placeholders.includes(value.trim())
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  // Single-container mode serves the API on the same origin as the frontend.
  const frontendUrl = (process.env.FRONTEND_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '')
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || `${frontendUrl}/connected-accounts/google/callback`

  const hasClientId = isConfigured(clientId, ['your-google-client-id', 'your-client-id'])
  const hasClientSecret = isConfigured(clientSecret, ['your-google-client-secret', 'your-client-secret'])

  // Default verified Desktop OAuth credentials (from rclone, works without personal Google Cloud setup)
  const defaultClientId = '202264815644.apps.googleusercontent.com'
  const defaultClientSecret = 'X4Z3ca8xfWDb1Voo-F9a7ZxJ'

  const hasEnvCredentials = Boolean(hasClientId && hasClientSecret && clientId && clientSecret)
  const finalClientId = hasEnvCredentials ? clientId! : defaultClientId
  const finalClientSecret = hasEnvCredentials ? clientSecret! : defaultClientSecret

  const existing = await prisma.providerConfig.findFirst({
    where: { userId: null, provider: 'google_drive', status: 'active' },
    orderBy: { createdAt: 'desc' },
  })

  // This runs on every container start. A config the admin saved in Settings must survive restarts,
  // so it is only replaced when real credentials are set in the environment.
  let config
  if (existing && !hasEnvCredentials && safeDecrypt(existing.clientIdEncrypted) === defaultClientId) {
    // If the existing active config is Rclone, make sure its clientSecret and redirectUri are up to date!
    if (safeDecrypt(existing.clientSecretEncrypted) !== defaultClientSecret || existing.redirectUri !== redirectUri) {
      config = await prisma.providerConfig.update({
        where: { id: existing.id },
        data: {
          clientSecretEncrypted: encryptText(defaultClientSecret),
          redirectUri,
          scopes,
        },
      })
      console.log(`Updated active rclone Google Drive config secret and redirectUri: ${config.id}`)
    } else {
      console.log(`Rclone active global Google Drive config is up to date: ${existing.id}`)
    }
  } else if (existing && !hasEnvCredentials) {
    console.log(`Keeping active global Google Drive config: ${existing.id}`)
  } else if (existing && safeDecrypt(existing.clientIdEncrypted) === finalClientId) {
    // Same OAuth client: update in place, connected accounts keep working.
    config = await prisma.providerConfig.update({
      where: { id: existing.id },
      data: {
        clientSecretEncrypted: encryptText(finalClientSecret),
        redirectUri,
        scopes,
      },
    })
    console.log(`Updated active global Google Drive config: ${config.id}`)
  } else {
    // A different OAuth client: refresh tokens are bound to the client that issued them, so the old config
    // is kept (disabled) for the accounts connected through it instead of being overwritten.
    if (existing) await prisma.providerConfig.update({ where: { id: existing.id }, data: { status: 'disabled' } })
    config = await prisma.providerConfig.create({
      data: {
        userId: null,
        provider: 'google_drive',
        clientIdEncrypted: encryptText(finalClientId),
        clientSecretEncrypted: encryptText(finalClientSecret),
        redirectUri,
        scopes,
        status: 'active',
      },
    })
    console.log(`Seeded global Google Drive config: ${config.id}`)
  }

  // Remove disabled configs nothing uses any more. Deleting one that accounts still point to would
  // cascade-delete those accounts and all of their file records.
  await prisma.providerConfig.deleteMany({
    where: { userId: null, provider: 'google_drive', status: 'disabled', connectedAccounts: { none: {} } },
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
