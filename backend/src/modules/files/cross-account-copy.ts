import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import type { ConnectedAccount, File, Folder } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient, getGoogleDriveClient, ensureGoogleAppFolder, syncGoogleQuota } from '../google/google.service.js'
import { getS3ConfigForAccount, createS3Client, buildS3ObjectKey, uploadS3Object, syncS3Quota } from '../s3/s3.service.js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getAccountProxyUrl, getUndiciDispatcher } from '../../utils/proxy.js'
import { normalizeHeaders, googleDownloadExportMimeTypes } from './stream-google-file.js'
import { ensureAccountFolderPath } from '../folders/merged-folders.js'
import { fileFields, recordDriveFile, serializeFile } from '../google/drive-features.js'

export async function getFileReadableStream(file: File & { connectedAccount: ConnectedAccount }): Promise<{ stream: Readable; mimeType: string }> {
  if (file.provider === 's3') {
    const config = await getS3ConfigForAccount(file.connectedAccountId)
    const client = createS3Client(config)
    const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId }))
    if (!response.Body) throw new Error('Không thể đọc luồng tệp S3.')
    return { stream: response.Body as Readable, mimeType: file.mimeType }
  }

  // Google Drive
  const auth = await getAuthedGoogleClient(file.connectedAccount)
  const proxyUrl = getAccountProxyUrl(file.connectedAccount)
  const drive = getGoogleDriveClient(auth, proxyUrl)

  // Google Docs export check
  const exportTarget = googleDownloadExportMimeTypes[file.mimeType]
  if (exportTarget) {
    const headers = normalizeHeaders(await auth.getRequestHeaders())
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.providerFileId}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`, {
      headers,
      dispatcher: getUndiciDispatcher(proxyUrl),
    } as any)
    if (res.ok && res.body) {
      return { stream: Readable.fromWeb(res.body as any), mimeType: exportTarget.mimeType }
    }
  }

  // Standard media stream
  try {
    const res = await drive.files.get(
      { fileId: file.providerFileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    )
    if (res.data) {
      return { stream: res.data as Readable, mimeType: file.mimeType }
    }
  } catch {
    // If alt=media fails, try auth fetch
  }

  const headers = normalizeHeaders(await auth.getRequestHeaders())
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.providerFileId}?alt=media`, {
    headers,
    dispatcher: getUndiciDispatcher(proxyUrl),
  } as any)
  if (res.ok && res.body) {
    return { stream: Readable.fromWeb(res.body as any), mimeType: file.mimeType }
  }

  throw new Error(`Không thể đọc nội dung tệp "${file.name}" từ Google Drive.`)
}

export async function copySingleFile(
  userId: string,
  fileId: string,
  targetAccountId: string,
  targetFolderId?: string | null,
  newName?: string
) {
  const sourceFile = await prisma.file.findFirst({
    where: { id: fileId, userId, status: 'active' },
    include: { connectedAccount: true },
  })
  if (!sourceFile) throw Object.assign(new Error('Tệp không tồn tại.'), { status: 404, code: 'FILE_NOT_FOUND' })

  const targetAccount = await prisma.connectedAccount.findFirst({
    where: { id: targetAccountId, userId, status: 'connected' },
  })
  if (!targetAccount) throw Object.assign(new Error('Tài khoản đích không tồn tại hoặc chưa kết nối.'), { status: 400, code: 'ACCOUNT_NOT_FOUND' })

  const effectiveName = newName?.trim() || sourceFile.name

  // Target is Google Drive
  if (targetAccount.provider === 'google_drive') {
    const targetAuth = await getAuthedGoogleClient(targetAccount)
    const targetProxy = getAccountProxyUrl(targetAccount)
    const targetDrive = getGoogleDriveClient(targetAuth, targetProxy)

    let targetParentId = await ensureGoogleAppFolder(targetAccount)
    let dbFolderId: string | null = null

    if (targetFolderId) {
      const placement = await ensureAccountFolderPath(userId, targetAccount.id, targetDrive, targetFolderId)
      if (placement) {
        targetParentId = placement.providerFolderId
        dbFolderId = placement.folderId
      }
    }

    // Fast copy if same Google account
    if (sourceFile.provider === 'google_drive' && sourceFile.connectedAccountId === targetAccount.id) {
      try {
        const copied = await targetDrive.files.copy({
          fileId: sourceFile.providerFileId,
          requestBody: { name: effectiveName, parents: [targetParentId] },
          fields: fileFields,
          supportsAllDrives: true,
        })
        const newFile = await recordDriveFile(userId, targetAccount, dbFolderId, copied.data)
        syncGoogleQuota(targetAccount.id).catch(() => undefined)
        return serializeFile(newFile)
      } catch {
        // Fall back to stream below if copy is blocked or fails
      }
    }

    // Stream from source into target Google Drive
    const { stream, mimeType } = await getFileReadableStream(sourceFile)
    const created = await targetDrive.files.create({
      requestBody: { name: effectiveName, parents: [targetParentId] },
      media: { mimeType, body: stream },
      fields: fileFields,
      supportsAllDrives: true,
    })
    const newFile = await recordDriveFile(userId, targetAccount, dbFolderId, created.data)
    syncGoogleQuota(targetAccount.id).catch(() => undefined)
    return serializeFile(newFile)
  }

  // Target is S3
  if (targetAccount.provider === 's3') {
    const config = await getS3ConfigForAccount(targetAccount.id)
    const { stream, mimeType } = await getFileReadableStream(sourceFile)
    const s3Key = buildS3ObjectKey(config, userId, randomUUID(), effectiveName)
    await uploadS3Object(config, s3Key, stream, mimeType)

    const newFile = await prisma.file.create({
      data: {
        userId,
        connectedAccountId: targetAccount.id,
        folderId: targetFolderId ?? null,
        provider: 's3',
        providerFileId: s3Key,
        name: effectiveName,
        mimeType,
        sizeBytes: sourceFile.sizeBytes,
        status: 'active',
      },
    })
    syncS3Quota(targetAccount.id).catch(() => undefined)
    return serializeFile(newFile)
  }

  throw new Error(`Nhà cung cấp lưu trữ "${targetAccount.provider}" không được hỗ trợ.`)
}

export async function copyFolderRecursively(
  userId: string,
  sourceFolderId: string,
  targetAccountId: string,
  targetParentFolderId?: string | null,
  newName?: string
): Promise<{ folder: Folder; copiedFiles: number; copiedFolders: number }> {
  const sourceFolder = await prisma.folder.findFirst({
    where: { id: sourceFolderId, userId, deletedAt: null },
  })
  if (!sourceFolder) throw Object.assign(new Error('Thư mục không tồn tại.'), { status: 404, code: 'FOLDER_NOT_FOUND' })

  const targetAccount = await prisma.connectedAccount.findFirst({
    where: { id: targetAccountId, userId, status: 'connected' },
  })
  if (!targetAccount) throw Object.assign(new Error('Tài khoản đích không tồn tại hoặc chưa kết nối.'), { status: 400, code: 'ACCOUNT_NOT_FOUND' })

  const folderName = newName?.trim() || sourceFolder.name

  // 1. Create target folder
  let targetDbFolder: Folder
  if (targetAccount.provider === 'google_drive') {
    const auth = await getAuthedGoogleClient(targetAccount)
    const proxy = getAccountProxyUrl(targetAccount)
    const drive = getGoogleDriveClient(auth, proxy)

    let parentGoogleId = await ensureGoogleAppFolder(targetAccount)
    if (targetParentFolderId) {
      const placement = await ensureAccountFolderPath(userId, targetAccount.id, drive, targetParentFolderId)
      if (placement) parentGoogleId = placement.providerFolderId
    }

    const createdDriveFolder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentGoogleId],
      },
      fields: 'id',
      supportsAllDrives: true,
    })

    targetDbFolder = await prisma.folder.create({
      data: {
        userId,
        connectedAccountId: targetAccount.id,
        parentId: targetParentFolderId ?? null,
        provider: 'google_drive',
        providerFolderId: createdDriveFolder.data.id ?? null,
        name: folderName,
        color: sourceFolder.color,
        iconUrl: sourceFolder.iconUrl,
      },
    })
  } else {
    // S3 or other
    targetDbFolder = await prisma.folder.create({
      data: {
        userId,
        connectedAccountId: targetAccount.id,
        parentId: targetParentFolderId ?? null,
        provider: 's3',
        name: folderName,
        color: sourceFolder.color,
        iconUrl: sourceFolder.iconUrl,
      },
    })
  }

  let copiedFiles = 0
  let copiedFolders = 1

  // 2. Copy direct files inside sourceFolder
  const files = await prisma.file.findMany({
    where: { folderId: sourceFolder.id, userId, status: 'active' },
  })

  for (const file of files) {
    try {
      await copySingleFile(userId, file.id, targetAccount.id, targetDbFolder.id)
      copiedFiles += 1
    } catch (err) {
      console.error(`Lỗi khi chép tệp ${file.name} sang tài khoản ${targetAccount.email}:`, err)
    }
  }

  // 3. Copy subfolders recursively
  const subfolders = await prisma.folder.findMany({
    where: { parentId: sourceFolder.id, userId, deletedAt: null },
  })

  for (const sub of subfolders) {
    try {
      const subResult = await copyFolderRecursively(userId, sub.id, targetAccount.id, targetDbFolder.id)
      copiedFiles += subResult.copiedFiles
      copiedFolders += subResult.copiedFolders
    } catch (err) {
      console.error(`Lỗi khi chép thư mục con ${sub.name}:`, err)
    }
  }

  return { folder: targetDbFolder, copiedFiles, copiedFolders }
}
