import { Router } from 'express'
import { exec, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { z } from 'zod'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { requireAdmin, isAdminUser } from '../../middleware/admin.middleware.js'
import { prisma } from '../../config/prisma.js'
import { decryptText, encryptText } from '../../utils/crypto.js'
import { hashPassword } from '../../utils/password.js'
import { getCustomConfig } from '../google/google.service.js'
import Busboy from 'busboy'
import { securityRouter } from './security.routes.js'
import {
  getTempCacheStats,
  setCacheTTLMinutes,
  setCacheMaxGB,
  setCacheEnabled,
  purgeAllTempCache,
} from '../../services/temp-cache.service.js'

export const systemRouter = Router()
// Everything here changes global state (OAuth config, code, database), so it is admin-only.
systemRouter.use(requireAuth, requireAdmin)
systemRouter.use('/security', securityRouter)

systemRouter.post('/update', (req, res, next) => {
  const projectRoot = path.resolve(process.cwd(), '..')
  const updateScript = path.join(projectRoot, 'update.sh')

  // Check if git is installed
  exec('git --version', (gitError) => {
    if (gitError) {
      return res.status(400).json({
        code: 'GIT_NOT_FOUND',
        message: 'Git is not installed inside the app container. Since you are running HCDrive in Docker, please update by running:\n\n1. ssh <your-server-host>\n2. cd <hcdrive-path>\n3. git pull\n4. docker compose down && docker compose up -d --build\n\ndirectly in your host terminal.'
      })
    }

    if (fs.existsSync(updateScript)) {
      try {
        // Clear old update log to prevent race conditions on frontend polling
        const logFile = path.join(projectRoot, 'update.log')
        fs.writeFileSync(logFile, 'Initiating update...\n')

        const child = spawn('bash', ['update.sh'], {
          cwd: projectRoot,
          detached: true,
          stdio: 'ignore'
        })
        child.unref()

        return res.json({
          status: 'success',
          message: 'System update initiated. Rebuilding and restarting backend & frontend in the background. Please wait ~1 minute and refresh the page.'
        })
      } catch (err: any) {
        return res.status(500).json({
          code: 'UPDATE_FAILED',
          message: 'Failed to start update script.',
          error: err.message
        })
      }
    } else {
      // Fallback to simple git pull if update.sh doesn't exist
      exec('git pull', { cwd: projectRoot }, (error, stdout, stderr) => {
        if (error) {
          console.error('System update failed:', error)
          return res.status(500).json({
            code: 'UPDATE_FAILED',
            message: 'Failed to run git pull. Make sure git is installed and configured.',
            error: error.message,
            stderr
          })
        }

        console.log('System update stdout:', stdout)
        if (stderr) {
          console.warn('System update stderr:', stderr)
        }

        return res.json({
          status: 'success',
          message: 'System code updated successfully. Dev servers will auto-restart.',
          stdout,
          stderr
        })
      })
    }
  })
})

systemRouter.get('/update-log', (req, res) => {
  const projectRoot = path.resolve(process.cwd(), '..')
  const logFile = path.join(projectRoot, 'update.log')

  if (!fs.existsSync(logFile)) {
    return res.json({
      log: 'No update history found.'
    })
  }

  try {
    const logContent = fs.readFileSync(logFile, 'utf8')
    return res.json({
      log: logContent
    })
  } catch (error: any) {
    return res.status(500).json({
      code: 'READ_LOG_FAILED',
      message: 'Failed to read update log file.',
      error: error.message
    })
  }
})

systemRouter.get('/google-config', async (req, res, next) => {
  try {
    const config = await getCustomConfig()
    const defaultRedirect = `${req.protocol}://${req.get('host')}/connected-accounts/google/callback`

    if (!config) {
      return res.json({
        exists: false,
        defaultRedirectUri: defaultRedirect
      })
    }

    let clientId = ''
    try {
      clientId = decryptText(config.clientIdEncrypted)
    } catch {
      clientId = ''
    }

    return res.json({
      exists: true,
      clientId,
      redirectUri: config.redirectUri,
      hasSecret: !!config.clientSecretEncrypted,
      defaultRedirectUri: defaultRedirect
    })
  } catch (error) {
    return next(error)
  }
})

systemRouter.post('/google-config', async (req, res, next) => {
  try {
    const { clientId, clientSecret, redirectUri } = req.body

    if (!clientId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Client ID is required.' })
    }

    const defaultRedirect = `${req.protocol}://${req.get('host')}/connected-accounts/google/callback`
    const finalRedirectUri = redirectUri || defaultRedirect

    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ]

    // Disable old custom active config only (do not disable rclone config)
    const oldCustom = await getCustomConfig()
    if (oldCustom) {
      await prisma.providerConfig.update({
        where: { id: oldCustom.id },
        data: { status: 'disabled' }
      })
    }

    // Retrieve the old config to see if we need to reuse the secret if it was not provided in the request
    let finalSecret = clientSecret
    if (!finalSecret) {
      const oldConfig = await prisma.providerConfig.findFirst({
        where: { userId: null, provider: 'google_drive', status: 'disabled' },
        orderBy: { createdAt: 'desc' }
      })
      if (oldConfig) {
        try {
          finalSecret = decryptText(oldConfig.clientSecretEncrypted)
        } catch {
          // ignore
        }
      }
    }

    if (!finalSecret) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Client Secret is required for first-time setup.' })
    }

    const config = await prisma.providerConfig.create({
      data: {
        userId: null,
        provider: 'google_drive',
        clientIdEncrypted: encryptText(clientId),
        clientSecretEncrypted: encryptText(finalSecret),
        redirectUri: finalRedirectUri,
        scopes,
        status: 'active'
      }
    })

    return res.status(201).json({
      status: 'success',
      message: 'Global Google OAuth configuration updated successfully.',
      id: config.id
    })
  } catch (error) {
    return next(error)
  }
})

systemRouter.get('/backup', async (req, res, next) => {
  try {
    // Flush any pending WAL data to the SQLite database file before reading
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => undefined)

    const dbPath = getDatabaseFilePath()
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Database file not found.' })
    }
    res.setHeader('Content-Disposition', 'attachment; filename=hcdrive-backup.db')
    res.setHeader('Content-Type', 'application/octet-stream')
    const fileStream = fs.createReadStream(dbPath)
    fileStream.pipe(res)
  } catch (error) {
    return next(error)
  }
})

systemRouter.post('/restore', (req, res, next) => {
  try {
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'multipart/form-data required.' })
    }

    const busboy = Busboy({ headers: req.headers, limits: { files: 1 } })
    let fileReceived = false

    busboy.on('file', (name, fileStream, info) => {
      fileReceived = true
      const dbPath = getDatabaseFilePath()
      const dbDir = path.dirname(dbPath)
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
      }

      const tempDbPath = dbPath + '.tmp'
      const writeStream = fs.createWriteStream(tempDbPath)

      fileStream.pipe(writeStream)

      writeStream.on('finish', async () => {
        try {
          // Refuse anything that is not an SQLite database before touching the live one.
          const header = Buffer.alloc(16)
          const fd = fs.openSync(tempDbPath, 'r')
          fs.readSync(fd, header, 0, 16, 0)
          fs.closeSync(fd)
          if (header.toString('latin1') !== 'SQLite format 3\0') {
            fs.unlinkSync(tempDbPath)
            return res.status(400).json({ code: 'INVALID_BACKUP_FILE', message: 'The uploaded file is not an HCDrive SQLite backup.' })
          }

          // Disconnect prisma client first to release database lock
          await prisma.$disconnect()

          // Remove any stale WAL/SHM files from previous database
          if (fs.existsSync(dbPath + '-wal')) try { fs.unlinkSync(dbPath + '-wal') } catch {}
          if (fs.existsSync(dbPath + '-shm')) try { fs.unlinkSync(dbPath + '-shm') } catch {}

          // Replace old database file with restored database file
          fs.renameSync(tempDbPath, dbPath)

          res.json({
            status: 'success',
            message: 'Database restored successfully. Server will restart in 2 seconds.'
          })

          // Graceful exit after response is sent (Docker with restart policy will restart backend)
          setTimeout(() => {
            console.log('Database restored. Exiting to allow container/PM2 restart.')
            process.exit(0)
          }, 2000)

        } catch (err: any) {
          if (fs.existsSync(tempDbPath)) {
            try { fs.unlinkSync(tempDbPath) } catch {}
          }
          console.error('Failed to restore database:', err)
          return res.status(500).json({
            code: 'RESTORE_FAILED',
            message: 'Failed to restore database.',
            error: err.message
          })
        }
      })

      writeStream.on('error', (err) => {
        if (fs.existsSync(tempDbPath)) {
          try { fs.unlinkSync(tempDbPath) } catch {}
        }
        console.error('Write error on temp DB:', err)
        return res.status(500).json({
          code: 'WRITE_ERROR',
          message: 'Failed to write temporary database file.',
          error: err.message
        })
      })
    })

    busboy.on('error', (err) => {
      console.error('Busboy error:', err)
      if (!res.headersSent) {
        next(err)
      }
    })

    busboy.on('finish', () => {
      if (!fileReceived && !res.headersSent) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'No file uploaded.' })
      }
    })

    req.pipe(busboy)
  } catch (error) {
    return next(error)
  }
})

function getDatabaseFilePath(): string {
  const dbUrl = process.env.DATABASE_URL || 'file:./dev.db'
  let cleanPath = dbUrl.replace(/^(sqlite|file):/, '')

  if (cleanPath.includes('?')) {
    cleanPath = cleanPath.split('?')[0]
  }

  if (path.isAbsolute(cleanPath)) {
    return cleanPath
  }

  const candidates = [
    path.resolve(process.cwd(), 'prisma', cleanPath),
    path.resolve(process.cwd(), cleanPath),
    path.resolve(process.cwd(), '..', 'prisma', cleanPath),
    path.resolve(process.cwd(), '..', 'backend', 'prisma', cleanPath),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return candidates[0]
}

// System Settings (Allow/Disallow public registration & allow/disallow user drive connect)
systemRouter.get('/settings', async (_req, res, next) => {
  try {
    const [regSetting, driveSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'allow_registration' } }),
      prisma.systemSetting.findUnique({ where: { key: 'allow_user_drive_connect' } }),
    ])
    return res.json({
      allowRegistration: regSetting ? regSetting.value !== 'false' : true,
      allowUserDriveConnect: driveSetting ? driveSetting.value === 'true' : false,
    })
  } catch (error) {
    return next(error)
  }
})

systemRouter.patch('/settings', async (req, res, next) => {
  try {
    const body = z.object({
      allowRegistration: z.boolean().optional(),
      allowUserDriveConnect: z.boolean().optional(),
    }).parse(req.body)

    if (body.allowRegistration !== undefined) {
      await prisma.systemSetting.upsert({
        where: { key: 'allow_registration' },
        create: { key: 'allow_registration', value: String(body.allowRegistration) },
        update: { value: String(body.allowRegistration) },
      })
    }
    if (body.allowUserDriveConnect !== undefined) {
      await prisma.systemSetting.upsert({
        where: { key: 'allow_user_drive_connect' },
        create: { key: 'allow_user_drive_connect', value: String(body.allowUserDriveConnect) },
        update: { value: String(body.allowUserDriveConnect) },
      })
    }

    const [regSetting, driveSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'allow_registration' } }),
      prisma.systemSetting.findUnique({ where: { key: 'allow_user_drive_connect' } }),
    ])
    return res.json({
      status: 'ok',
      allowRegistration: regSetting ? regSetting.value !== 'false' : true,
      allowUserDriveConnect: driveSetting ? driveSetting.value === 'true' : false,
    })
  } catch (error) {
    return next(error)
  }
})

// Temp Cache Management (Admin only)
systemRouter.get('/temp-cache', async (_req, res, next) => {
  try {
    return res.json(getTempCacheStats())
  } catch (error) {
    return next(error)
  }
})

systemRouter.patch('/temp-cache', async (req, res, next) => {
  try {
    const body = z.object({
      ttlMinutes: z.number().int().min(1).max(43200).optional(),
      maxGB: z.number().min(0).max(1000).optional(),
      enabled: z.boolean().optional(),
    }).parse(req.body)

    if (body.ttlMinutes !== undefined) {
      setCacheTTLMinutes(body.ttlMinutes)
      await prisma.systemSetting.upsert({
        where: { key: 'temp_cache_ttl_minutes' },
        create: { key: 'temp_cache_ttl_minutes', value: String(body.ttlMinutes) },
        update: { value: String(body.ttlMinutes) },
      })
    }

    if (body.maxGB !== undefined) {
      setCacheMaxGB(body.maxGB)
      await prisma.systemSetting.upsert({
        where: { key: 'temp_cache_max_gb' },
        create: { key: 'temp_cache_max_gb', value: String(body.maxGB) },
        update: { value: String(body.maxGB) },
      })
    }

    if (body.enabled !== undefined) {
      setCacheEnabled(body.enabled)
      await prisma.systemSetting.upsert({
        where: { key: 'temp_cache_enabled' },
        create: { key: 'temp_cache_enabled', value: String(body.enabled) },
        update: { value: String(body.enabled) },
      })
    }

    return res.json({
      status: 'ok',
      stats: getTempCacheStats(),
    })
  } catch (error) {
    return next(error)
  }
})

systemRouter.post('/temp-cache/clear', async (_req, res, next) => {
  try {
    const result = purgeAllTempCache()
    return res.json({
      status: 'ok',
      deleted: result.deleted,
      freedBytes: result.freedBytes,
      stats: getTempCacheStats(),
    })
  } catch (error) {
    return next(error)
  }
})

// User Management (Admin only)
systemRouter.get('/users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            files: true,
            connectedAccounts: true,
            folders: true,
          }
        }
      }
    })
    const usersWithAdmin = await Promise.all(users.map(async (u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      isAdmin: await isAdminUser(u.id),
    })))
    return res.json({ users: usersWithAdmin })
  } catch (error) {
    return next(error)
  }
})

const adminCreateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
})

systemRouter.post('/users', async (req, res, next) => {
  try {
    const body = adminCreateUserSchema.parse(req.body)
    const email = body.email.trim().toLowerCase()
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ code: 'USER_EXISTS', message: 'Email này đã tồn tại trong hệ thống.' })
    const passwordHash = await hashPassword(body.password)
    const user = await prisma.user.create({
      data: {
        name: body.name.trim(),
        email,
        passwordHash,
        status: 'active',
      },
      select: { id: true, name: true, email: true, status: true, createdAt: true }
    })
    return res.status(201).json({ status: 'ok', user })
  } catch (error) {
    return next(error)
  }
})

const adminUpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().trim().email('Địa chỉ email không hợp lệ').toLowerCase().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z.string().min(6).optional(),
})

systemRouter.patch('/users/:id', async (req: AuthRequest, res, next) => {
  try {
    const targetId = String(req.params.id)
    const body = adminUpdateUserSchema.parse(req.body)
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { id: targetId } })

    if (body.status === 'disabled' && targetId === req.user!.id) {
      return res.status(400).json({ code: 'CANNOT_DISABLE_SELF', message: 'Bạn không thể tự vô hiệu hoá tài khoản của chính mình.' })
    }

    if (body.email && body.email.toLowerCase() !== targetUser.email.toLowerCase()) {
      const emailConflict = await prisma.user.findFirst({
        where: {
          email: body.email.toLowerCase(),
          id: { not: targetId },
        },
      })
      if (emailConflict) {
        return res.status(409).json({ code: 'EMAIL_ALREADY_EXISTS', message: 'Email này đã được sử dụng bởi một tài khoản khác.' })
      }
    }

    let passwordHash: string | undefined
    if (body.password) {
      passwordHash = await hashPassword(body.password)
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.email ? { email: body.email.toLowerCase() } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(passwordHash ? { passwordHash, hasPassword: true } : {}),
      },
      select: { id: true, name: true, email: true, status: true, updatedAt: true }
    })

    if (body.status === 'disabled') {
      await prisma.userSession.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    }

    return res.json({ status: 'ok', user: updated })
  } catch (error) {
    return next(error)
  }
})

systemRouter.delete('/users/:id', async (req: AuthRequest, res, next) => {
  try {
    const targetId = String(req.params.id)
    if (targetId === req.user!.id) {
      return res.status(400).json({ code: 'CANNOT_DELETE_SELF', message: 'Bạn không thể tự xoá tài khoản quản trị của mình.' })
    }
    await prisma.user.delete({ where: { id: targetId } })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})
