import type { Router, Response, NextFunction } from 'express'
import type { ConnectedAccount } from '@prisma/client'
import { z } from 'zod'
import type { AuthRequest } from '../../middleware/auth.middleware.js'
import { createAuditLog } from '../../utils/audit.js'
import { getAccountProxyUrl } from '../../utils/proxy.js'
import { getAuthedGoogleClient, getGoogleDriveClient } from './google.service.js'

// Sharing a file or folder on Google Drive itself (people by email, "anyone with the link"),
// next to the HCDrive public link. Mounted on both the files and the folders router.

export type DriveShareTarget = {
  entityType: 'file' | 'folder'
  entityId: string
  name: string
  account: ConnectedAccount
  providerId: string
  /** Only the owner of the storage account may change Google permissions. */
  canManage: boolean
  /** Other accounts holding a copy of a merged folder (folders only). */
  copies?: Array<{ accountId: string; email: string }>
}

export type DriveShareResolver = (req: AuthRequest) => Promise<DriveShareTarget>

const roleSchema = z.enum(['reader', 'commenter', 'writer'])
const createSchema = z.object({
  type: z.enum(['user', 'anyone']),
  role: roleSchema,
  emailAddress: z.string().trim().email().optional(),
  sendNotificationEmail: z.boolean().optional(),
  emailMessage: z.string().max(2000).optional(),
  // Access ends at this time (people only; Google needs it in the future, within a year).
  expirationTime: z.string().datetime().nullable().optional(),
}).refine((body) => body.type === 'anyone' || Boolean(body.emailAddress), { message: 'emailAddress is required to share with a person.', path: ['emailAddress'] })

const permissionFields = 'id,type,role,emailAddress,displayName,photoLink,domain,expirationTime,pendingOwner,permissionDetails(inherited,inheritedFrom)'

export function shareError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code })
}

/**
 * Turns a googleapis error into one the error middleware reports as-is (status + Google's message).
 * Google's 401 becomes 502: a 401 would make the frontend think the HCDrive session expired.
 */
export function toDriveError(error: unknown) {
  const gaxios = error as { response?: { status?: number; data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } } }; message?: string }
  if (!gaxios?.response) return error
  const status = gaxios.response.status ?? 502
  const reason = gaxios.response.data?.error?.errors?.[0]?.reason
  const message = gaxios.response.data?.error?.message || gaxios.message || 'Google Drive request failed.'
  const code = `GOOGLE_${(reason || 'API_ERROR').replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase().replace(/^_/, '')}`
  return shareError(status === 401 ? 502 : status >= 400 && status < 600 ? status : 502, code, message)
}

async function driveFor(account: ConnectedAccount) {
  return getGoogleDriveClient(await getAuthedGoogleClient(account), getAccountProxyUrl(account))
}

function serializePermission(permission: { id?: string | null; type?: string | null; role?: string | null; emailAddress?: string | null; displayName?: string | null; photoLink?: string | null; domain?: string | null; expirationTime?: string | null; pendingOwner?: boolean | null; permissionDetails?: Array<{ inherited?: boolean | null; inheritedFrom?: string | null }> | null }) {
  const inheritedDetail = permission.permissionDetails?.find((detail) => detail.inherited)
  return {
    id: permission.id ?? '',
    type: permission.type ?? '',
    role: permission.role ?? '',
    emailAddress: permission.emailAddress ?? null,
    displayName: permission.displayName ?? null,
    photoLink: permission.photoLink ?? null,
    domain: permission.domain ?? null,
    inherited: Boolean(inheritedDetail),
    inheritedFrom: inheritedDetail?.inheritedFrom ?? null,
    expirationTime: permission.expirationTime ?? null,
    pendingOwner: Boolean(permission.pendingOwner),
  }
}

async function listPermissions(target: DriveShareTarget) {
  const drive = await driveFor(target.account)
  const [meta, list] = await Promise.all([
    drive.files.get({ fileId: target.providerId, fields: 'webViewLink,copyRequiresWriterPermission,capabilities(canShare)', supportsAllDrives: true }),
    drive.permissions.list({ fileId: target.providerId, fields: `permissions(${permissionFields})`, supportsAllDrives: true }),
  ])
  return {
    name: target.name,
    accountId: target.account.id,
    accountEmail: target.account.email,
    webViewLink: meta.data.webViewLink ?? null,
    canShare: Boolean(meta.data.capabilities?.canShare) && target.canManage,
    canManage: target.canManage,
    // Viewers and commenters cannot download, print or copy.
    copyRequiresWriterPermission: Boolean(meta.data.copyRequiresWriterPermission),
    copies: target.copies ?? [],
    permissions: (list.data.permissions ?? []).map(serializePermission),
  }
}

function handle(task: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await task(req, res)
    } catch (error) {
      next(toDriveError(error))
    }
  }
}

export function mountDrivePermissionRoutes(router: Router, resolve: DriveShareResolver) {
  router.get('/:id/drive-permissions', handle(async (req, res) => {
    const target = await resolve(req)
    res.json(await listPermissions(target))
  }))

  // type 'anyone' sets the general access: an existing "anyone with the link" permission is updated, not duplicated.
  router.post('/:id/drive-permissions', handle(async (req, res) => {
    const body = createSchema.parse(req.body)
    const target = await resolve(req)
    if (!target.canManage) throw shareError(403, 'SHARE_NOT_ALLOWED', 'Only the owner of this storage account can change Google Drive sharing.')
    const drive = await driveFor(target.account)

    let permissionId: string | null = null
    if (body.type === 'anyone') {
      const existing = await drive.permissions.list({ fileId: target.providerId, fields: 'permissions(id,type)', supportsAllDrives: true })
      permissionId = existing.data.permissions?.find((permission) => permission.type === 'anyone')?.id ?? null
    }
    const permission = permissionId
      ? await drive.permissions.update({ fileId: target.providerId, permissionId, requestBody: { role: body.role }, fields: permissionFields, supportsAllDrives: true })
      : await drive.permissions.create({
        fileId: target.providerId,
        requestBody: { type: body.type, role: body.role, ...(body.type === 'user' ? { emailAddress: body.emailAddress, ...(body.expirationTime ? { expirationTime: body.expirationTime } : {}) } : {}) },
        ...(body.type === 'user' ? { sendNotificationEmail: body.sendNotificationEmail ?? true, ...(body.emailMessage ? { emailMessage: body.emailMessage } : {}) } : {}),
        fields: permissionFields,
        supportsAllDrives: true,
      })

    await createAuditLog(req.user!.id, 'DRIVE_SHARE_ADD', target.entityType, target.entityId, { type: body.type, role: body.role, emailAddress: body.emailAddress ?? null, accountId: target.account.id })
    res.status(201).json({ permission: serializePermission(permission.data) })
  }))

  router.patch('/:id/drive-permissions/:permissionId', handle(async (req, res) => {
    // expirationTime: a date sets/changes when access ends, null removes the end date.
    const body = z.object({ role: roleSchema, expirationTime: z.string().datetime().nullable().optional() }).parse(req.body)
    const target = await resolve(req)
    if (!target.canManage) throw shareError(403, 'SHARE_NOT_ALLOWED', 'Only the owner of this storage account can change Google Drive sharing.')
    const drive = await driveFor(target.account)
    const permission = await drive.permissions.update({
      fileId: target.providerId,
      permissionId: String(req.params.permissionId),
      requestBody: { role: body.role, ...(body.expirationTime ? { expirationTime: body.expirationTime } : {}) },
      ...(body.expirationTime === null ? { removeExpiration: true } : {}),
      fields: permissionFields,
      supportsAllDrives: true,
    })
    await createAuditLog(req.user!.id, 'DRIVE_SHARE_UPDATE', target.entityType, target.entityId, { permissionId: String(req.params.permissionId), role: body.role, accountId: target.account.id })
    res.json({ permission: serializePermission(permission.data) })
  }))

  // Viewers and commenters may not download, print or copy the file.
  router.patch('/:id/drive-settings', handle(async (req, res) => {
    const body = z.object({ copyRequiresWriterPermission: z.boolean() }).parse(req.body)
    const target = await resolve(req)
    if (!target.canManage) throw shareError(403, 'SHARE_NOT_ALLOWED', 'Only the owner of this storage account can change Google Drive sharing.')
    const drive = await driveFor(target.account)
    await drive.files.update({ fileId: target.providerId, requestBody: { copyRequiresWriterPermission: body.copyRequiresWriterPermission }, supportsAllDrives: true })
    await createAuditLog(req.user!.id, 'DRIVE_SHARE_SETTINGS', target.entityType, target.entityId, { copyRequiresWriterPermission: body.copyRequiresWriterPermission })
    res.json({ status: 'ok' })
  }))

  // Makes a person who already has access the owner. Personal Google accounts cannot be given
  // ownership outright: the person becomes the "pending owner" and accepts in Google Drive.
  router.post('/:id/drive-permissions/:permissionId/transfer-ownership', handle(async (req, res) => {
    const target = await resolve(req)
    if (!target.canManage) throw shareError(403, 'SHARE_NOT_ALLOWED', 'Only the owner of this storage account can change Google Drive sharing.')
    const drive = await driveFor(target.account)
    const permissionId = String(req.params.permissionId)
    let mode: 'transferred' | 'pending' = 'transferred'
    try {
      await drive.permissions.update({ fileId: target.providerId, permissionId, transferOwnership: true, requestBody: { role: 'owner' }, supportsAllDrives: true })
    } catch (error) {
      const reason = (error as { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } })?.response?.data?.error?.errors?.[0]?.reason
      if (reason !== 'consentRequiredForOwnershipTransfer' && reason !== 'invalidSharingRequest' && reason !== 'pendingOwnerWriterRequired') throw error
      await drive.permissions.update({ fileId: target.providerId, permissionId, requestBody: { role: 'writer', pendingOwner: true }, supportsAllDrives: true })
      mode = 'pending'
    }
    await createAuditLog(req.user!.id, 'DRIVE_TRANSFER_OWNERSHIP', target.entityType, target.entityId, { permissionId, mode })
    res.json({ status: 'ok', mode })
  }))

  router.delete('/:id/drive-permissions/:permissionId', handle(async (req, res) => {
    const target = await resolve(req)
    if (!target.canManage) throw shareError(403, 'SHARE_NOT_ALLOWED', 'Only the owner of this storage account can change Google Drive sharing.')
    const drive = await driveFor(target.account)
    await drive.permissions.delete({ fileId: target.providerId, permissionId: String(req.params.permissionId), supportsAllDrives: true })
    await createAuditLog(req.user!.id, 'DRIVE_SHARE_REMOVE', target.entityType, target.entityId, { permissionId: String(req.params.permissionId), accountId: target.account.id })
    res.json({ status: 'ok' })
  }))
}
