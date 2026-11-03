export type AuthUser = {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
  status?: string
  isAdmin?: boolean
  /** Office uploads become Google Docs/Sheets/Slides (Settings → General). */
  convertUploads?: boolean
}

const ACCESS_TOKEN_KEY = 'hcdrive.accessToken'
const REFRESH_TOKEN_KEY = 'hcdrive.refreshToken'
const USER_KEY = 'hcdrive.user'

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem('9drive.accessToken')
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || localStorage.getItem('9drive.refreshToken')
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY) || localStorage.getItem('9drive.user')
  return raw ? JSON.parse(raw) as AuthUser : null
}

export function setAuthSession(accessToken: string, refreshToken: string, user: AuthUser) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hcdrive:user-updated', { detail: user }))
    window.dispatchEvent(new CustomEvent('9drive:user-updated', { detail: user }))
  }
}

export function updateStoredUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hcdrive:user-updated', { detail: user }))
    window.dispatchEvent(new CustomEvent('9drive:user-updated', { detail: user }))
  }
}

export function setAccessToken(accessToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
}

const DEVICE_ID_KEY = 'hcdrive.deviceId'

// Identifies this browser so that signing in again replaces its old session instead of adding one.
// Kept on logout. crypto.getRandomValues is used because randomUUID needs HTTPS, and HCDrive often runs on plain http on a LAN.
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY) || localStorage.getItem('9drive.deviceId')
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

export function clearAuthSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem('9drive.accessToken')
  localStorage.removeItem('9drive.refreshToken')
  localStorage.removeItem('9drive.user')
}

const RETURN_PATH_KEY = 'hcdrive.returnPath'

/** Remembers where a signed-out visitor was going; read once after sign-in. Only same-site paths. */
export function rememberReturnPath(path: string) {
  try {
    sessionStorage.setItem(RETURN_PATH_KEY, path)
  } catch {
    // storage unavailable: land on the default page
  }
}

export function takeReturnPath(fallback: string) {
  try {
    const path = sessionStorage.getItem(RETURN_PATH_KEY)
    sessionStorage.removeItem(RETURN_PATH_KEY)
    if (path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login')) return path
  } catch {
    // ignore
  }
  return fallback
}
