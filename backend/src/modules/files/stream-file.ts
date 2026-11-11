import type { ConnectedAccount, File } from '@prisma/client'
import type { Response } from 'express'
import { streamGoogleFile, startBackgroundCacheGoogleFile } from './stream-google-file.js'
import { streamS3File } from '../s3/s3.service.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment'; exportMimeType?: string; exportExtension?: string }

export function streamProviderFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  if (file.provider === 's3') return streamS3File(file, range, res, options)
  return streamGoogleFile(file, range, res, options)
}

export async function startBackgroundCacheFile(file: FileWithAccount, options: StreamOptions = {}) {
  if (file.provider === 'google_drive') {
    return startBackgroundCacheGoogleFile(file, options)
  }
  return null
}

