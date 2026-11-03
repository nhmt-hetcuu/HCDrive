import { clearAuthSession, getAccessToken, getDeviceId, getRefreshToken, setAccessToken } from '@/lib/auth'

const isProd = import.meta.env.PROD
const rawApiUrl = import.meta.env.VITE_API_URL
export const API_URL = (rawApiUrl && rawApiUrl !== 'http://localhost:4000')
  ? rawApiUrl
  : (isProd ? '/api' : 'http://localhost:4000')

export function formatAvatarUrl(url?: string | null): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (API_URL && url.startsWith(API_URL)) return url
  if (url.startsWith('/api/')) return url
  const cleanPath = url.startsWith('/') ? url : `/${url}`
  return `${API_URL}${cleanPath}`
}


type ApiOptions = RequestInit & { skipAuth?: boolean; retry?: boolean }

async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
    body: JSON.stringify({ refreshToken }),
  })
  // Rate limited: the session is still fine, so report the error instead of signing the user out.
  if (response.status === 429) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message ?? 'Too many requests')
  }
  if (!response.ok) return false
  const data = await response.json() as { accessToken: string }
  setAccessToken(data.accessToken)
  return true
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const token = getAccessToken()
  if (!options.skipAuth && token) headers.set('Authorization', `Bearer ${token}`)
  // Login, register and Google sign-in use it to replace this browser's previous session.
  if (path.startsWith('/auth/')) headers.set('X-Device-Id', getDeviceId())
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (response.status === 401 && options.retry !== false && !options.skipAuth && await refreshAccessToken()) {
    return apiFetch<T>(path, { ...options, retry: false })
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    if (response.status === 401 && !options.skipAuth) {
      clearAuthSession()
      // The session was signed out (e.g. from another browser via Settings → Sessions): leave the app
      // instead of staying on a page whose every request now fails.
      const onPublicPage = /^\/(login|register|google-auth|google-connected|public)\b/.test(window.location.pathname)
      if (!onPublicPage) window.location.assign('/login?expired=1')
    }
    throw new Error(error.message ?? 'Request failed')
  }

  return response.json() as Promise<T>
}

export function formatBytes(input: string | number | bigint | null | undefined) {
  if (input === null || input === undefined) return '--'
  const bytes = Number(input)
  if (!Number.isFinite(bytes)) return '--'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function formatDriveDate(value: string | Date | number | null | undefined, lang: 'vi' | 'en' = 'vi'): string {
  if (!value) return '--'
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '--'

  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }

  const isThisYear = date.getFullYear() === now.getFullYear()
  const day = date.getDate()
  const month = date.getMonth() + 1
  if (lang === 'vi') {
    if (isThisYear) {
      return `${day} thg ${month}`
    }
    return `${day} thg ${month}, ${date.getFullYear()}`
  } else {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    if (isThisYear) {
      return `${monthNames[date.getMonth()]} ${day}`
    }
    return `${monthNames[date.getMonth()]} ${day}, ${date.getFullYear()}`
  }
}
