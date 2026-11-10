import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import type { ConnectedAccount } from '@prisma/client'
import { getAccountCookie } from '../google/google.service.js'

export interface ResolvedVideoStream {
  videoUrl: string
  userAgent: string
  contentType: string
  quality?: string
  title?: string
  expiresAt: number
}

// In-memory cache for resolved stream URLs (Google streaming URLs are valid for 3 hours; we cache for up to 2 hours)
const streamCache = new Map<string, ResolvedVideoStream>()
const inFlightResolutions = new Map<string, Promise<ResolvedVideoStream | null>>()

function findPythonScript(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'scripts', 'extract_gdrive_stream.py'),
    path.resolve(process.cwd(), 'backend', 'src', 'scripts', 'extract_gdrive_stream.py'),
    path.resolve(process.cwd(), 'dist', 'scripts', 'extract_gdrive_stream.py'),
    '/app/src/scripts/extract_gdrive_stream.py',
    '/app/backend/src/scripts/extract_gdrive_stream.py',
    '/mnt/data/Docker/9Drive/source/backend/src/scripts/extract_gdrive_stream.py'
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

export async function resolveGoogleVideoStream(
  account: ConnectedAccount,
  fileId: string
): Promise<ResolvedVideoStream | null> {
  // Check memory cache
  const cached = streamCache.get(fileId)
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached
  }

  // De-duplicate in-flight requests for the same fileId
  if (inFlightResolutions.has(fileId)) {
    return inFlightResolutions.get(fileId)!
  }

  const promise = (async () => {
    try {
      const cookie = await getAccountCookie(account)
      if (!cookie) return null

      const scriptPath = findPythonScript()
      if (!scriptPath) {
        console.warn('[gdrive-stream-helper] extract_gdrive_stream.py not found')
        return null
      }

      const py = spawn('python3', [scriptPath, fileId])

      let stdout = ''
      let stderr = ''

      py.stdout.on('data', (d) => {
        stdout += d.toString()
      })
      py.stderr.on('data', (d) => {
        stderr += d.toString()
      })

      // Pipe cookie via stdin safely in memory
      py.stdin.write(cookie)
      py.stdin.end()

      const exitCode = await new Promise<number>((resolve) => {
        py.on('close', resolve)
        py.on('error', (err) => {
          console.warn('[gdrive-stream-helper] python spawn error:', err)
          resolve(-1)
        })
      })

      if (exitCode !== 0) {
        console.warn(`[gdrive-stream-helper] python exited with ${exitCode}: ${stderr}`)
        return null
      }

      const trimmed = stdout.trim()
      if (!trimmed) {
        console.warn('[gdrive-stream-helper] python produced no output')
        return null
      }

      // Parse JSON from output
      let parsed: any
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        // Look for JSON object if extra logs preceded it
        const match = trimmed.match(/\{[\s\S]*\}/)
        if (match) {
          try {
            parsed = JSON.parse(match[0])
          } catch {}
        }
      }

      if (!parsed || !parsed.ok || !parsed.videoUrl) {
        console.warn('[gdrive-stream-helper] extraction failed:', parsed?.error || 'Unknown error')
        return null
      }

      const ttlSec = Number(parsed.expiresInSeconds) || 10800
      const ttlMs = Math.min(ttlSec * 1000, 2 * 3600 * 1000) // max 2 hours
      const entry: ResolvedVideoStream = {
        videoUrl: parsed.videoUrl,
        userAgent: parsed.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        contentType: parsed.contentType || 'video/mp4',
        quality: parsed.quality || '720p',
        title: parsed.title,
        expiresAt: Date.now() + ttlMs,
      }

      streamCache.set(fileId, entry)
      return entry
    } catch (err) {
      console.warn('[gdrive-stream-helper] resolve error:', err)
      return null
    } finally {
      inFlightResolutions.delete(fileId)
    }
  })()

  inFlightResolutions.set(fileId, promise)
  return promise
}
