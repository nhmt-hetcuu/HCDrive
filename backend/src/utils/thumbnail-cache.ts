// Google's thumbnail links for Drive files, picked up from the listings HCDrive already makes
// (folder reads, full sync), so showing a thumbnail rarely needs a Drive request of its own.
// The links expire after a few hours on Google's side; they are kept for 50 minutes.

const links = new Map<string, { link: string; until: number }>()
const KEEP_MS = 50 * 60_000

export function rememberThumbnailLink(driveFileId: string, link: string | null | undefined) {
  if (link) links.set(driveFileId, { link, until: Date.now() + KEEP_MS })
}

export function cachedThumbnailLink(driveFileId: string) {
  const entry = links.get(driveFileId)
  if (!entry) return null
  if (entry.until < Date.now()) {
    links.delete(driveFileId)
    return null
  }
  return entry.link
}

export function forgetThumbnailLink(driveFileId: string) {
  links.delete(driveFileId)
}
