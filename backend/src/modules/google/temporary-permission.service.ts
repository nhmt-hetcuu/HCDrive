import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ConnectedAccount, File } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from './google.service.js'
import { getAccountProxyUrl } from '../../utils/proxy.js'
import { shareError } from './drive-sharing.js'
import { createAuditLog } from '../../utils/audit.js'

export type TemporaryEditGrant = {
  id: string
  fileId: string
  providerFileId: string
  permissionId: string
  connectedAccountId: string
  userId: string
  targetEmail: string
  role: 'writer'
  duration: '1h' | '24h'
  createdAt: number
  expiresAt: number
  editUrl: string
  googleExpirationSet: boolean
}

type FileWithAccount = File & { connectedAccount: ConnectedAccount }

const GRANTS_FILE = path.join(process.cwd(), 'data', 'temporary_edit_grants.json')
let grantsMap: Map<string, TemporaryEditGrant> = new Map()
let isLoaded = false
let cleanupInterval: NodeJS.Timeout | null = null

function ensureLoaded() {
  if (isLoaded) return
  isLoaded = true
  try {
    if (fs.existsSync(GRANTS_FILE)) {
      const raw = fs.readFileSync(GRANTS_FILE, 'utf-8')
      const list: TemporaryEditGrant[] = JSON.parse(raw)
      grantsMap = new Map(list.map((g) => [g.id, g]))
    }
  } catch (err) {
    console.warn('[TemporaryPermissionService] Failed to load grants file, starting fresh:', err)
    grantsMap = new Map()
  }

  if (!cleanupInterval) {
    // Run cleanup every 2 minutes
    cleanupInterval = setInterval(() => {
      cleanupExpiredGrants().catch(() => undefined)
    }, 2 * 60 * 1000)
    // Don't keep process alive solely for this interval
    cleanupInterval.unref?.()
  }
}

function persistGrants() {
  try {
    const dir = path.dirname(GRANTS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const data = JSON.stringify(Array.from(grantsMap.values()), null, 2)
    const tmp = `${GRANTS_FILE}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, data, 'utf-8')
    fs.renameSync(tmp, GRANTS_FILE)
  } catch (err) {
    console.error('[TemporaryPermissionService] Failed to persist grants to disk:', err)
  }
}

export function getGoogleEditUrl(providerFileId: string, mimeType: string, targetEmail: string): string {
  const authUserParam = `?authuser=${encodeURIComponent(targetEmail)}`
  if (
    mimeType === 'application/vnd.google-apps.document' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    return `https://docs.google.com/document/d/${providerFileId}/edit${authUserParam}`
  }
  if (
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    return `https://docs.google.com/spreadsheets/d/${providerFileId}/edit${authUserParam}`
  }
  if (
    mimeType === 'application/vnd.google-apps.presentation' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint'
  ) {
    return `https://docs.google.com/presentation/d/${providerFileId}/edit${authUserParam}`
  }
  if (mimeType === 'application/vnd.google-apps.form') {
    return `https://docs.google.com/forms/d/${providerFileId}/edit${authUserParam}`
  }
  return `https://drive.google.com/file/d/${providerFileId}/view${authUserParam}`
}

/**
 * Periodically or on-demand checks and removes expired permissions from Google Drive
 */
export async function cleanupExpiredGrants(): Promise<number> {
  ensureLoaded()
  const now = Date.now()
  let revokedCount = 0

  const expiredList: TemporaryEditGrant[] = []
  for (const grant of grantsMap.values()) {
    if (grant.expiresAt <= now) {
      expiredList.push(grant)
    }
  }

  for (const grant of expiredList) {
    try {
      const account = await prisma.connectedAccount.findUnique({
        where: { id: grant.connectedAccountId },
      })
      if (account && account.status === 'connected') {
        const auth = await getAuthedGoogleClient(account)
        const drive = getGoogleDriveClient(auth, getAccountProxyUrl(account))
        await drive.permissions.delete({
          fileId: grant.providerFileId,
          permissionId: grant.permissionId,
          supportsAllDrives: true,
        }).catch((err: any) => {
          // 404 means already deleted or expired by Google; ignore
          if (err?.status !== 404 && err?.code !== 404) {
            console.warn(`[TemporaryPermissionService] Failed to delete permission ${grant.permissionId}:`, err?.message || err)
          }
        })
      }
      await createAuditLog(grant.userId, 'TEMPORARY_EDIT_EXPIRED', 'file', grant.fileId, {
        targetEmail: grant.targetEmail,
        permissionId: grant.permissionId,
      })
    } catch (e) {
      console.warn(`[TemporaryPermissionService] Error processing expired grant ${grant.id}:`, e)
    } finally {
      grantsMap.delete(grant.id)
      revokedCount++
    }
  }

  if (revokedCount > 0) {
    persistGrants()
  }

  return revokedCount
}

/**
 * Verifies safety rules:
 * - User must have management rights on HCDrive.
 * - The file or its parent folder MUST NOT be shared with everyone (anyone with link).
 * - The file must not be in trash or locked with read-only restrictions.
 */
export async function verifySafetyAndGetDriveClient(file: FileWithAccount, userId: string) {
  // 1. User management permission in HCDrive
  const isOwner = file.userId === userId || file.connectedAccount.userId === userId
  if (!isOwner) {
    throw shareError(403, 'PERMISSION_DENIED', 'Bạn không có quyền quản lý tệp này trên HCDrive.')
  }

  // 2. Storage account connected check
  if (file.connectedAccount.status !== 'connected' || file.provider !== 'google_drive') {
    throw shareError(400, 'UNSUPPORTED_PROVIDER', 'Chỉ tệp lưu trên Google Drive có tài khoản đang kết nối mới hỗ trợ tính năng này.')
  }

  // 3. Check HCDrive public shares for this file
  const activeShare = await prisma.fileShare.findFirst({
    where: {
      fileId: file.id,
      enabled: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })
  if (activeShare) {
    throw shareError(
      403,
      'SHARE_PUBLIC_NOT_ALLOWED',
      'Tệp này đang được chia sẻ công khai qua liên kết. Để bảo đảm an toàn dữ liệu, tính năng tự cấp quyền chỉnh sửa bị vô hiệu hoá trên tài nguyên chia sẻ công khai.'
    )
  }

  // 4. Authenticate with Google Drive
  const auth = await getAuthedGoogleClient(file.connectedAccount)
  const drive = getGoogleDriveClient(auth, getAccountProxyUrl(file.connectedAccount))

  // 5. Fetch file metadata including permissions, parents, lock restrictions
  const fileRes = await drive.files.get({
    fileId: file.providerFileId,
    fields: 'id, name, mimeType, trashed, parents, contentRestrictions, capabilities(canShare, canEdit), permissions(id, type, role, emailAddress)',
    supportsAllDrives: true,
  })
  const meta = fileRes.data

  if (meta.trashed) {
    throw shareError(400, 'FILE_TRASHED', 'Tệp này đã bị chuyển vào thùng rác trên Google Drive, không thể cấp quyền chỉnh sửa.')
  }

  // Check read-only lock
  const isLocked = meta.contentRestrictions?.some((cr) => cr.readOnly)
  if (isLocked) {
    throw shareError(403, 'FILE_LOCKED', 'Tệp đang bị khoá bảo vệ (Read-Only lock). Vui lòng mở khoá tệp trước khi thực hiện cấp quyền chỉnh sửa.')
  }

  // 6. Check if file itself is shared with everyone (type: 'anyone')
  const fileHasAnyone = (meta.permissions || []).some((p) => p.type === 'anyone')
  if (fileHasAnyone) {
    throw shareError(
      403,
      'SHARE_PUBLIC_NOT_ALLOWED',
      'Tệp này đang có quyền "Bất kỳ ai có đường liên kết" trên Google Drive. Để bảo mật dữ liệu, không cho phép tự cấp quyền chỉnh sửa cá nhân cho tệp dùng chung công khai.'
    )
  }

  // 7. Check if any parent folder is shared with everyone (Public Folder Check)
  const parents = meta.parents || []
  for (const parentId of parents) {
    if (parentId && parentId !== 'root') {
      try {
        const parentRes = await drive.files.get({
          fileId: parentId,
          fields: 'id, name, permissions(id, type, role)',
          supportsAllDrives: true,
        })
        const parentHasAnyone = (parentRes.data.permissions || []).some((p) => p.type === 'anyone')
        if (parentHasAnyone) {
          throw shareError(
            403,
            'FOLDER_SHARED_PUBLIC_NOT_ALLOWED',
            `Thư mục chứa tệp ("${parentRes.data.name || 'Thư mục cha'}") đang được chia sẻ cho mọi người ("Bất kỳ ai có đường liên kết"). Không cho phép tự cấp quyền chỉnh sửa cho tệp trong thư mục công khai.`
          )
        }
      } catch (err: any) {
        if (err?.code === 'FOLDER_SHARED_PUBLIC_NOT_ALLOWED' || err?.status === 403) {
          throw err
        }
        // If parent metadata lookup fails with not found, continue
      }
    }
  }

  return { drive, meta }
}

/**
 * Grants temporary edit permissions ('writer') for 1 hour or 24 hours.
 */
export async function grantTemporaryEdit(
  file: FileWithAccount,
  userId: string,
  targetEmail: string,
  duration: '1h' | '24h' = '1h'
) {
  ensureLoaded()
  await cleanupExpiredGrants()

  const normalizedEmail = targetEmail.trim().toLowerCase()
  const durationMs = duration === '24h' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + durationMs)
  const editUrl = getGoogleEditUrl(file.providerFileId, file.mimeType, normalizedEmail)

  // Edge case 1: Email is the storage account owner itself
  if (file.connectedAccount.email.toLowerCase() === normalizedEmail) {
    return {
      status: 'owner',
      isOwner: true,
      targetEmail: normalizedEmail,
      duration,
      expiresAt: expiresAt.toISOString(),
      remainingSeconds: Math.floor(durationMs / 1000),
      editUrl,
      message: 'Tài khoản của bạn là chủ sở hữu lưu trữ tệp này. Bạn có toàn quyền mở và chỉnh sửa trực tiếp.',
    }
  }

  // Safety checks & obtain Drive client
  const { drive, meta } = await verifySafetyAndGetDriveClient(file, userId)

  // Edge case 2: Check if email already has writer or owner permission on Google Drive
  const existingPerm = (meta.permissions || []).find(
    (p) => p.emailAddress?.toLowerCase() === normalizedEmail
  )

  let permissionId: string | null = null
  let googleExpirationSet = false

  if (existingPerm) {
    if (existingPerm.role === 'owner') {
      return {
        status: 'owner',
        isOwner: true,
        targetEmail: normalizedEmail,
        duration,
        expiresAt: expiresAt.toISOString(),
        remainingSeconds: Math.floor(durationMs / 1000),
        editUrl,
        message: 'Tài khoản này là chủ sở hữu tệp trên Google Drive. Bạn có toàn quyền chỉnh sửa trực tiếp.',
      }
    }

    if (existingPerm.role === 'writer') {
      permissionId = existingPerm.id ?? null
      // Try updating expirationTime if Workspace domain allows
      if (permissionId) {
        try {
          const updated = await drive.permissions.update({
            fileId: file.providerFileId,
            permissionId,
            requestBody: { role: 'writer', expirationTime: expiresAt.toISOString() },
            supportsAllDrives: true,
          })
          googleExpirationSet = Boolean(updated.data.expirationTime)
        } catch {
          // If Google rejects expiration date update, HCDrive handles revocation
          googleExpirationSet = false
        }
      }
    }
  }

  // If permissionId is not yet established, create new permission
  if (!permissionId) {
    try {
      // First attempt: create with expirationTime (supported on Google Workspace)
      const res = await drive.permissions.create({
        fileId: file.providerFileId,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: normalizedEmail,
          expirationTime: expiresAt.toISOString(),
        },
        sendNotificationEmail: false,
        fields: 'id, type, role, emailAddress, expirationTime',
        supportsAllDrives: true,
      })
      permissionId = res.data.id ?? null
      googleExpirationSet = Boolean(res.data.expirationTime)
    } catch (err: any) {
      const errMsg = err?.message || ''
      // Edge case 3: Personal Google accounts (@gmail.com) reject expirationTime
      if (
        errMsg.toLowerCase().includes('expiration') ||
        err?.status === 400 ||
        err?.code === 400
      ) {
        // Fallback: create normal writer permission without expirationTime, HCDrive auto-revokes
        const fallbackRes = await drive.permissions.create({
          fileId: file.providerFileId,
          requestBody: {
            type: 'user',
            role: 'writer',
            emailAddress: normalizedEmail,
          },
          sendNotificationEmail: false,
          fields: 'id, type, role, emailAddress',
          supportsAllDrives: true,
        })
        permissionId = fallbackRes.data.id ?? null
        googleExpirationSet = false
      } else {
        throw err
      }
    }
  }

  if (!permissionId) {
    throw shareError(500, 'PERMISSION_CREATION_FAILED', 'Không thể cấp quyền chỉnh sửa trên Google Drive.')
  }

  // Register grant in memory and persistent file
  const grantId = crypto.randomUUID()
  const grant: TemporaryEditGrant = {
    id: grantId,
    fileId: file.id,
    providerFileId: file.providerFileId,
    permissionId,
    connectedAccountId: file.connectedAccountId,
    userId,
    targetEmail: normalizedEmail,
    role: 'writer',
    duration,
    createdAt: Date.now(),
    expiresAt: expiresAt.getTime(),
    editUrl,
    googleExpirationSet,
  }

  // Remove any previous grant for the same email & file
  for (const [id, g] of grantsMap.entries()) {
    if (g.providerFileId === file.providerFileId && g.targetEmail === normalizedEmail) {
      grantsMap.delete(id)
    }
  }

  grantsMap.set(grantId, grant)
  persistGrants()

  await createAuditLog(userId, 'TEMPORARY_EDIT_GRANTED', 'file', file.id, {
    targetEmail: normalizedEmail,
    duration,
    expiresAt: expiresAt.toISOString(),
    googleExpirationSet,
    permissionId,
  })

  return {
    status: 'granted',
    grantId,
    targetEmail: normalizedEmail,
    duration,
    expiresAt: expiresAt.toISOString(),
    remainingSeconds: Math.floor(durationMs / 1000),
    editUrl,
    googleExpirationSet,
    message: `Đã cấp quyền chỉnh sửa trong vòng ${duration === '24h' ? '24 giờ' : '1 tiếng'}. Sau thời gian này quyền sẽ tự động thu hồi.`,
  }
}

/**
 * Returns active temporary edit grants for this file.
 */
export async function getTemporaryEditGrants(file: FileWithAccount) {
  ensureLoaded()
  await cleanupExpiredGrants()

  const now = Date.now()
  const active: Array<TemporaryEditGrant & { remainingSeconds: number }> = []

  for (const g of grantsMap.values()) {
    if (g.providerFileId === file.providerFileId && g.expiresAt > now) {
      active.push({
        ...g,
        remainingSeconds: Math.max(0, Math.floor((g.expiresAt - now) / 1000)),
      })
    }
  }

  return active
}

/**
 * Revokes a temporary edit grant early before its expiration time.
 */
export async function revokeTemporaryEdit(
  file: FileWithAccount,
  userId: string,
  targetEmail?: string,
  permissionId?: string
) {
  ensureLoaded()
  const grants = Array.from(grantsMap.values()).filter(
    (g) =>
      g.providerFileId === file.providerFileId &&
      (!targetEmail || g.targetEmail.toLowerCase() === targetEmail.trim().toLowerCase()) &&
      (!permissionId || g.permissionId === permissionId)
  )

  if (grants.length === 0 && !permissionId && !targetEmail) {
    return { status: 'no_grants', message: 'Không có quyền chỉnh sửa tạm thời nào đang hoạt động.' }
  }

  const auth = await getAuthedGoogleClient(file.connectedAccount)
  const drive = getGoogleDriveClient(auth, getAccountProxyUrl(file.connectedAccount))

  let revokedCount = 0
  for (const g of grants) {
    try {
      await drive.permissions.delete({
        fileId: file.providerFileId,
        permissionId: g.permissionId,
        supportsAllDrives: true,
      }).catch((err: any) => {
        if (err?.status !== 404 && err?.code !== 404) throw err
      })
      grantsMap.delete(g.id)
      revokedCount++
      await createAuditLog(userId, 'TEMPORARY_EDIT_MANUAL_REVOKED', 'file', file.id, {
        targetEmail: g.targetEmail,
        permissionId: g.permissionId,
      })
    } catch (e: any) {
      console.warn(`[TemporaryPermissionService] Failed to manually revoke permission ${g.permissionId}:`, e?.message || e)
    }
  }

  persistGrants()

  return {
    status: 'revoked',
    revokedCount,
    message: `Đã thu hồi thành công ${revokedCount} quyền chỉnh sửa tạm thời.`,
  }
}
