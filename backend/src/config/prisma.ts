import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

/**
 * Configure SQLite with WAL mode, busy timeout, and memory cache pragmas
 * for safe, ultra-fast concurrent multi-threaded/multi-worker operation.
 */
export async function initDatabaseConcurrency() {
  try {
    const dbUrl = process.env.DATABASE_URL || ''
    const isSqlite = !dbUrl || dbUrl.startsWith('file:')
    if (isSqlite) {
      await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;')
      await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000;')
      await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;')
      await prisma.$queryRawUnsafe('PRAGMA cache_size = -64000;')
    }
  } catch (err: any) {
    console.warn('[prisma] Concurrency pragma notice:', err?.message || err)
  }
}

