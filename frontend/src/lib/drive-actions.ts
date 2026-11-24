import { API_URL } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import type { FileItem } from '@/data/drive-data'

// Google Drive actions any page's file menu can start. The menu only dispatches an event;
// DriveFeatureHost (mounted once in App.tsx) opens the dialog and does the work, so pages do not
// each need their own copy of every dialog.

export type DriveAction = 'copy' | 'export' | 'shortcut' | 'versions' | 'comments' | 'lock' | 'temporary_edit' | 'text_edit'
export type GoogleDocKind = 'document' | 'spreadsheet' | 'presentation' | 'form'

export type DriveActionEvent =
  | { action: DriveAction; file: FileItem }
  | { action: 'new-google-doc'; kind: GoogleDocKind }

const EVENT = 'hcdrive:drive-action'

export function startDriveAction(detail: DriveActionEvent) {
  window.dispatchEvent(new CustomEvent<DriveActionEvent>(EVENT, { detail }))
}

export function onDriveAction(handler: (detail: DriveActionEvent) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<DriveActionEvent>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

/** Lists reload on these (All files listens to upload-completed, the sidebar to storage-changed). */
export function notifyFilesChanged() {
  for (const name of ['hcdrive:upload-completed', '9drive:upload-completed', 'hcdrive:storage-changed', '9drive:storage-changed']) {
    window.dispatchEvent(new Event(name))
  }
}

/** True for files whose Google Drive features apply (not S3, not a folder). */
export function isGoogleFile(file: FileItem | null | undefined) {
  if (!file?.id && !file?.providerFileId) return false
  const provider = (file.accountProvider ?? '').toLowerCase()
  return !provider.includes('s3') && file.mimeType !== 'application/vnd.google-apps.folder'
}

/** True for text, code, markdown, json, or configuration files that can be edited in HCDrive. */
export function isTextEditable(file: FileItem | null | undefined): boolean {
  if (!file?.id && !file?.providerFileId) return false
  if (file.mimeType === 'application/vnd.google-apps.folder') return false
  const mime = (file.mimeType || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('xml') ||
    mime.includes('yaml') ||
    mime.includes('markdown') ||
    mime === 'application/vnd.google-apps.document'
  ) {
    return true
  }
  const textExtensions = [
    '.txt', '.md', '.markdown', '.json', '.js', '.ts', '.jsx', '.tsx',
    '.py', '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.sh', '.bash', '.zsh', '.env', '.yaml', '.yml', '.xml', '.svg',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.java', '.go', '.rs', '.php',
    '.rb', '.sql', '.csv', '.tsv', '.ini', '.conf', '.log', '.properties'
  ]
  return textExtensions.some((ext) => name.endsWith(ext))
}

export function isGoogleDoc(file: FileItem | null | undefined) {
  return Boolean(file?.mimeType?.startsWith('application/vnd.google-apps.')) && file?.mimeType !== 'application/vnd.google-apps.shortcut'
}

export function fileKey(file: FileItem) {
  return encodeURIComponent(file.id ?? file.providerFileId ?? '')
}

function fileNameFrom(disposition: string | null, fallback: string) {
  if (!disposition) return fallback
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) return decodeURIComponent(star[1])
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? decodeURIComponent(plain[1]) : fallback
}

/** Downloads an authenticated API path to the user's disk under the server's file name. */
export async function downloadWithAuth(path: string, fallbackName: string) {
  const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message ?? 'Download failed')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileNameFrom(response.headers.get('content-disposition'), fallbackName)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
