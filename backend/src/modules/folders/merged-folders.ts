import type { drive_v3 } from 'googleapis'
import { prisma } from '../../config/prisma.js'

// My Drive shows every connected account as one tree: folders with the same name path
// (case-insensitive) in different accounts are one merged folder. Each merged folder is
// represented by its oldest member ("canonical"), and any member id resolves to the whole group.

const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'
const pathSeparator = '\u0000'

const folderSelect = {
  id: true,
  name: true,
  color: true,
  iconUrl: true,
  parentId: true,
  providerFolderId: true,
  connectedAccountId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} as const

export type FolderRow = {
  id: string
  name: string
  color: string
  iconUrl: string | null
  parentId: string | null
  providerFolderId: string | null
  connectedAccountId: string | null
  userId: string
  createdAt: Date
  updatedAt: Date
}

export function visibleFolderWhere(userId: string) {
  return { deletedAt: null, OR: [{ userId }, { connectedAccount: { isShared: true } }] }
}

export async function loadVisibleFolders(userId: string): Promise<FolderRow[]> {
  return prisma.folder.findMany({ where: visibleFolderWhere(userId), select: folderSelect })
}

function normalizeName(name: string) {
  return name.normalize('NFC').trim().toLowerCase()
}

export function buildMergedFolders(folders: FolderRow[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  // A folder whose parent is missing (deleted, or never synced) is shown at the root.
  const effectiveParentId = (folder: FolderRow) => (folder.parentId && byId.has(folder.parentId) ? folder.parentId : null)

  const keyById = new Map<string, string>()
  function keyOf(id: string): string | null {
    const cached = keyById.get(id)
    if (cached !== undefined) return cached
    const chain: FolderRow[] = []
    const seen = new Set<string>()
    let current = byId.get(id)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      chain.unshift(current)
      const parentId = effectiveParentId(current)
      current = parentId ? byId.get(parentId) : undefined
    }
    if (chain.length === 0) return null
    let key = ''
    for (const folder of chain) {
      key = key ? `${key}${pathSeparator}${normalizeName(folder.name)}` : normalizeName(folder.name)
      if (!keyById.has(folder.id)) keyById.set(folder.id, key)
    }
    return keyById.get(id) ?? key
  }

  const groups = new Map<string, FolderRow[]>()
  for (const folder of folders) {
    const key = keyOf(folder.id)
    if (key === null) continue
    const group = groups.get(key)
    if (group) group.push(folder)
    else groups.set(key, [folder])
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  }

  const parentKeyOf = (key: string) => {
    const index = key.lastIndexOf(pathSeparator)
    return index === -1 ? null : key.slice(0, index)
  }

  function toMerged(key: string): FolderRow {
    const group = groups.get(key)!
    const canonical = group[0]
    const parentKey = parentKeyOf(key)
    const updatedAt = group.reduce((latest, folder) => (folder.updatedAt > latest ? folder.updatedAt : latest), canonical.updatedAt)
    return { ...canonical, parentId: parentKey ? groups.get(parentKey)![0].id : null, updatedAt }
  }

  // Same order as Google Drive's default view: by name, numbers compared as numbers.
  const byName = (a: FolderRow, b: FolderRow) => a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })

  return {
    /** Ids of every folder merged with `id` (just `[id]` when it is unknown). */
    memberIds(id: string): string[] {
      const key = keyOf(id)
      return key === null ? [id] : groups.get(key)!.map((folder) => folder.id)
    },
    members(id: string): FolderRow[] {
      const key = keyOf(id)
      return key === null ? [] : groups.get(key)!
    },
    /** Merged children of a folder, or of the root when `parentId` is null. */
    childrenOf(parentId: string | null): FolderRow[] {
      const parentKey = parentId ? keyOf(parentId) : null
      if (parentId && parentKey === null) return []
      return [...groups.keys()].filter((key) => parentKeyOf(key) === parentKey).map(toMerged).sort(byName)
    },
    /** Every merged folder, with parentId pointing at the merged parent. */
    all(): FolderRow[] {
      return [...groups.keys()].map(toMerged).sort(byName)
    },
    /** Folder chain from the root down to `id` (inclusive). */
    pathTo(id: string): FolderRow[] {
      const chain: FolderRow[] = []
      const seen = new Set<string>()
      let current = byId.get(id)
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        chain.unshift(current)
        const parentId = effectiveParentId(current)
        current = parentId ? byId.get(parentId) : undefined
      }
      return chain
    },
    effectiveParentId,
  }
}

/**
 * Returns the folder in `accountId` that has the same name path as `folderId`, creating any
 * missing folders on Google Drive (and in the database) along the way. This is what lets a file
 * stored in account B go into a merged folder that so far only existed in account A.
 */
export async function ensureAccountFolderPath(
  userId: string,
  accountId: string,
  drive: drive_v3.Drive,
  folderId: string,
): Promise<{ folderId: string; providerFolderId: string } | null> {
  const folders = await loadVisibleFolders(userId)
  const merged = buildMergedFolders(folders)
  const target = folders.find((folder) => folder.id === folderId)
  if (!target) return null
  if (target.connectedAccountId === accountId && target.providerFolderId) {
    return { folderId: target.id, providerFolderId: target.providerFolderId }
  }

  let parentDbId: string | null = null
  let parentProviderId = 'root'
  for (const template of merged.pathTo(folderId)) {
    const name = normalizeName(template.name)
    const existing = folders.find((folder) =>
      folder.connectedAccountId === accountId &&
      folder.providerFolderId &&
      merged.effectiveParentId(folder) === parentDbId &&
      normalizeName(folder.name) === name)

    if (existing?.providerFolderId) {
      parentDbId = existing.id
      parentProviderId = existing.providerFolderId
      continue
    }

    const created = await drive.files.create({
      requestBody: {
        name: template.name,
        mimeType: googleDriveFolderMimeType,
        ...(parentProviderId !== 'root' ? { parents: [parentProviderId] } : {}),
      },
      fields: 'id',
      supportsAllDrives: true,
    })
    if (!created.data.id) throw new Error(`Google Drive did not return an id for folder "${template.name}".`)
    const folder: FolderRow = await prisma.folder.create({
      data: {
        userId,
        connectedAccountId: accountId,
        name: template.name,
        color: template.color,
        iconUrl: template.iconUrl,
        providerFolderId: created.data.id,
        parentId: parentDbId,
      },
      select: folderSelect,
    })
    folders.push(folder)
    parentDbId = folder.id
    parentProviderId = created.data.id
  }

  return parentDbId ? { folderId: parentDbId, providerFolderId: parentProviderId } : null
}

/** Moves a Google Drive item under `newParentProviderId` ('root' for My Drive root). */
export async function moveDriveItem(drive: drive_v3.Drive, providerId: string, newParentProviderId: string) {
  const current = await drive.files.get({ fileId: providerId, fields: 'parents', supportsAllDrives: true })
  const previousParents = (current.data.parents ?? []).join(',')
  await drive.files.update({
    fileId: providerId,
    addParents: newParentProviderId,
    ...(previousParents ? { removeParents: previousParents } : {}),
    fields: 'id, parents',
    supportsAllDrives: true,
  })
}
