import { useEffect, useState, useRef, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  SlidersHorizontal,
  User,
  Cloud,
  KeyRound,
  Users,
  History,
  Cpu,
  RefreshCw,
  HardDrive,
  Plus,
  Clipboard,
  ShieldCheck,
  Camera,
  ExternalLink,
  Monitor,
  Smartphone,
  Code2,
  Database,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { apiFetch, formatAvatarUrl, formatDate, formatBytes, API_URL } from '@/lib/api'
import { SecuritySettings } from '@/components/settings/SecuritySettings'
import { getStoredUser, updateStoredUser, getAccessToken, clearAuthSession, type AuthUser } from '@/lib/auth'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { saveTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

type SettingsTab = 'general' | 'profile' | 'google' | 'security' | 'api' | 'users' | 'activity' | 'system'

type TempCacheStats = {
  totalBytes: number
  fileCount: number
  cacheDir: string
  ttlMinutes: number
  maxGB: number
  enabled: boolean
}

type ApiKey = {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  status: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

type ManagedUser = {
  id: string
  name: string
  email: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
  isAdmin: boolean
  _count: {
    files: number
    connectedAccounts: number
    folders: number
  }
}

type AuditLog = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  metadata: string | any | null
  createdAt: string
}

export function SettingsPage() {
  const { lang, setLang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const vi = lang === 'vi'

  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as SettingsTab) || 'general'
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)

  const [user, setUser] = useState<AuthUser | null>(getStoredUser)

  // Sync tab with URL search parameter ?tab=
  function switchTab(tab: SettingsTab) {
    setActiveTab(tab)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('tab', tab)
      return next
    })
  }

  useEffect(() => {
    const tab = searchParams.get('tab') as SettingsTab
    if (tab && tab !== activeTab) {
      setActiveTab(tab)
    }
  }, [searchParams])

  // ================= 1. GENERAL TAB STATES =================
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('hcdrive:theme') as Theme) || (localStorage.getItem('9drive:theme') as Theme) || 'system'
    } catch {
      return 'system'
    }
  })
  const [defaultViewMode, setDefaultViewMode] = useState<'list' | 'grid'>(() => {
    try {
      return (localStorage.getItem('hcdrive:default-view') as 'list' | 'grid') || (localStorage.getItem('9drive:default-view') as 'list' | 'grid') || 'list'
    } catch {
      return 'list'
    }
  })
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    try {
      return (localStorage.getItem('hcdrive:density') as 'comfortable' | 'compact') || (localStorage.getItem('9drive:density') as 'comfortable' | 'compact') || 'comfortable'
    } catch {
      return 'comfortable'
    }
  })

  function handleThemeChange(val: Theme) {
    setCurrentTheme(val)
    saveTheme(val)
    showSnackbar(vi ? `Đã đổi giao diện: ${val}` : `Theme updated: ${val}`)
  }

  function handleViewModeChange(val: 'list' | 'grid') {
    setDefaultViewMode(val)
    try {
      localStorage.setItem('hcdrive:default-view', val)
      localStorage.setItem('9drive:default-view', val)
    } catch {}
    showSnackbar(vi ? `Kiểu xem mặc định: ${val === 'list' ? 'Danh sách' : 'Lưới'}` : `Default view: ${val}`)
  }

  function handleDensityChange(val: 'comfortable' | 'compact') {
    setDensity(val)
    try {
      localStorage.setItem('hcdrive:density', val)
      localStorage.setItem('9drive:density', val)
    } catch {}
    showSnackbar(vi ? `Mật độ: ${val === 'comfortable' ? 'Thoải mái' : 'Gọn gàng'}` : `Density: ${val}`)
  }

  // ================= 2. PROFILE TAB STATES =================
  const [profileName, setProfileName] = useState(user?.name ?? '')
  const [profileEmail, setProfileEmail] = useState(user?.email ?? '')
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(user?.avatarUrl ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault()
    const cleanEmail = profileEmail.trim().toLowerCase()
    if (!cleanEmail) {
      showSnackbar(vi ? 'Vui lòng nhập địa chỉ email!' : 'Email is required!')
      return
    }
    const emailChanged = cleanEmail !== (user?.email ?? '').toLowerCase()
    if (emailChanged && user?.hasPassword && !currentPassword) {
      showSnackbar(vi ? 'Vui lòng nhập mật khẩu hiện tại bên dưới để đổi địa chỉ email!' : 'Please enter your current password below to change email!')
      return
    }
    if (newPassword && newPassword !== confirmPassword) {
      showSnackbar(vi ? 'Mật khẩu xác nhận không khớp!' : 'Passwords do not match!')
      return
    }
    setSavingProfile(true)
    try {
      const res = await apiFetch<{ user: AuthUser }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: profileName.trim(),
          email: cleanEmail,
          avatarUrl: profileAvatarUrl.trim() || null,
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
        }),
      })
      setUser(res.user)
      updateStoredUser(res.user)
      setProfileEmail(res.user.email)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showSnackbar(vi ? 'Đã lưu thông tin tài khoản thành công!' : 'Profile saved successfully!')
    } catch (err: any) {
      showSnackbar(err.message || (vi ? 'Lỗi khi cập nhật hồ sơ' : 'Error updating profile'))
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]
    setUploadingAvatar(true)
    try {
      const token = getAccessToken()
      const formData = new FormData()
      formData.append('avatar', file)
      const res = await fetch(`${API_URL}/auth/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Upload avatar error')
      setUser(data.user)
      updateStoredUser(data.user)
      setProfileAvatarUrl(data.avatarUrl)
      showSnackbar(vi ? 'Đã tải lên ảnh đại diện mới!' : 'Avatar uploaded!')
    } catch (err: any) {
      showSnackbar(err.message || (vi ? 'Lỗi tải ảnh' : 'Upload error'))
    } finally {
      setUploadingAvatar(false)
      if (e.target) e.target.value = ''
    }
  }

  async function handleRemoveAvatar() {
    setUploadingAvatar(true)
    try {
      const data = await apiFetch<{ user: AuthUser }>('/auth/avatar', { method: 'DELETE' })
      setUser(data.user)
      updateStoredUser(data.user)
      setProfileAvatarUrl('')
      showSnackbar(vi ? 'Đã xoá ảnh đại diện!' : 'Removed avatar!')
    } catch (err: any) {
      showSnackbar(err.message || (vi ? 'Lỗi khi xoá ảnh đại diện' : 'Error removing avatar'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  useEffect(() => {
    function onUserUpdated(e: Event) {
      const updatedUser = (e as CustomEvent<AuthUser>).detail || getStoredUser()
      if (updatedUser) {
        setUser(updatedUser)
        setProfileName(updatedUser.name ?? '')
        setProfileEmail(updatedUser.email ?? '')
        setProfileAvatarUrl(updatedUser.avatarUrl ?? '')
      }
    }
    window.addEventListener('9drive:user-updated', onUserUpdated)
    window.addEventListener('hcdrive:user-updated', onUserUpdated)
    return () => {
      window.removeEventListener('9drive:user-updated', onUserUpdated)
      window.removeEventListener('hcdrive:user-updated', onUserUpdated)
    }
  }, [])

  useEffect(() => {
    if (user) {
      setProfileName(user.name ?? '')
      setProfileEmail(user.email ?? '')
      setProfileAvatarUrl(user.avatarUrl ?? '')
    }
  }, [user?.email, user?.name, user?.avatarUrl])

  // ================= 3. GOOGLE OAUTH TAB STATES =================
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [googleRedirectUri, setGoogleRedirectUri] = useState('')
  const [defaultRedirectUri, setDefaultRedirectUri] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [savingGoogleConfig, setSavingGoogleConfig] = useState(false)
  const [showGoogleHelp, setShowGoogleHelp] = useState(false)

  async function loadGoogleConfig() {
    try {
      const data = await apiFetch<{
        exists: boolean
        clientId: string
        redirectUri: string
        hasSecret: boolean
        defaultRedirectUri: string
      }>('/system/google-config')
      if (data.exists) {
        setGoogleClientId(data.clientId || '')
        setGoogleRedirectUri(data.redirectUri || '')
        setHasSecret(data.hasSecret || false)
      }
      setDefaultRedirectUri(data.defaultRedirectUri || '')
    } catch {}
  }

  async function handleSaveGoogleConfig(e: FormEvent) {
    e.preventDefault()
    setSavingGoogleConfig(true)
    try {
      const res = await apiFetch<{ message: string }>('/system/google-config', {
        method: 'POST',
        body: JSON.stringify({
          clientId: googleClientId,
          clientSecret: googleClientSecret || undefined,
          redirectUri: googleRedirectUri || defaultRedirectUri,
        }),
      })
      showSnackbar(res.message || (vi ? 'Đã lưu cấu hình Google OAuth' : 'Google OAuth saved'))
      setHasSecret(true)
      setGoogleClientSecret('')
    } catch (err: any) {
      showSnackbar(err.message || (vi ? 'Lỗi lưu Google OAuth' : 'Failed to save Google OAuth'))
    } finally {
      setSavingGoogleConfig(false)
    }
  }

  // ================= 4. API KEYS TAB STATES =================
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [createdSecret, setCreatedSecret] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)

  // Signed-in browsers/devices (Settings → My account), with sign-out for each one or all others.
  type LoginSession = { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; lastActiveAt: string; current: boolean }
  const [sessions, setSessions] = useState<LoginSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
  const [confirmRevokeOthers, setConfirmRevokeOthers] = useState(false)

  async function loadSessions() {
    setLoadingSessions(true)
    try {
      const data = await apiFetch<{ sessions: LoginSession[] }>('/auth/sessions')
      setSessions(data.sessions)
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không tải được danh sách phiên' : 'Could not load sessions')
    } finally {
      setLoadingSessions(false)
    }
  }

  async function revokeSession(id: string) {
    setRevokingSessionId(id)
    try {
      await apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' })
      showSnackbar(vi ? 'Đã đăng xuất thiết bị đó' : 'Signed that device out')
      await loadSessions()
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không đăng xuất được' : 'Could not sign out')
    } finally {
      setRevokingSessionId(null)
    }
  }

  async function revokeOtherSessions() {
    setConfirmRevokeOthers(false)
    try {
      const data = await apiFetch<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' })
      showSnackbar(vi ? `Đã đăng xuất ${data.revoked} thiết bị khác` : `Signed out ${data.revoked} other device(s)`)
      await loadSessions()
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không đăng xuất được' : 'Could not sign out')
    }
  }

  async function saveConvertUploads(value: boolean) {
    try {
      const data = await apiFetch<{ user: AuthUser }>('/auth/me', { method: 'PATCH', body: JSON.stringify({ convertUploads: value }) })
      setUser(data.user)
      updateStoredUser(data.user)
      showSnackbar(value ? (vi ? 'Tệp Office tải lên sẽ được chuyển sang định dạng Google' : 'Office uploads will be converted') : (vi ? 'Tệp tải lên giữ nguyên định dạng' : 'Uploads keep their format'))
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không lưu được' : 'Could not save')
    }
  }

  // Google accounts that can sign in to this account (Settings → My account → Sign in with Google).
  type LoginIdentity = { id: string; email: string; displayName: string | null; avatarUrl: string | null; createdAt: string; lastLoginAt: string | null; isAccountEmail: boolean; canUnlink: boolean }
  const [identities, setIdentities] = useState<LoginIdentity[]>([])
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [unlinkingIdentityId, setUnlinkingIdentityId] = useState<string | null>(null)
  const handledLinkToken = useRef<string | null>(null)

  async function loadIdentities() {
    try {
      const data = await apiFetch<{ identities: LoginIdentity[] }>('/auth/identities')
      setIdentities(data.identities)
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không tải được liên kết Google' : 'Could not load linked Google accounts')
    }
  }

  async function linkGoogle() {
    setLinkingGoogle(true)
    try {
      const data = await apiFetch<{ url: string }>('/auth/google/link-url')
      window.location.href = data.url
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không mở được trang Google' : 'Could not open Google')
      setLinkingGoogle(false)
    }
  }

  async function unlinkIdentity(id: string) {
    setUnlinkingIdentityId(id)
    try {
      await apiFetch(`/auth/identities/${id}`, { method: 'DELETE' })
      showSnackbar(vi ? 'Đã gỡ liên kết Google' : 'Google account unlinked')
      await loadIdentities()
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : vi ? 'Không gỡ được liên kết' : 'Could not unlink')
    } finally {
      setUnlinkingIdentityId(null)
    }
  }

  // Back from Google: the callback parks the account and hands over a one-time token, which only
  // links once this signed-in user confirms it here.
  useEffect(() => {
    const token = searchParams.get('googleLinkToken')
    const failed = searchParams.get('googleLink') === 'error'
    if (!token && !failed) return
    const dropParams = () => setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('googleLinkToken')
      next.delete('googleLink')
      return next
    }, { replace: true })
    if (failed) {
      showSnackbar(vi ? 'Liên kết Google không thành công' : 'Linking Google failed')
      dropParams()
      return
    }
    if (handledLinkToken.current === token) return
    handledLinkToken.current = token
    apiFetch<{ email: string }>('/auth/google/link/confirm', { method: 'POST', body: JSON.stringify({ token }) })
      .then((data) => showSnackbar(vi ? `Đã liên kết ${data.email}. Từ giờ có thể đăng nhập bằng Google.` : `Linked ${data.email}. You can now sign in with Google.`))
      .catch((err) => showSnackbar(err instanceof Error ? err.message : vi ? 'Liên kết Google không thành công' : 'Linking Google failed'))
      .finally(() => {
        dropParams()
        loadIdentities()
      })
  }, [searchParams])

  // "Chrome trên Windows" from a user-agent string; good enough to recognise your own devices.
  function describeDevice(userAgent: string | null) {
    const ua = userAgent ?? ''
    const browser = /Edg\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /coc_coc|CocCoc/i.test(ua) ? 'Cốc Cốc'
      : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari'
      : /curl|python|node|axios/i.test(ua) ? (vi ? 'Ứng dụng/script' : 'App/script')
      : (vi ? 'Trình duyệt không rõ' : 'Unknown browser')
    const os = /Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux'
      : ''
    return { label: os ? `${browser} ${vi ? 'trên' : 'on'} ${os}` : browser, mobile: /Android|iPhone|iPad|Mobile/.test(ua) }
  }

  // The external upload endpoint, as an absolute URL (API_URL is "/api" in the Docker build).
  const uploadApiUrl = `${API_URL.startsWith('/') ? window.location.origin : ''}${API_URL}/v1/uploads`
  const curlExample = `curl -X POST "${uploadApiUrl}" \\
  -H "Authorization: Bearer 9d_live_xxx" \\
  -F 'filesMeta=[{"fieldName":"file-0","fileName":"hello.txt","mimeType":"text/plain","sizeBytes":"12"}]' \\
  -F "file-0=@hello.txt;type=text/plain"`

  function copyText(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => showSnackbar(vi ? 'Đã sao chép' : 'Copied'))
      .catch(() => showSnackbar(vi ? 'Không sao chép được' : 'Could not copy'))
  }

  async function loadApiKeys() {
    try {
      const data = await apiFetch<{ apiKeys: ApiKey[] }>('/api-keys')
      setApiKeys(data.apiKeys)
    } catch {}
  }

  async function handleCreateKey(e: FormEvent) {
    e.preventDefault()
    setCreatingKey(true)
    try {
      const data = await apiFetch<{ apiKey: ApiKey; secret: string }>('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: keyName }),
      })
      setCreatedSecret(data.secret)
      setKeyName('')
      setCreateKeyOpen(false)
      await loadApiKeys()
      showSnackbar(vi ? 'Đã tạo khoá API mới!' : 'API key created!')
    } catch (err: any) {
      showSnackbar(err.message || (vi ? 'Lỗi tạo khoá API' : 'Failed to create API key'))
    } finally {
      setCreatingKey(false)
    }
  }

  async function handleRevokeKey(id: string) {
    try {
      await apiFetch(`/api-keys/${id}`, { method: 'DELETE' })
      await loadApiKeys()
      showSnackbar(vi ? 'Đã thu hồi khoá API' : 'API key revoked')
    } catch (err: any) {
      showSnackbar(err.message || (vi ? 'Lỗi thu hồi khoá' : 'Failed to revoke key'))
    }
  }

  // ================= 5. USERS TAB STATES =================
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [allowRegistration, setAllowRegistration] = useState(true)
  const [allowUserDriveConnect, setAllowUserDriveConnect] = useState(false)
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addingUser, setAddingUser] = useState(false)

  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [savingEditUser, setSavingEditUser] = useState(false)

  function openEditUser(u: ManagedUser) {
    setEditingUser(u)
    setEditName(u.name)
    setEditEmail(u.email)
    setEditPassword('')
  }

  async function handleEditUser(e: FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    setSavingEditUser(true)
    try {
      await apiFetch(`/system/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          email: editEmail.trim().toLowerCase(),
          password: editPassword.trim() || undefined,
        }),
      })
      setEditingUser(null)
      showSnackbar(vi ? 'Đã cập nhật thông tin người dùng!' : 'User updated!')
      await loadUsersData()
    } catch (err: any) {
      showSnackbar(err.message || (vi ? 'Lỗi cập nhật người dùng' : 'Error updating user'))
    } finally {
      setSavingEditUser(false)
    }
  }

  async function loadUsersData() {
    if (!user?.isAdmin) return
    try {
      const [usersData, settingsData] = await Promise.all([
        apiFetch<{ users: ManagedUser[] }>('/system/users'),
        apiFetch<{ allowRegistration: boolean; allowUserDriveConnect?: boolean }>('/system/settings'),
      ])
      setUsers(usersData.users)
      setAllowRegistration(settingsData.allowRegistration)
      setAllowUserDriveConnect(Boolean(settingsData.allowUserDriveConnect))
    } catch {}
  }

  async function toggleRegistration() {
    try {
      const next = !allowRegistration
      const res = await apiFetch<{ allowRegistration: boolean }>('/system/settings', {
        method: 'PATCH',
        body: JSON.stringify({ allowRegistration: next }),
      })
      setAllowRegistration(res.allowRegistration)
      showSnackbar(
        res.allowRegistration
          ? vi ? 'Đã bật đăng ký tự do' : 'Public registration enabled'
          : vi ? 'Đã tắt đăng ký tự do' : 'Public registration disabled'
      )
    } catch (err: any) {
      showSnackbar(err.message || 'Error')
    }
  }

  async function toggleUserDrive() {
    try {
      const next = !allowUserDriveConnect
      const res = await apiFetch<{ allowUserDriveConnect: boolean }>('/system/settings', {
        method: 'PATCH',
        body: JSON.stringify({ allowUserDriveConnect: next }),
      })
      setAllowUserDriveConnect(res.allowUserDriveConnect)
      showSnackbar(
        res.allowUserDriveConnect
          ? vi ? 'Cho phép thành viên kết nối Drive riêng' : 'Allowed member drive connect'
          : vi ? 'Khoá: Chỉ dùng Drive của Admin' : 'Locked to shared admin drive'
      )
    } catch (err: any) {
      showSnackbar(err.message || 'Error')
    }
  }

  async function handleAddUser(e: FormEvent) {
    e.preventDefault()
    setAddingUser(true)
    try {
      await apiFetch('/system/users', {
        method: 'POST',
        body: JSON.stringify({ name: addName, email: addEmail, password: addPassword }),
      })
      setAddUserOpen(false)
      setAddName('')
      setAddEmail('')
      setAddPassword('')
      showSnackbar(vi ? 'Đã tạo tài khoản người dùng!' : 'User created!')
      await loadUsersData()
    } catch (err: any) {
      showSnackbar(err.message || 'Error creating user')
    } finally {
      setAddingUser(false)
    }
  }

  async function toggleUserStatus(u: ManagedUser) {
    const nextStatus = u.status === 'active' ? 'disabled' : 'active'
    if (u.isAdmin && nextStatus === 'disabled') {
      showSnackbar(vi ? 'Không thể khoá tài khoản Quản trị viên!' : 'Cannot disable Admin account!')
      return
    }
    try {
      await apiFetch(`/system/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      await loadUsersData()
      showSnackbar(vi ? `Đã cập nhật trạng thái: ${u.email}` : `Updated status for ${u.email}`)
    } catch (err: any) {
      showSnackbar(err.message || 'Error')
    }
  }

  // ================= 6. ACTIVITY LOG TAB STATES =================
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  async function loadLogs() {
    setLoadingLogs(true)
    try {
      const data = await apiFetch<{ logs: AuditLog[] }>('/audit-logs')
      setLogs(data.logs)
    } catch {} finally {
      setLoadingLogs(false)
    }
  }

  // ================= 7. SYSTEM TAB STATES =================
  const [updatingSystem, setUpdatingSystem] = useState(false)
  const [updateLogOpen, setUpdateLogOpen] = useState(false)
  const [updateLog, setUpdateLog] = useState('')
  const [updateFinished, setUpdateFinished] = useState(false)
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null)
  const [isPollingLog, setIsPollingLog] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const [downloadingBackup, setDownloadingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)

  async function downloadBackup() {
    setDownloadingBackup(true)
    try {
      const token = getAccessToken()
      const res = await fetch(`${API_URL}/system/backup`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to download backup')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'hcdrive-backup.db'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      showSnackbar(vi ? 'Đã tải xuống bản sao lưu database!' : 'Database backup downloaded!')
    } catch (err: any) {
      showSnackbar(err.message || 'Backup failed')
    } finally {
      setDownloadingBackup(false)
    }
  }

  async function restoreBackup() {
    if (!restoreFile) return
    setRestoringBackup(true)
    try {
      const token = getAccessToken()
      const formData = new FormData()
      formData.append('file', restoreFile)
      const res = await fetch(`${API_URL}/system/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to restore')
      showSnackbar(vi ? 'Khôi phục database thành công! Đang tải lại...' : 'Database restored! Reloading...')
      setTimeout(() => {
        clearAuthSession()
        window.location.href = '/login'
      }, 3000)
    } catch (err: any) {
      showSnackbar(err.message || 'Restore failed')
    } finally {
      setRestoringBackup(false)
    }
  }

  async function runSystemUpdate() {
    setUpdatingSystem(true)
    setUpdateLog('Initiating system update from GitHub repository...\n')
    setUpdateFinished(false)
    setUpdateSuccess(null)
    setUpdateLogOpen(true)
    try {
      await apiFetch<{ message: string }>('/system/update', { method: 'POST' })
      setIsPollingLog(true)
    } catch (err: any) {
      setUpdateLog((prev) => prev + `\nError: ${err.message}`)
      setUpdateFinished(true)
      setUpdateSuccess(false)
    } finally {
      setUpdatingSystem(false)
    }
  }

  useEffect(() => {
    if (!isPollingLog) return
    let active = true
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch<{ log: string }>('/system/update-log')
        if (!active) return
        setUpdateLog(data.log)
        if (data.log.includes('=== System Update Completed:')) {
          setUpdateFinished(true)
          setUpdateSuccess(true)
          setIsPollingLog(false)
        }
      } catch {}
    }, 2000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [isPollingLog])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [updateLog])

  // ================= 8. TEMP CACHE STATES =================
  const [tempCacheStats, setTempCacheStats] = useState<TempCacheStats | null>(null)
  const [loadingTempCache, setLoadingTempCache] = useState(false)
  const [savingTempCache, setSavingTempCache] = useState(false)
  const [clearingTempCache, setClearingTempCache] = useState(false)
  const [tempCacheTtl, setTempCacheTtl] = useState(30)
  const [isCustomTtl, setIsCustomTtl] = useState(false)
  const [tempCacheMaxGb, setTempCacheMaxGb] = useState(10)
  const [tempCacheEnabled, setTempCacheEnabled] = useState(true)

  async function loadTempCache() {
    setLoadingTempCache(true)
    try {
      const res = await apiFetch<TempCacheStats>('/system/temp-cache')
      setTempCacheStats(res)
      setTempCacheTtl(res.ttlMinutes)
      setIsCustomTtl(![0, 10, 15, 30, 60, 120, 360, 1440].includes(res.ttlMinutes))
      setTempCacheMaxGb(res.maxGB)
      setTempCacheEnabled(res.enabled)
    } catch (err) {
      console.error('Failed to load temp cache stats:', err)
    } finally {
      setLoadingTempCache(false)
    }
  }

  async function handleSaveTempCache(patch?: { ttlMinutes?: number; maxGB?: number; enabled?: boolean }) {
    setSavingTempCache(true)
    try {
      const payload = patch ?? {
        ttlMinutes: Number(tempCacheTtl),
        maxGB: Number(tempCacheMaxGb),
        enabled: tempCacheEnabled,
      }
      const res = await apiFetch<{ status: string; stats: TempCacheStats }>('/system/temp-cache', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setTempCacheStats(res.stats)
      setTempCacheTtl(res.stats.ttlMinutes)
      setIsCustomTtl(![0, 10, 15, 30, 60, 120, 360, 1440].includes(res.stats.ttlMinutes))
      setTempCacheMaxGb(res.stats.maxGB)
      setTempCacheEnabled(res.stats.enabled)
      showSnackbar(vi ? 'Đã lưu cấu hình bộ nhớ đệm thành công!' : 'Temp cache settings saved successfully!')
    } catch (err) {
      showSnackbar(vi ? 'Không lưu được cấu hình bộ nhớ đệm!' : 'Failed to save temp cache settings!')
    } finally {
      setSavingTempCache(false)
    }
  }

  async function handleClearTempCache() {
    if (!window.confirm(vi ? 'Bạn có chắc chắn muốn xóa toàn bộ tệp trong bộ nhớ đệm tạm thời không?' : 'Are you sure you want to delete all temporary cache files?')) {
      return
    }
    setClearingTempCache(true)
    try {
      const res = await apiFetch<{ status: string; deleted: number; freedBytes: number; stats: TempCacheStats }>('/system/temp-cache/clear', {
        method: 'POST',
      })
      setTempCacheStats(res.stats)
      showSnackbar(
        vi
          ? `Đã xóa ${res.deleted} tệp, giải phóng ${formatBytes(res.freedBytes)}!`
          : `Cleared ${res.deleted} files, freed ${formatBytes(res.freedBytes)}!`
      )
    } catch (err) {
      showSnackbar(vi ? 'Không xóa được bộ nhớ đệm!' : 'Failed to clear temp cache!')
    } finally {
      setClearingTempCache(false)
    }
  }

  // Initial tab-dependent data loaders
  useEffect(() => {
    if (activeTab === 'google' && user?.isAdmin) loadGoogleConfig()
    if (activeTab === 'profile') {
      loadSessions()
      loadIdentities()
    }
    if (activeTab === 'api') loadApiKeys()
    if (activeTab === 'users' && user?.isAdmin) loadUsersData()
    if (activeTab === 'activity') loadLogs()
    if (activeTab === 'system' && user?.isAdmin) loadTempCache()
  }, [activeTab, user?.isAdmin])

  // Navigation tab definitions according to Section 3.9
  const tabItems: { key: SettingsTab; label: string; icon: any; adminOnly?: boolean }[] = [
    { key: 'general', label: vi ? 'Chung' : 'General', icon: SlidersHorizontal },
    { key: 'profile', label: vi ? 'Tài khoản của tôi' : 'My Account', icon: User },
    { key: 'google', label: 'Google OAuth', icon: Cloud, adminOnly: true },
    { key: 'security', label: vi ? 'Bảo mật' : 'Security', icon: ShieldCheck, adminOnly: true },
    { key: 'api', label: vi ? 'Khoá API' : 'API Keys', icon: KeyRound },
    { key: 'users', label: vi ? 'Người dùng' : 'Users', icon: Users, adminOnly: true },
    { key: 'activity', label: vi ? 'Hoạt động' : 'Activity', icon: History },
    { key: 'system', label: vi ? 'Hệ thống' : 'System', icon: Cpu, adminOnly: true },
  ]

  const visibleTabs = tabItems.filter((t) => !t.adminOnly || user?.isAdmin)
  const navigate = useNavigate()

  return (
    <div className="flex-1 flex flex-col min-h-0 select-none">
      {/* Page Title */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200/80 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-normal text-slate-900 dark:text-white tracking-tight">
            {vi ? 'Cài đặt' : 'Settings'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {vi ? 'Tuỳ chỉnh ứng dụng và quản trị hệ thống HCDrive' : 'Manage app preferences and system configurations'}
          </p>
        </div>
      </div>

      {/* Main Container: Vertical Pill Tabs Left + Row-based Content Right (Section 3.9) */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 mt-4 gap-6">
        {/* Left Navigation: Vertical Pill List */}
        <div className="w-full md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0">
          {visibleTabs.map((item) => {
            const isActive = activeTab === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => switchTab(item.key)}
                className={cn(
                  'flex items-center gap-3 px-4 h-10 rounded-full text-xs font-medium transition cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'bg-[#c2e7ff] text-[#001d35] dark:bg-[#004a77] dark:text-[#c2e7ff] font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#282a2c]'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0 opacity-80" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>

        {/* Right Content Area: Row-based Layout (Left label 200px, Right controls) */}
        <div className="flex-1 min-w-0 overflow-y-auto pr-1">
          {/* 1. GENERAL TAB */}
          {activeTab === 'general' && (
            <div className="divide-y divide-slate-200/80 dark:divide-slate-800 text-xs">
              {/* Language */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Ngôn ngữ' : 'Language'}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={lang}
                    onChange={(e) => setLang(e.target.value as 'vi' | 'en')}
                    className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none"
                  >
                    <option value="vi" className="dark:bg-[#1f1f1f]">Tiếng Việt</option>
                    <option value="en" className="dark:bg-[#1f1f1f]">English (United States)</option>
                  </select>
                </div>
              </div>

              {/* Convert Office uploads to Google formats */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Chuyển đổi tệp tải lên' : 'Convert uploads'}
                </div>
                <label className="flex flex-1 items-start gap-2 text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(user?.convertUploads)}
                    onChange={(e) => saveConvertUploads(e.target.checked)}
                  />
                  {vi
                    ? 'Chuyển tệp Word, Excel, PowerPoint, CSV tải lên Google Drive thành Google Tài liệu, Trang tính, Trang trình bày (sửa được trên Google, không chiếm dung lượng như tệp gốc).'
                    : 'Turn uploaded Word, Excel, PowerPoint and CSV files into Google Docs, Sheets and Slides.'}
                </label>
              </div>

              {/* Theme */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Giao diện' : 'Appearance'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(['light', 'dark', 'system'] as Theme[]).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={currentTheme === mode ? 'filled' : 'outline'}
                      size="sm"
                      onClick={() => handleThemeChange(mode)}
                      className="rounded-full text-xs h-8 px-4"
                    >
                      {mode === 'light' ? (vi ? 'Sáng' : 'Light') : mode === 'dark' ? (vi ? 'Tối' : 'Dark') : (vi ? 'Theo hệ thống' : 'System')}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Default View Mode */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Kiểu xem mặc định' : 'Default view'}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={defaultViewMode === 'list' ? 'filled' : 'outline'}
                    size="sm"
                    onClick={() => handleViewModeChange('list')}
                    className="rounded-full text-xs h-8 px-4"
                  >
                    {vi ? 'Danh sách' : 'List'}
                  </Button>
                  <Button
                    type="button"
                    variant={defaultViewMode === 'grid' ? 'filled' : 'outline'}
                    size="sm"
                    onClick={() => handleViewModeChange('grid')}
                    className="rounded-full text-xs h-8 px-4"
                  >
                    {vi ? 'Lưới biểu tượng' : 'Grid'}
                  </Button>
                </div>
              </div>

              {/* Density */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Mật độ hiển thị' : 'Display density'}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={density === 'comfortable' ? 'filled' : 'outline'}
                    size="sm"
                    onClick={() => handleDensityChange('comfortable')}
                    className="rounded-full text-xs h-8 px-4"
                  >
                    {vi ? 'Thoải mái (Chuẩn)' : 'Comfortable'}
                  </Button>
                  <Button
                    type="button"
                    variant={density === 'compact' ? 'filled' : 'outline'}
                    size="sm"
                    onClick={() => handleDensityChange('compact')}
                    className="rounded-full text-xs h-8 px-4"
                  >
                    {vi ? 'Gọn gàng' : 'Compact'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 2. PROFILE TAB */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="divide-y divide-slate-200/80 dark:divide-slate-800 text-xs">
              {/* Avatar Row */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Ảnh đại diện' : 'Profile photo'}
                </div>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full overflow-hidden border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    {profileAvatarUrl ? (
                      <img src={formatAvatarUrl(profileAvatarUrl)} alt="Avatar" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xl font-bold text-slate-600 dark:text-slate-300">
                        {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingAvatar}
                      onClick={() => avatarInputRef.current?.click()}
                      className="rounded-full h-8 px-4 text-xs font-medium"
                    >
                      <Camera className="h-3.5 w-3.5 mr-1" />
                      {uploadingAvatar ? (vi ? 'Đang tải...' : 'Uploading...') : (vi ? 'Đổi ảnh đại diện' : 'Change photo')}
                    </Button>
                    {profileAvatarUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={uploadingAvatar}
                        onClick={handleRemoveAvatar}
                        className="rounded-full h-8 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        {vi ? 'Xoá ảnh' : 'Remove'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Full Name */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Họ và tên' : 'Full name'}
                </div>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="max-w-md w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                  required
                />
              </div>

              {/* Email Address */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200 pt-2">
                  {vi ? 'Địa chỉ email' : 'Email address'}
                  <p className="text-[11px] text-slate-400 font-normal mt-0.5">
                    {vi ? 'Dùng để đăng nhập hoặc nhận thông báo' : 'Used to sign in and receive notifications'}
                  </p>
                </div>
                <div className="max-w-md w-full">
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                    required
                  />
                  {profileEmail.trim().toLowerCase() !== (user?.email ?? '').toLowerCase() && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1 font-medium">
                      <span>⚠️</span>
                      {vi ? 'Vui lòng nhập mật khẩu hiện tại bên dưới để lưu email mới' : 'Please enter current password below to save new email'}
                    </p>
                  )}
                </div>
              </div>

              {/* Change Password */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200 pt-2">
                  {vi ? 'Đổi mật khẩu' : 'Change password'}
                  <p className="text-[11px] text-slate-400 font-normal mt-0.5">
                    {vi ? 'Bỏ trống nếu không muốn đổi' : 'Leave blank to keep current'}
                  </p>
                </div>
                <div className="max-w-md w-full space-y-3">
                  <input
                    type="password"
                    placeholder={vi ? 'Mật khẩu hiện tại' : 'Current password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                  />
                  <input
                    type="password"
                    placeholder={vi ? 'Mật khẩu mới (tối thiểu 8 ký tự)' : 'New password (min 8 chars)'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                  />
                  <input
                    type="password"
                    placeholder={vi ? 'Xác nhận mật khẩu mới' : 'Confirm new password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                  />
                </div>
              </div>

              {/* Save Button */}
              <div className="py-4 flex justify-end">
                <Button
                  variant="filled"
                  type="submit"
                  disabled={savingProfile}
                  className="rounded-full px-6 h-9 text-xs"
                >
                  {savingProfile ? (vi ? 'Đang lưu...' : 'Saving...') : (vi ? 'Lưu thay đổi' : 'Save Changes')}
                </Button>
              </div>
            </form>
          )}

          {activeTab === 'profile' && (
            <div className="mt-6 text-xs">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-medium text-sm text-slate-900 dark:text-white">{vi ? 'Đăng nhập bằng Google' : 'Sign in with Google'}</h3>
                  <p className="text-slate-500 mt-0.5">
                    {vi
                      ? 'Liên kết một tài khoản Google để đăng nhập bằng nút "Đăng nhập bằng Google", vẫn giữ email và mật khẩu hiện tại. Bước liên kết chỉ đọc tên và email Google; khi đăng nhập bằng Google, Drive của tài khoản đó được kết nối vào kho lưu trữ như trước giờ.'
                      : 'Link a Google account to use the "Sign in with Google" button; your email and password keep working. Linking only reads the Google name and email; signing in with Google connects that Drive as storage, as it always has.'}
                  </p>
                </div>
                <Button variant="outline" size="sm" type="button" className="rounded-full text-xs gap-2" disabled={linkingGoogle} onClick={linkGoogle}>
                  <GoogleLogo className="h-3.5 w-3.5" />
                  {linkingGoogle ? (vi ? 'Đang chuyển hướng...' : 'Redirecting...') : (vi ? 'Liên kết tài khoản Google' : 'Link Google account')}
                </Button>
              </div>
              {identities.length === 0 ? (
                <p className="py-4 text-slate-400">{vi ? 'Chưa liên kết tài khoản Google nào.' : 'No Google account linked yet.'}</p>
              ) : (
                <ul className="divide-y divide-slate-200/80 dark:divide-slate-800">
                  {identities.map((identity) => (
                    <li key={identity.id} className="flex items-center gap-3 py-3">
                      {identity.avatarUrl ? (
                        <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-7 w-7 shrink-0 rounded-full" />
                      ) : (
                        <GoogleLogo className="h-5 w-5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-800 dark:text-slate-200">
                          {identity.email}
                          {identity.isAccountEmail ? <span className="ml-2 rounded-full bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">{vi ? 'Trùng email tài khoản' : 'Account email'}</span> : null}
                        </p>
                        <p className="truncate text-slate-500">
                          {identity.displayName ? `${identity.displayName} · ` : ''}
                          {vi ? 'Liên kết ' : 'Linked '}{formatDate(identity.createdAt)}
                          {identity.lastLoginAt ? ` · ${vi ? 'Đăng nhập gần nhất ' : 'Last sign-in '}${formatDate(identity.lastLoginAt)}` : ''}
                        </p>
                      </div>
                      {identity.canUnlink ? (
                        <Button
                          variant="text"
                          size="sm"
                          type="button"
                          disabled={unlinkingIdentityId === identity.id}
                          onClick={() => unlinkIdentity(identity.id)}
                          className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
                          {unlinkingIdentityId === identity.id ? (vi ? 'Đang gỡ...' : 'Unlinking...') : (vi ? 'Gỡ liên kết' : 'Unlink')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="mt-6 text-xs">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-medium text-sm text-slate-900 dark:text-white">{vi ? 'Thiết bị đang đăng nhập' : 'Signed-in devices'}</h3>
                  <p className="text-slate-500 mt-0.5">
                    {vi
                      ? 'Đăng xuất một trình duyệt bạn không nhận ra. Thiết bị đó bị thoát ngay ở thao tác kế tiếp. Đổi mật khẩu cũng đăng xuất mọi thiết bị khác.'
                      : 'Sign out a browser you do not recognise; it is logged out on its next action. Changing your password also signs out every other device.'}
                  </p>
                </div>
                {sessions.some((session) => !session.current) ? (
                  <Button variant="outline" size="sm" type="button" className="rounded-full text-xs text-red-600 dark:text-red-400" onClick={() => setConfirmRevokeOthers(true)}>
                    {vi ? 'Đăng xuất mọi thiết bị khác' : 'Sign out all other devices'}
                  </Button>
                ) : null}
              </div>
              {loadingSessions && sessions.length === 0 ? (
                <p className="py-4 text-slate-400">{vi ? 'Đang tải...' : 'Loading...'}</p>
              ) : (
                <ul className="divide-y divide-slate-200/80 dark:divide-slate-800">
                  {sessions.map((session) => {
                    const device = describeDevice(session.userAgent)
                    const Icon = device.mobile ? Smartphone : Monitor
                    return (
                      <li key={session.id} className="flex items-center gap-3 py-3">
                        <Icon className="h-5 w-5 shrink-0 text-slate-500" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-800 dark:text-slate-200">
                            {device.label}
                            {session.current ? <span className="ml-2 rounded-full bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">{vi ? 'Thiết bị này' : 'This device'}</span> : null}
                          </p>
                          <p
                            className="truncate text-slate-500"
                            title={`${vi ? 'Đăng nhập' : 'Signed in'} ${formatDate(session.createdAt)}\n${session.userAgent ?? ''}`}
                          >
                            {/* IPv4 addresses arrive IPv6-mapped (::ffff:10.0.0.50). */}
                            {session.ipAddress ? `${session.ipAddress.replace(/^::ffff:/, '')} · ` : ''}
                            {session.current
                              ? (vi ? 'Đang hoạt động' : 'Active now')
                              : `${vi ? 'Hoạt động lần cuối ' : 'Last active '}${formatDate(session.lastActiveAt)}`}
                          </p>
                        </div>
                        {session.current ? null : (
                          <Button
                            variant="text"
                            size="sm"
                            type="button"
                            disabled={revokingSessionId === session.id}
                            onClick={() => revokeSession(session.id)}
                            className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
                          >
                            {revokingSessionId === session.id ? (vi ? 'Đang đăng xuất...' : 'Signing out...') : (vi ? 'Đăng xuất' : 'Sign out')}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              <DummyModal
                open={confirmRevokeOthers}
                title={vi ? 'Đăng xuất mọi thiết bị khác?' : 'Sign out all other devices?'}
                description={vi ? 'Mọi trình duyệt khác đang đăng nhập tài khoản này sẽ phải đăng nhập lại. Thiết bị này vẫn giữ đăng nhập.' : 'Every other browser signed in to this account will have to sign in again. This device stays signed in.'}
                onClose={() => setConfirmRevokeOthers(false)}
              >
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="text" type="button" onClick={() => setConfirmRevokeOthers(false)}>{vi ? 'Huỷ' : 'Cancel'}</Button>
                  <Button variant="danger" type="button" onClick={revokeOtherSessions}>{vi ? 'Đăng xuất' : 'Sign out'}</Button>
                </div>
              </DummyModal>
            </div>
          )}

          {/* 3. GOOGLE OAUTH TAB */}
          {activeTab === 'google' && user?.isAdmin && (
            <form onSubmit={handleSaveGoogleConfig} className="divide-y divide-slate-200/80 dark:divide-slate-800 text-xs">
              <div className="py-2 flex items-center justify-between">
                <p className="text-slate-600 dark:text-slate-400">
                  {vi ? 'Cấu hình client OAuth 2.0 toàn hệ thống để kết nối tài khoản Google Drive' : 'Configure global Google OAuth 2.0 Client credentials'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGoogleHelp(!showGoogleHelp)}
                  className="rounded-full text-xs h-8 px-3"
                >
                  {showGoogleHelp ? (vi ? 'Ẩn hướng dẫn' : 'Hide Guide') : (vi ? 'Hướng dẫn tạo credentials' : 'Setup Guide')}
                </Button>
              </div>

              {showGoogleHelp && (
                <div className="py-3 text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">Các bước thiết lập Google Cloud:</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Mở <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-[#0b57d0] dark:text-[#a8c7fa] underline inline-flex items-center gap-0.5">Google Cloud Console <ExternalLink className="h-3 w-3" /></a></li>
                    <li>Bật API <strong>Google Drive API</strong> trong phần APIs & Services.</li>
                    <li>Tạo OAuth Client ID kiểu <strong>Web Application</strong>.</li>
                    <li>Điền Authorized Redirect URI: <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded">{googleRedirectUri || defaultRedirectUri}</code></li>
                    <li>Sao chép Client ID và Client Secret vào form bên dưới.</li>
                  </ol>
                </div>
              )}

              {/* Client ID */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  Google Client ID
                </div>
                <input
                  type="text"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="xxxx.apps.googleusercontent.com"
                  required
                  className="max-w-md w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                />
              </div>

              {/* Client Secret */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  Google Client Secret
                  {hasSecret && <span className="block text-[11px] text-emerald-600 font-normal">{vi ? '(Đã cấu hình)' : '(Configured)'}</span>}
                </div>
                <input
                  type="password"
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  placeholder={hasSecret ? '••••••••••••••••••••••••' : 'Enter client secret'}
                  required={!hasSecret}
                  className="max-w-md w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                />
              </div>

              {/* Redirect URI */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  Redirect URI
                </div>
                <input
                  type="text"
                  value={googleRedirectUri}
                  onChange={(e) => setGoogleRedirectUri(e.target.value)}
                  placeholder={defaultRedirectUri}
                  className="max-w-md w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
                />
              </div>

              <div className="py-4 flex justify-end">
                <Button
                  variant="filled"
                  type="submit"
                  disabled={savingGoogleConfig}
                  className="rounded-full px-6 h-9 text-xs"
                >
                  {savingGoogleConfig ? (vi ? 'Đang lưu...' : 'Saving...') : (vi ? 'Lưu cấu hình' : 'Save Google Credentials')}
                </Button>
              </div>
            </form>
          )}

          {/* 4. API KEYS TAB */}
          {activeTab === 'security' && user?.isAdmin && <SecuritySettings vi={vi} />}

          {activeTab === 'api' && (
            <div className="space-y-6 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-sm text-slate-900 dark:text-white">
                    {vi ? 'Danh sách khoá API' : 'API Keys'}
                  </h3>
                  <p className="text-slate-500 mt-0.5">
                    {vi ? 'Cho phép ứng dụng bên ngoài upload và truy xuất tệp qua HCDrive API' : 'Allow external scripts and tools to upload and access files via API'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/api-docs')}
                    className="rounded-full h-8 px-3.5 text-xs gap-1.5 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  >
                    <Code2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    {vi ? 'Tài liệu API đầy đủ' : 'Interactive API Docs'}
                  </Button>
                  <Button
                    variant="filled"
                    size="sm"
                    onClick={() => setCreateKeyOpen(true)}
                    className="rounded-full h-8 px-4 text-xs gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {vi ? 'Tạo khoá mới' : 'Create API Key'}
                  </Button>
                </div>
              </div>

              {createdSecret && (
                <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 text-blue-900 dark:text-blue-200 font-semibold mb-1">
                    <ShieldCheck className="h-4 w-4 text-[#0b57d0]" />
                    <span>{vi ? 'Lưu khoá API của bạn' : 'Copy your API key'}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 mb-3 text-[11px]">
                    {vi ? 'Khoá này chỉ hiển thị duy nhất một lần. Hãy sao chép và cất giữ an toàn.' : 'This key will only be shown once. Please copy and store it securely.'}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white dark:bg-black/40 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-900 font-mono text-xs select-all overflow-x-auto">
                      {createdSecret}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(createdSecret)
                        showSnackbar(vi ? 'Đã sao chép khoá API!' : 'Copied!')
                      }}
                      className="rounded-full h-8 px-3 text-xs"
                    >
                      <Clipboard className="h-3.5 w-3.5 mr-1" />
                      {vi ? 'Sao chép' : 'Copy'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Table of Keys */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#1f1f1f] border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4">{vi ? 'Tên khoá' : 'Name'}</th>
                      <th className="py-2.5 px-4">{vi ? 'Tiền tố' : 'Prefix'}</th>
                      <th className="py-2.5 px-4">{vi ? 'Quyền hạn' : 'Scopes'}</th>
                      <th className="py-2.5 px-4">{vi ? 'Ngày tạo' : 'Created'}</th>
                      <th className="py-2.5 px-4">{vi ? 'Dùng lần cuối' : 'Last Used'}</th>
                      <th className="py-2.5 px-4 text-right">{vi ? 'Thao tác' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {apiKeys.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400">
                          {vi ? 'Chưa có khoá API nào' : 'No API keys found'}
                        </td>
                      </tr>
                    ) : (
                      apiKeys.map((key) => (
                        <tr key={key.id} className="hover:bg-slate-50/60 dark:hover:bg-[#282a2c]/50">
                          <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">{key.name}</td>
                          <td className="py-3 px-4 font-mono text-slate-500">{key.keyPrefix}...</td>
                          <td className="py-3 px-4 text-slate-500">{key.scopes.join(', ')}</td>
                          <td className="py-3 px-4 text-slate-500">{formatDate(key.createdAt)}</td>
                          <td className="py-3 px-4 text-slate-500">{key.lastUsedAt ? formatDate(key.lastUsedAt) : '—'}</td>
                          <td className="py-3 px-4 text-right">
                            {key.status === 'active' ? (
                              <Button
                                variant="text"
                                size="sm"
                                onClick={() => handleRevokeKey(key.id)}
                                className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
                              >
                                {vi ? 'Thu hồi' : 'Revoke'}
                              </Button>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">{vi ? 'Đã thu hồi' : 'Revoked'}</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* How to call the upload API with a key (was on the old API page). */}
              <div className="space-y-2">
                <h3 className="font-medium text-sm text-slate-900 dark:text-white">{vi ? 'Cách gọi API tải lên' : 'Calling the upload API'}</h3>
                <p className="text-slate-500">
                  {vi
                    ? 'Gửi multipart/form-data: trường filesMeta (JSON mô tả từng tệp) rồi tới các trường tệp có tên khớp fieldName. Khoá cần quyền files:upload.'
                    : 'Send multipart/form-data: a filesMeta field (JSON describing each file), then file fields named after fieldName. The key needs the files:upload scope.'}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 overflow-x-auto rounded-lg bg-slate-100 dark:bg-[#282a2c] px-3 py-2 text-[11px] text-slate-800 dark:text-slate-200">POST {uploadApiUrl}</code>
                  <Button variant="outline" size="sm" type="button" onClick={() => copyText(uploadApiUrl)}>{vi ? 'Sao chép' : 'Copy'}</Button>
                </div>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg bg-slate-100 dark:bg-[#282a2c] p-3 text-[11px] leading-relaxed text-slate-800 dark:text-slate-200">{curlExample}</pre>
                  <Button variant="text" size="sm" type="button" className="absolute right-2 top-2 h-7 text-[11px]" onClick={() => copyText(curlExample)}>{vi ? 'Sao chép' : 'Copy'}</Button>
                </div>
              </div>
            </div>
          )}

          {/* 5. USERS TAB */}
          {activeTab === 'users' && user?.isAdmin && (
            <div className="space-y-6 text-xs">
              {/* Toggles Row */}
              <div className="divide-y divide-slate-200/80 dark:divide-slate-800">
                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-white">
                      {vi ? 'Cho phép người dùng tự do đăng ký' : 'Public Registration'}
                    </h4>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      {vi ? 'Bật để khách có thể tạo tài khoản trên trang đăng ký' : 'Allow new guests to register accounts'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={allowRegistration ? 'filled' : 'outline'}
                    size="sm"
                    onClick={toggleRegistration}
                    className="rounded-full h-8 px-4 text-xs"
                  >
                    {allowRegistration ? (vi ? 'Đang Bật' : 'Enabled') : (vi ? 'Đang Tắt' : 'Disabled')}
                  </Button>
                </div>

                <div className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-white">
                      {vi ? 'Cho phép thành viên kết nối Google Drive riêng' : 'Allow Member Custom Drive'}
                    </h4>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      {vi ? 'Nếu tắt, mọi người dùng sẽ tự động dùng chung kho lưu trữ của Admin (Nextcloud mode)' : 'If disabled, users share the master storage pool configured by Admin'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={allowUserDriveConnect ? 'filled' : 'outline'}
                    size="sm"
                    onClick={toggleUserDrive}
                    className="rounded-full h-8 px-4 text-xs"
                  >
                    {allowUserDriveConnect ? (vi ? 'Cho phép' : 'Allowed') : (vi ? 'Khoá dùng chung' : 'Shared Pool Only')}
                  </Button>
                </div>
              </div>

              {/* Users Table Header */}
              <div className="flex items-center justify-between pt-2">
                <h3 className="font-medium text-sm text-slate-900 dark:text-white">
                  {vi ? 'Danh sách người dùng hệ thống' : 'System Users'}
                </h3>
                <Button
                  variant="filled"
                  size="sm"
                  onClick={() => setAddUserOpen(true)}
                  className="rounded-full h-8 px-4 text-xs gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {vi ? 'Thêm người dùng' : 'Add User'}
                </Button>
              </div>

              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#1f1f1f] border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4">{vi ? 'Người dùng' : 'User'}</th>
                      <th className="py-2.5 px-4">{vi ? 'Vai trò' : 'Role'}</th>
                      <th className="py-2.5 px-4">{vi ? 'Trạng thái' : 'Status'}</th>
                      <th className="py-2.5 px-4">{vi ? 'Ngày tham gia' : 'Joined'}</th>
                      <th className="py-2.5 px-4 text-right">{vi ? 'Thao tác' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/60 dark:hover:bg-[#282a2c]/50">
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900 dark:text-white">{u.name}</p>
                          <p className="text-slate-500 text-[11px]">{u.email}</p>
                        </td>
                        <td className="py-3 px-4">
                          {u.isAdmin ? (
                            <span className="font-semibold text-[#0b57d0] dark:text-[#a8c7fa]">Admin</span>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400">{vi ? 'Thành viên' : 'Member'}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                            u.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                          )}>
                            {u.status === 'active' ? (vi ? 'Hoạt động' : 'Active') : (vi ? 'Đã khoá' : 'Disabled')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500">{formatDate(u.createdAt)}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="text"
                              size="sm"
                              onClick={() => openEditUser(u)}
                              className="h-7 text-xs text-[#0b57d0] dark:text-[#a8c7fa]"
                            >
                              {vi ? 'Sửa' : 'Edit'}
                            </Button>
                            <Button
                              variant="text"
                              size="sm"
                              disabled={u.isAdmin}
                              onClick={() => toggleUserStatus(u)}
                              className="h-7 text-xs"
                            >
                              {u.status === 'active' ? (vi ? 'Khoá' : 'Disable') : (vi ? 'Mở khoá' : 'Enable')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. ACTIVITY LOG TAB */}
          {activeTab === 'activity' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between pb-2">
                <h3 className="font-medium text-sm text-slate-900 dark:text-white">
                  {vi ? 'Nhật ký hoạt động' : 'Activity Logs'}
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadLogs}
                  disabled={loadingLogs}
                  className="rounded-full h-8 px-3 text-xs"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loadingLogs && 'animate-spin')} />
                  {vi ? 'Làm mới' : 'Refresh'}
                </Button>
              </div>

              {logs.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  {loadingLogs ? (vi ? 'Đang tải nhật ký...' : 'Loading logs...') : (vi ? 'Chưa có hoạt động nào được ghi lại' : 'No activity recorded yet')}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {logs.map((log) => (
                    <div key={log.id} className="py-3 flex items-start gap-3">
                      <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 mt-0.5">
                        <History className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white">
                          <span className="font-semibold text-[#0b57d0] dark:text-[#a8c7fa]">{log.action}</span>
                          {' '}{log.entityType}{log.entityId ? ` (${log.entityId})` : ''}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(log.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 7. SYSTEM TAB */}
          {activeTab === 'system' && user?.isAdmin && (
            <div className="divide-y divide-slate-200/80 dark:divide-slate-800 text-xs">
              {/* System Info */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="sm:w-56 shrink-0 font-medium text-slate-800 dark:text-slate-200">
                  {vi ? 'Thông tin phiên bản' : 'System Version'}
                </div>
                <div className="space-y-1 text-slate-600 dark:text-slate-400">
                  <p>HCDrive Cloud Storage Gateway v2024</p>
                  <p>Google Drive 2024 (Material You / M3) Architecture</p>
                  <p className="font-mono text-[11px]">Database: MySQL 8.4 / SQLite Compatible</p>
                </div>
              </div>

              {/* System Update */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="font-medium text-slate-900 dark:text-white">
                    {vi ? 'Cập nhật mã nguồn hệ thống' : 'System Code Update'}
                  </h4>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    {vi ? 'Kéo mã nguồn mới nhất từ GitHub repo và khởi động lại dịch vụ ngầm' : 'Pull latest git commits and restart backend containers in background'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runSystemUpdate}
                  disabled={updatingSystem}
                  className="rounded-full h-8 px-4 text-xs gap-1.5"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', updatingSystem && 'animate-spin')} />
                  {updatingSystem ? (vi ? 'Đang cập nhật...' : 'Updating...') : (vi ? 'Cập nhật ngay' : 'Update Now')}
                </Button>
              </div>

              {/* Database Backup & Restore */}
              <div className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <h4 className="font-medium text-slate-900 dark:text-white">
                    {vi ? 'Sao lưu & Khôi phục dữ liệu' : 'Backup & Restore'}
                  </h4>
                  <p className="text-slate-500 text-[11px] mt-0.5 max-w-md">
                    {vi ? 'Tải về tệp sao lưu hoặc tải lên bản sao lưu trước đó để phục hồi toàn bộ cấu hình, tài khoản và tệp' : 'Download database backup or restore previous configurations'}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={downloadingBackup}
                    onClick={downloadBackup}
                    className="rounded-full h-8 px-4 text-xs gap-1.5"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    {downloadingBackup ? (vi ? 'Đang tải...' : 'Downloading...') : (vi ? 'Tải bản sao lưu' : 'Download Backup')}
                  </Button>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".db"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          setRestoreFile(e.target.files[0])
                          restoreBackup()
                        }
                      }}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={restoringBackup}
                      className="rounded-full h-8 px-4 text-xs gap-1.5 pointer-events-none"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', restoringBackup && 'animate-spin')} />
                      {restoringBackup ? (vi ? 'Đang khôi phục...' : 'Restoring...') : (vi ? 'Khôi phục từ tệp' : 'Restore File')}
                    </Button>
                  </label>
                </div>
              </div>

              {/* Temp Cache Management */}
              <div className="py-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-[#0b57d0] dark:text-[#a8c7fa]" />
                      <h4 className="font-medium text-slate-900 dark:text-white">
                        {vi ? 'Bộ nhớ đệm tạm thời (Temp Cache)' : 'Temporary Stream Cache'}
                      </h4>
                    </div>
                    <p className="text-slate-500 text-[11px] mt-1 max-w-xl">
                      {vi
                        ? 'Khi xem video hoặc tải tệp qua HCDrive, dữ liệu được đệm tạm thời trên máy chủ để phát mượt mà, tua nhanh (HTTP 206 Range) và giảm tải cho Google Drive. Tệp đệm sẽ tự động xóa sau thời gian hết hạn hoặc khi vượt quá giới hạn ổ đĩa.'
                        : 'Streams and preview files are cached on the server to allow instant seeking (HTTP 206 Range) and lower Google Drive quota usage. Cached files are automatically removed after expiration or when exceeding the size limit.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadTempCache}
                      disabled={loadingTempCache}
                      className="rounded-full h-8 px-3 text-xs gap-1.5"
                      title={vi ? 'Làm mới thống kê' : 'Refresh stats'}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', loadingTempCache && 'animate-spin')} />
                      <span>{vi ? 'Làm mới' : 'Refresh'}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearTempCache}
                      disabled={clearingTempCache || !tempCacheStats || tempCacheStats.totalBytes === 0}
                      className="rounded-full h-8 px-3 text-xs gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 border-red-200 dark:border-red-900/50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{clearingTempCache ? (vi ? 'Đang xóa...' : 'Clearing...') : (vi ? 'Xóa sạch đệm' : 'Clear Cache')}</span>
                    </Button>
                  </div>
                </div>

                {/* Status card */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-[#18191a] border border-slate-200/80 dark:border-slate-800">
                  <div>
                    <span className="text-[11px] text-slate-400">{vi ? 'Dung lượng đang dùng' : 'Currently Used'}</span>
                    <p className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">
                      {tempCacheStats ? formatBytes(tempCacheStats.totalBytes) : '--'}
                      <span className="text-xs font-normal text-slate-400 ml-1.5">
                        {tempCacheMaxGb > 0 ? `/ ${tempCacheMaxGb} GB` : `(${vi ? 'Không giới hạn' : 'Unlimited'})`}
                      </span>
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400">{vi ? 'Số lượng tệp đệm' : 'Cached Files'}</span>
                    <p className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">
                      {tempCacheStats ? `${tempCacheStats.fileCount} ${vi ? 'tệp' : 'files'}` : '--'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400">{vi ? 'Trạng thái hoạt động' : 'Status'}</span>
                    <p className="mt-0.5 flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', tempCacheEnabled ? 'bg-emerald-500' : 'bg-slate-400')} />
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                        {tempCacheEnabled ? (vi ? 'Đang kích hoạt' : 'Active') : (vi ? 'Đã tắt' : 'Disabled')}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Settings form */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                      {vi ? 'Bật lưu đệm tạm thời' : 'Enable Stream Caching'}
                    </label>
                    <select
                      value={tempCacheEnabled ? 'true' : 'false'}
                      onChange={(e) => setTempCacheEnabled(e.target.value === 'true')}
                      className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e1f20] text-slate-900 dark:text-white text-xs focus:outline-none focus:border-[#0b57d0]"
                    >
                      <option value="true">{vi ? 'Bật (Khuyến nghị)' : 'Enabled (Recommended)'}</option>
                      <option value="false">{vi ? 'Tắt (Chỉ stream trực tiếp)' : 'Disabled (Direct proxy only)'}</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {vi ? 'Khi tắt, hệ thống không lưu đệm file nào vào ổ đĩa' : 'When disabled, no files are stored on server disk'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                      {vi ? 'Thời gian hết hạn (TTL)' : 'Cache Expiration (TTL)'}
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={isCustomTtl ? 'custom' : String(tempCacheTtl)}
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            setIsCustomTtl(true)
                            if ([0, 10, 15, 30, 60, 120, 360, 1440].includes(tempCacheTtl)) {
                              setTempCacheTtl(45)
                            }
                          } else {
                            setIsCustomTtl(false)
                            setTempCacheTtl(Number(e.target.value))
                          }
                        }}
                        className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e1f20] text-slate-900 dark:text-white text-xs focus:outline-none focus:border-[#0b57d0]"
                      >
                        <option value="0">{vi ? '∞ Vĩnh viễn (Không bao giờ xóa)' : '∞ Permanent (Never expire)'}</option>
                        <option value="10">10 {vi ? 'phút' : 'minutes'}</option>
                        <option value="15">15 {vi ? 'phút' : 'minutes'}</option>
                        <option value="30">30 {vi ? 'phút (Mặc định)' : 'minutes (Default)'}</option>
                        <option value="60">1 {vi ? 'giờ (60 phút)' : 'hour'}</option>
                        <option value="120">2 {vi ? 'giờ' : 'hours'}</option>
                        <option value="360">6 {vi ? 'giờ' : 'hours'}</option>
                        <option value="1440">24 {vi ? 'giờ (1 ngày)' : 'hours'}</option>
                        <option value="custom">{vi ? 'Tự nhập phút…' : 'Custom minutes…'}</option>
                      </select>
                    </div>
                    {isCustomTtl && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={525600}
                          value={tempCacheTtl}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            setTempCacheTtl(isNaN(val) ? 0 : Math.max(0, val))
                          }}
                          placeholder={vi ? 'Nhập số phút (0 = vĩnh viễn)' : 'Minutes (0 = permanent)'}
                          className="w-full h-8 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e1f20] text-slate-900 dark:text-white text-xs focus:outline-none focus:border-[#0b57d0]"
                        />
                        <span className="text-xs text-slate-500 shrink-0 font-medium whitespace-nowrap">
                          {tempCacheTtl === 0 ? (vi ? 'Vĩnh viễn' : 'Permanent') : (vi ? 'phút' : 'mins')}
                        </span>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">
                      {tempCacheTtl === 0
                        ? (vi ? '∞ Tệp đệm sẽ được lưu vĩnh viễn trên server, không bao giờ tự động xóa.' : '∞ Cached files are stored permanently on server, never auto-deleted.')
                        : (vi ? 'Tự xóa sau thời gian không có lượt truy cập' : 'Auto-deleted after inactivity')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                      {vi ? 'Dung lượng tối đa (Max Size)' : 'Max Cache Storage'}
                    </label>
                    <select
                      value={String(tempCacheMaxGb)}
                      onChange={(e) => setTempCacheMaxGb(Number(e.target.value))}
                      className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e1f20] text-slate-900 dark:text-white text-xs focus:outline-none focus:border-[#0b57d0]"
                    >
                      <option value="2">2 GB</option>
                      <option value="5">5 GB</option>
                      <option value="10">10 GB {vi ? '(Mặc định)' : '(Default)'}</option>
                      <option value="20">20 GB</option>
                      <option value="50">50 GB</option>
                      <option value="100">100 GB</option>
                      <option value="0">{vi ? 'Không giới hạn (0)' : 'Unlimited (0)'}</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {vi ? 'Tự động xóa các file cũ nhất khi gần đầy' : 'LRU eviction when full'}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    variant="filled"
                    size="sm"
                    onClick={() => handleSaveTempCache()}
                    disabled={savingTempCache}
                    className="rounded-full h-8 px-5 text-xs gap-1.5"
                  >
                    {savingTempCache ? (vi ? 'Đang lưu...' : 'Saving...') : (vi ? 'Lưu cấu hình bộ nhớ đệm' : 'Save Cache Settings')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create API Key */}
      <DummyModal
        open={createKeyOpen}
        title={vi ? 'Tạo khoá API mới' : 'Create API Key'}
        description={vi ? 'Nhập tên định danh cho khoá API này.' : 'Enter a name for this API key.'}
        onClose={() => setCreateKeyOpen(false)}
      >
        <form onSubmit={handleCreateKey} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
              {vi ? 'Tên khoá' : 'Key Name'}
            </label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g. Backup Script, CI/CD"
              required
              className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="text" size="sm" onClick={() => setCreateKeyOpen(false)}>
              {vi ? 'Huỷ' : 'Cancel'}
            </Button>
            <Button type="submit" variant="filled" size="sm" disabled={creatingKey}>
              {creatingKey ? (vi ? 'Đang tạo...' : 'Creating...') : (vi ? 'Tạo khoá' : 'Create')}
            </Button>
          </div>
        </form>
      </DummyModal>

      {/* Modal: Add User */}
      <DummyModal
        open={addUserOpen}
        title={vi ? 'Thêm người dùng mới' : 'Add New User'}
        description={vi ? 'Tạo tài khoản thành viên thủ công.' : 'Manually register a member account.'}
        onClose={() => setAddUserOpen(false)}
      >
        <form onSubmit={handleAddUser} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
              {vi ? 'Họ và tên' : 'Full Name'}
            </label>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              required
              className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
            />
          </div>
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
              {vi ? 'Địa chỉ email' : 'Email Address'}
            </label>
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              required
              className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
            />
          </div>
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
              {vi ? 'Mật khẩu' : 'Password'}
            </label>
            <input
              type="password"
              minLength={8}
              value={addPassword}
              onChange={(e) => setAddPassword(e.target.value)}
              required
              className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="text" size="sm" onClick={() => setAddUserOpen(false)}>
              {vi ? 'Huỷ' : 'Cancel'}
            </Button>
            <Button type="submit" variant="filled" size="sm" disabled={addingUser}>
              {addingUser ? (vi ? 'Đang tạo...' : 'Creating...') : (vi ? 'Tạo tài khoản' : 'Add User')}
            </Button>
          </div>
        </form>
      </DummyModal>

      {/* Modal: Edit User */}
      <DummyModal
        open={!!editingUser}
        title={vi ? 'Chỉnh sửa người dùng' : 'Edit User'}
        description={vi ? `Cập nhật thông tin cho ${editingUser?.name || 'người dùng'}` : `Update details for ${editingUser?.name || 'user'}`}
        onClose={() => setEditingUser(null)}
      >
        <form onSubmit={handleEditUser} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
              {vi ? 'Họ và tên' : 'Full Name'}
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
            />
          </div>
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
              {vi ? 'Địa chỉ email' : 'Email Address'}
            </label>
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              required
              className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
            />
          </div>
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
              {vi ? 'Mật khẩu mới (bỏ trống nếu không đổi)' : 'New Password (leave blank to keep current)'}
            </label>
            <input
              type="password"
              minLength={6}
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-white focus:outline-none focus:border-[#0b57d0]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="text" size="sm" onClick={() => setEditingUser(null)}>
              {vi ? 'Huỷ' : 'Cancel'}
            </Button>
            <Button type="submit" variant="filled" size="sm" disabled={savingEditUser}>
              {savingEditUser ? (vi ? 'Đang lưu...' : 'Saving...') : (vi ? 'Lưu thay đổi' : 'Save Changes')}
            </Button>
          </div>
        </form>
      </DummyModal>

      {/* Modal: Live Update Log */}
      <DummyModal
        open={updateLogOpen}
        title={updateFinished ? (updateSuccess ? 'Cập nhật hoàn tất' : 'Cập nhật thất bại') : 'Đang cập nhật hệ thống...'}
        description="Nhật ký tiến trình từ server"
        onClose={() => {
          setUpdateLogOpen(false)
          setIsPollingLog(false)
        }}
      >
        <div className="space-y-3">
          <div
            ref={logRef}
            className="rounded-2xl bg-black/90 text-green-400 font-mono text-[11px] p-4 h-64 overflow-y-auto leading-relaxed border border-slate-800"
          >
            <pre className="whitespace-pre-wrap">{updateLog}</pre>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUpdateLogOpen(false)
                setIsPollingLog(false)
              }}
            >
              {vi ? 'Đóng' : 'Close'}
            </Button>
            {updateFinished && updateSuccess && (
              <Button variant="filled" size="sm" onClick={() => window.location.reload()}>
                {vi ? 'Tải lại trang' : 'Reload'}
              </Button>
            )}
          </div>
        </div>
      </DummyModal>
    </div>
  )
}
