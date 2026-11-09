// Reference data for the API docs page (pages/ApiDocsPage.tsx). Each entry mirrors a backend route;
// keep it in step with backend/src/modules/** when a route, its Zod schema or its response changes.
// Code snippets are generated from the entry unless it brings its own.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiCategory = 'auth' | 'uploads' | 'files' | 'folders' | 'drive' | 'sharing' | 'storage' | 'library' | 'keys' | 'admin'

export type ApiParam = { name: string; type: string; required: boolean; descVi: string; descEn: string }

export type Endpoint = {
  id: string
  method: HttpMethod
  path: string
  titleVi: string
  titleEn: string
  descVi: string
  descEn: string
  category: ApiCategory
  authRequired: boolean
  authType?: 'bearer' | 'apiKey' | 'public' | 'admin'
  params?: ApiParam[]
  /** Example query string appended in snippets, e.g. "?folderId=…". */
  queryExample?: string
  bodyExample?: string
  successStatus?: number
  responseExample?: string
  errorStatus?: number
  errorExample?: string
  /** The response is a file / stream: snippets save it instead of printing JSON. */
  binary?: boolean
  curlSnippet?: string
  jsSnippet?: string
  pySnippet?: string
}

export const apiCategories: Array<{ id: ApiCategory; labelVi: string; labelEn: string }> = [
  { id: 'auth', labelVi: 'Xác thực & tài khoản', labelEn: 'Authentication' },
  { id: 'uploads', labelVi: 'Tải lên', labelEn: 'Uploads' },
  { id: 'files', labelVi: 'Tệp', labelEn: 'Files' },
  { id: 'folders', labelVi: 'Thư mục', labelEn: 'Folders' },
  { id: 'drive', labelVi: 'Tính năng Google Drive', labelEn: 'Google Drive features' },
  { id: 'sharing', labelVi: 'Chia sẻ', labelEn: 'Sharing' },
  { id: 'storage', labelVi: 'Tài khoản lưu trữ', labelEn: 'Storage accounts' },
  { id: 'library', labelVi: 'Khóa học', labelEn: 'Courses library' },
  { id: 'keys', labelVi: 'Khoá API & nhật ký', labelEn: 'API keys & audit log' },
  { id: 'admin', labelVi: 'Quản trị (admin)', labelEn: 'Administration' },
]

// ---- small builders ----

const p = {
  path: (name: string, descVi: string, descEn: string): ApiParam => ({ name, type: 'Path · string', required: true, descVi, descEn }),
  query: (name: string, type: string, required: boolean, descVi: string, descEn: string): ApiParam => ({ name, type: `Query · ${type}`, required, descVi, descEn }),
  body: (name: string, type: string, required: boolean, descVi: string, descEn: string): ApiParam => ({ name, type: `Body · ${type}`, required, descVi, descEn }),
  header: (name: string, required: boolean, descVi: string, descEn: string): ApiParam => ({ name, type: 'Header', required, descVi, descEn }),
  form: (name: string, type: string, required: boolean, descVi: string, descEn: string): ApiParam => ({ name, type: `Form · ${type}`, required, descVi, descEn }),
}

const json = (value: unknown) => JSON.stringify(value, null, 2)
const OK = json({ status: 'ok' })
const err = (code: string, message: string) => json({ code, message })
const NOT_FOUND = (code: string) => err(code, 'Not found.')

const ID = 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const ID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const NOW = '2026-11-03T08:30:00.000Z'

const fileExample = {
  id: ID,
  userId: ID2,
  connectedAccountId: 'a1b2c3d4-0000-4000-8000-000000000001',
  folderId: null,
  provider: 'google_drive',
  providerFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: '1048576',
  status: 'active',
  starred: false,
  createdAt: NOW,
  updatedAt: NOW,
}

const folderExample = { id: ID, name: 'Tài liệu', color: '#5f6368', iconUrl: null, parentId: null, providerFolderId: '1FoLdErIdXyZ', createdAt: NOW, updatedAt: NOW }

const savedLinkExample = {
  id: ID,
  driveFileId: '1CoUrSeFoLdErId',
  title: 'Khóa React nâng cao',
  url: 'https://drive.google.com/drive/folders/1CoUrSeFoLdErId',
  mimeType: 'application/vnd.google-apps.folder',
  isFolder: true,
  ownerName: 'Thầy A',
  ownerEmail: 'teacher@example.com',
  collection: 'Lập trình Web',
  teacher: 'ThS. Nguyễn Văn A',
  note: '',
  shared: false,
  lastOpenedAt: NOW,
  createdAt: NOW,
  account: { id: ID2, email: 'me@gmail.com' },
  completedCount: 3,
}

function placeholder(name: string) {
  return `{${name}}`
}

function withSnippets(baseUrl: string, e: Endpoint): Endpoint {
  const url = `${baseUrl}${e.path.replace(/:([A-Za-z]+)/g, (_m, name: string) => placeholder(name))}${e.queryExample ?? ''}`
  const token = e.authType === 'apiKey' ? '9d_live_your_api_key' : 'YOUR_ACCESS_TOKEN'
  const authed = e.authRequired && e.authType !== 'public'
  const hasBody = Boolean(e.bodyExample) && e.method !== 'GET'

  const curl = [`curl -X ${e.method} "${url}"`]
  if (authed) curl.push(`  -H "Authorization: Bearer ${token}"`)
  if (hasBody) curl.push(`  -H "Content-Type: application/json"`, `  -d '${JSON.stringify(JSON.parse(e.bodyExample!))}'`)
  if (e.binary) curl.push('  -L -OJ')

  const headers: string[] = []
  if (authed) headers.push(`'Authorization': 'Bearer ' + ${e.authType === 'apiKey' ? "'9d_live_your_api_key'" : 'accessToken'}`)
  if (hasBody) headers.push(`'Content-Type': 'application/json'`)
  const js = [
    `const res = await fetch('${url}', {`,
    `  method: '${e.method}',`,
    ...(headers.length ? [`  headers: { ${headers.join(', ')} },`] : []),
    ...(hasBody ? [`  body: JSON.stringify(${JSON.stringify(JSON.parse(e.bodyExample!))}),`] : []),
    `});`,
    e.binary ? `const blob = await res.blob();` : `const data = await res.json();`,
  ]

  const py = [
    'import requests',
    '',
    ...(authed ? [`headers = {"Authorization": "Bearer ${token}"}`] : []),
    `r = requests.${e.method.toLowerCase()}("${url}"${authed ? ', headers=headers' : ''}${hasBody ? `, json=${JSON.stringify(JSON.parse(e.bodyExample!)).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')}` : ''}${e.binary ? ', stream=True' : ''})`,
    e.binary ? 'open("download.bin", "wb").write(r.content)' : 'print(r.status_code, r.json())',
  ]

  return {
    ...e,
    curlSnippet: e.curlSnippet ?? curl.join(' \\\n'),
    jsSnippet: e.jsSnippet ?? js.join('\n'),
    pySnippet: e.pySnippet ?? py.join('\n'),
  }
}

const bearer = { authRequired: true, authType: 'bearer' as const }
const admin = { authRequired: true, authType: 'admin' as const }
const open = { authRequired: false, authType: 'public' as const }

export function buildEndpoints(baseUrl: string): Endpoint[] {
  const list: Endpoint[] = [
    // =============================== AUTH ===============================
    {
      id: 'auth-config', method: 'GET', path: '/auth/config', category: 'auth', ...open,
      titleVi: 'Cấu hình trang đăng nhập', titleEn: 'Sign-in page configuration',
      descVi: 'Cho biết có cho phép đăng ký không và captcha nào đang bật (reCAPTCHA hoặc Turnstile, site key công khai, bật cho đăng ký / đăng nhập). Không trả về secret.',
      descEn: 'Whether sign-up is open and which captcha is active (provider, public site key, on sign-up / sign-in). Never returns a secret.',
      responseExample: json({ allowRegistration: true, captcha: { provider: 'turnstile', siteKey: '0x4AAAAAAA…', onRegister: true, onLogin: false } }),
    },
    {
      id: 'auth-register', method: 'POST', path: '/auth/register', category: 'auth', ...open,
      titleVi: 'Đăng ký tài khoản', titleEn: 'Register',
      descVi: 'Tạo tài khoản bằng email và mật khẩu, trả về cặp token. Bị chặn khi quản trị viên tắt đăng ký. Giới hạn 5 lần / giờ / IP.',
      descEn: 'Creates an account with email and password and returns tokens. Blocked when sign-up is off. Limited to 5 per hour per IP.',
      params: [
        p.body('name', 'string', true, 'Tên hiển thị, tối thiểu 2 ký tự', 'Display name, at least 2 characters'),
        p.body('email', 'string', true, 'Email đăng nhập', 'Sign-in email'),
        p.body('password', 'string', true, 'Mật khẩu, tối thiểu 8 ký tự', 'Password, at least 8 characters'),
        p.body('captchaToken', 'string', false, 'Token captcha khi /auth/config báo captcha.onRegister = true', 'Captcha token when captcha.onRegister is true'),
      ],
      bodyExample: json({ name: 'Nguyễn Văn A', email: 'a@example.com', password: 'mat-khau-manh', captchaToken: 'XXXX.DUMMY.TOKEN' }),
      successStatus: 201,
      responseExample: json({ accessToken: 'eyJhbGciOiJIUzI1NiIs…', refreshToken: 'rt_6f2a…', user: { id: ID, name: 'Nguyễn Văn A', email: 'a@example.com' } }),
      errorStatus: 409, errorExample: err('AUTH_EMAIL_TAKEN', 'Email already registered.'),
    },
    {
      id: 'auth-login', method: 'POST', path: '/auth/login', category: 'auth', ...open,
      titleVi: 'Đăng nhập', titleEn: 'Sign in',
      descVi: 'Đổi email + mật khẩu lấy access token (JWT, gửi trong header Authorization) và refresh token. Sai nhiều lần sẽ bị giới hạn (429 kèm Retry-After).',
      descEn: 'Exchanges email + password for an access token (JWT, sent as Authorization header) and a refresh token. Repeated failures are rate limited (429 with Retry-After).',
      params: [
        p.body('email', 'string', true, 'Email', 'Email'),
        p.body('password', 'string', true, 'Mật khẩu', 'Password'),
        p.body('captchaToken', 'string', false, 'Token captcha khi captcha.onLogin = true', 'Captcha token when captcha.onLogin is true'),
      ],
      bodyExample: json({ email: 'a@example.com', password: 'mat-khau-manh' }),
      responseExample: json({ accessToken: 'eyJhbGciOiJIUzI1NiIs…', refreshToken: 'rt_6f2a…', user: { id: ID, name: 'Nguyễn Văn A', email: 'a@example.com' } }),
      errorStatus: 401, errorExample: err('AUTH_INVALID_CREDENTIALS', 'Invalid email or password.'),
    },
    {
      id: 'auth-refresh', method: 'POST', path: '/auth/refresh', category: 'auth', ...open,
      titleVi: 'Làm mới access token', titleEn: 'Refresh the access token',
      descVi: 'Lấy access token mới khi token cũ hết hạn (mặc định 1 giờ). Refresh token sống theo REFRESH_TOKEN_TTL_DAYS.',
      descEn: 'Issues a new access token when the old one expires (1 hour by default). The refresh token lasts REFRESH_TOKEN_TTL_DAYS.',
      params: [p.body('refreshToken', 'string', true, 'Refresh token nhận khi đăng nhập', 'Refresh token from sign-in')],
      bodyExample: json({ refreshToken: 'rt_6f2a…' }),
      responseExample: json({ accessToken: 'eyJhbGciOiJIUzI1NiIs…' }),
      errorStatus: 401, errorExample: err('AUTH_SESSION_EXPIRED', 'Refresh token expired.'),
    },
    {
      id: 'auth-logout', method: 'POST', path: '/auth/logout', category: 'auth', ...bearer,
      titleVi: 'Đăng xuất', titleEn: 'Sign out',
      descVi: 'Thu hồi phiên hiện tại; refresh token của phiên này không dùng được nữa.',
      descEn: 'Revokes the current session; its refresh token stops working.',
      responseExample: OK,
    },
    {
      id: 'auth-me', method: 'GET', path: '/auth/me', category: 'auth', ...bearer,
      titleVi: 'Thông tin người dùng hiện tại', titleEn: 'Current user',
      descVi: 'Hồ sơ người đang đăng nhập, kèm cờ quản trị viên và tuỳ chọn tự chuyển tệp Office thành Google Docs.',
      descEn: 'Profile of the signed-in user, with the admin flag and the convert-Office-uploads preference.',
      responseExample: json({ user: { id: ID, name: 'Nguyễn Văn A', email: 'a@example.com', avatarUrl: null, status: 'active', convertUploads: false, isAdmin: true } }),
      errorStatus: 401, errorExample: err('AUTH_REQUIRED', 'Bearer token required.'),
    },
    {
      id: 'auth-me-update', method: 'PATCH', path: '/auth/me', category: 'auth', ...bearer,
      titleVi: 'Cập nhật hồ sơ / đổi email / đổi mật khẩu', titleEn: 'Update profile / change email / password',
      descVi: 'Đổi tên, địa chỉ email, ảnh đại diện, tuỳ chọn chuyển đổi tệp Office; đổi email hoặc mật khẩu cần currentPassword.',
      descEn: 'Changes name, email address, avatar, Office conversion preference; changing email or password needs currentPassword.',
      params: [
        p.body('name', 'string', false, 'Tên mới (1–100 ký tự)', 'New name (1–100 chars)'),
        p.body('email', 'string', false, 'Địa chỉ email mới (cần currentPassword)', 'New email address (requires currentPassword)'),
        p.body('avatarUrl', 'string | null', false, 'URL ảnh đại diện, null để xoá', 'Avatar URL, null to clear'),
        p.body('currentPassword', 'string', false, 'Mật khẩu hiện tại (bắt buộc khi đổi email hoặc mật khẩu)', 'Current password (required to change email or password)'),
        p.body('newPassword', 'string', false, 'Mật khẩu mới, tối thiểu 6 ký tự', 'New password, at least 6 chars'),
        p.body('convertUploads', 'boolean', false, 'Tự chuyển Word/Excel/PowerPoint thành Google Docs khi tải lên', 'Convert Office uploads to Google Docs'),
      ],
      bodyExample: json({ name: 'Nguyễn Văn B', convertUploads: true }),
      responseExample: json({ user: { id: ID, name: 'Nguyễn Văn B', email: 'a@example.com', avatarUrl: null, status: 'active', convertUploads: true, isAdmin: false } }),
      errorStatus: 400, errorExample: err('INVALID_CURRENT_PASSWORD', 'Mật khẩu hiện tại không chính xác.'),
    },
    {
      id: 'auth-avatar-upload', method: 'POST', path: '/auth/avatar', category: 'auth', ...bearer,
      titleVi: 'Tải ảnh đại diện', titleEn: 'Upload an avatar',
      descVi: 'multipart/form-data với một ảnh PNG, JPG, WEBP hoặc GIF.',
      descEn: 'multipart/form-data with one PNG, JPG, WEBP or GIF image.',
      params: [p.form('file', 'image', true, 'Tệp ảnh', 'Image file')],
      curlSnippet: `curl -X POST "${baseUrl}/auth/avatar" \\\n  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\\n  -F "file=@avatar.png;type=image/png"`,
      jsSnippet: `const form = new FormData();\nform.append('file', imageFile);\nconst res = await fetch('${baseUrl}/auth/avatar', {\n  method: 'POST',\n  headers: { 'Authorization': 'Bearer ' + accessToken },\n  body: form,\n});`,
      pySnippet: `import requests\n\nr = requests.post("${baseUrl}/auth/avatar",\n  headers={"Authorization": "Bearer YOUR_ACCESS_TOKEN"},\n  files={"file": ("avatar.png", open("avatar.png", "rb"), "image/png")})\nprint(r.json())`,
      responseExample: json({ status: 'ok', avatarUrl: `/auth/avatar/${ID}?v=1793700000`, user: { id: ID, name: 'Nguyễn Văn A', isAdmin: false } }),
      errorStatus: 400, errorExample: err('INVALID_IMAGE_TYPE', 'Only PNG, JPG, WEBP, and GIF images are supported.'),
    },
    {
      id: 'auth-avatar-delete', method: 'DELETE', path: '/auth/avatar', category: 'auth', ...bearer,
      titleVi: 'Xoá ảnh đại diện', titleEn: 'Remove the avatar', descVi: 'Quay về ảnh mặc định.', descEn: 'Back to the default picture.',
      responseExample: json({ status: 'ok', user: { id: ID, avatarUrl: null } }),
    },
    {
      id: 'auth-avatar-get', method: 'GET', path: '/auth/avatar/:userId', category: 'auth', ...open, binary: true,
      titleVi: 'Lấy ảnh đại diện', titleEn: 'Get an avatar', descVi: 'Trả về tệp ảnh đại diện đã tải lên của người dùng.', descEn: 'Returns the uploaded avatar image.',
      params: [p.path('userId', 'ID người dùng', 'User ID')],
      responseExample: 'Content-Type: image/png\n(binary image)', errorStatus: 404, errorExample: err('AVATAR_NOT_FOUND', 'No avatar found'),
    },
    {
      id: 'auth-sessions', method: 'GET', path: '/auth/sessions', category: 'auth', ...bearer,
      titleVi: 'Danh sách phiên đăng nhập', titleEn: 'List sign-in sessions',
      descVi: 'Các thiết bị đang đăng nhập; current = true là phiên đang gọi API.',
      descEn: 'Devices currently signed in; current = true is the calling session.',
      responseExample: json({ sessions: [{ id: ID, userAgent: 'Mozilla/5.0 (Windows NT 10.0…)', ipAddress: '203.0.113.9', createdAt: NOW, lastActiveAt: NOW, current: true }] }),
    },
    {
      id: 'auth-session-revoke', method: 'DELETE', path: '/auth/sessions/:id', category: 'auth', ...bearer,
      titleVi: 'Đăng xuất một thiết bị', titleEn: 'Sign out one device', descVi: 'Thu hồi một phiên khác (không dùng cho phiên hiện tại — dùng /auth/logout).', descEn: 'Revokes another session (use /auth/logout for the current one).',
      params: [p.path('id', 'ID phiên', 'Session ID')],
      responseExample: OK, errorStatus: 400, errorExample: err('CANNOT_REVOKE_CURRENT_SESSION', 'Dùng Đăng xuất để thoát phiên hiện tại.'),
    },
    {
      id: 'auth-session-revoke-others', method: 'POST', path: '/auth/sessions/revoke-others', category: 'auth', ...bearer,
      titleVi: 'Đăng xuất mọi thiết bị khác', titleEn: 'Sign out all other devices', descVi: 'Giữ lại phiên hiện tại, thu hồi tất cả phiên còn lại.', descEn: 'Keeps the current session and revokes the rest.',
      responseExample: json({ status: 'ok', revoked: 3 }),
    },
    {
      id: 'auth-google-methods', method: 'GET', path: '/auth/google/methods', category: 'auth', ...open,
      titleVi: 'Cách đăng nhập Google khả dụng', titleEn: 'Available Google sign-in methods',
      descVi: 'rclone = OAuth client mặc định dùng chung; custom = OAuth client riêng do quản trị viên cấu hình.',
      descEn: 'rclone = the shared default OAuth client; custom = the installation\'s own client.',
      responseExample: json({ hasCustom: true, defaultMethod: 'custom' }),
    },
    {
      id: 'auth-google-url', method: 'GET', path: '/auth/google/url', category: 'auth', ...open,
      titleVi: 'Link đăng nhập bằng Google', titleEn: 'Google sign-in URL',
      descVi: 'Trả về URL trang đồng ý của Google. Sau khi đồng ý, Google chuyển về /auth/google/callback, rồi HCDrive chuyển tới trang /google-auth?token=… để đổi lấy phiên qua /auth/google/exchange. Token ứng dụng không bao giờ nằm trên URL.',
      descEn: 'Returns Google\'s consent URL. Google redirects to /auth/google/callback, then HCDrive sends the browser to /google-auth?token=… which is exchanged via /auth/google/exchange. App tokens never travel in a URL.',
      params: [p.query('method', "'rclone' | 'custom'", false, 'OAuth client dùng để đăng nhập', 'OAuth client to use')],
      queryExample: '?method=custom',
      responseExample: json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=…&state=…' }),
      errorStatus: 400, errorExample: err('CONFIG_NOT_FOUND', 'Chưa cấu hình Google OAuth cá nhân.'),
    },
    {
      id: 'auth-google-exchange', method: 'POST', path: '/auth/google/exchange', category: 'auth', ...open,
      titleVi: 'Đổi mã đăng nhập Google lấy phiên', titleEn: 'Exchange the Google hand-off token',
      descVi: 'Mã dùng một lần, hết hạn sau vài phút.', descEn: 'One-time token that expires within minutes.',
      params: [p.body('token', 'string', true, 'Giá trị token trên URL /google-auth', 'The token from the /google-auth URL')],
      bodyExample: json({ token: 'ho_9a8b7c…' }),
      responseExample: json({ accessToken: 'eyJhbGciOiJIUzI1NiIs…', refreshToken: 'rt_6f2a…', user: { id: ID, name: 'Nguyễn Văn A', email: 'a@gmail.com' } }),
      errorStatus: 401, errorExample: err('AUTH_GOOGLE_HANDOFF_INVALID', 'Google login session expired.'),
    },
    {
      id: 'auth-google-link-url', method: 'GET', path: '/auth/google/link-url', category: 'auth', ...bearer,
      titleVi: 'Link liên kết đăng nhập Google', titleEn: 'URL to link a Google sign-in',
      descVi: 'Cho tài khoản email thêm cách đăng nhập bằng Google. Sau khi đồng ý, xác nhận bằng /auth/google/link/confirm.',
      descEn: 'Adds Google sign-in to an email account. Confirm with /auth/google/link/confirm afterwards.',
      params: [p.query('method', "'rclone' | 'custom'", false, 'OAuth client', 'OAuth client')],
      responseExample: json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?…' }),
    },
    {
      id: 'auth-google-link-confirm', method: 'POST', path: '/auth/google/link/confirm', category: 'auth', ...bearer,
      titleVi: 'Xác nhận liên kết Google', titleEn: 'Confirm a Google link',
      descVi: 'Hoàn tất liên kết với token nhận được ở trang Cài đặt sau khi Google chuyển về.', descEn: 'Completes the link with the token returned to the Settings page.',
      params: [p.body('token', 'string', true, 'googleLinkToken trên URL', 'googleLinkToken from the URL')],
      bodyExample: json({ token: 'lk_1234…' }),
      responseExample: json({ status: 'ok', email: 'a@gmail.com' }),
      errorStatus: 409, errorExample: err('GOOGLE_LINKED_OTHER', 'Tài khoản Google a@gmail.com đã liên kết với một tài khoản HCDrive khác.'),
    },
    {
      id: 'auth-identities', method: 'GET', path: '/auth/identities', category: 'auth', ...bearer,
      titleVi: 'Các cách đăng nhập đã liên kết', titleEn: 'Linked sign-in identities', descVi: 'Danh sách tài khoản Google dùng để đăng nhập, kèm việc có gỡ được không.', descEn: 'Google identities used to sign in, and whether each can be removed.',
      responseExample: json({ hasPassword: true, identities: [{ id: ID, provider: 'google', email: 'a@gmail.com', displayName: 'A', avatarUrl: null, createdAt: NOW, lastLoginAt: NOW, isAccountEmail: false, canUnlink: true }] }),
    },
    {
      id: 'auth-identity-delete', method: 'DELETE', path: '/auth/identities/:id', category: 'auth', ...bearer,
      titleVi: 'Gỡ liên kết đăng nhập Google', titleEn: 'Unlink a Google sign-in', descVi: 'Không gỡ được cách đăng nhập cuối cùng hoặc Gmail trùng email tài khoản.', descEn: 'The last sign-in method and the account\'s own Gmail cannot be removed.',
      params: [p.path('id', 'ID liên kết', 'Identity ID')],
      responseExample: OK, errorStatus: 400, errorExample: err('IDENTITY_LAST_LOGIN', 'Đây là cách đăng nhập duy nhất của tài khoản, không thể gỡ.'),
    },

    // =============================== UPLOADS ===============================
    {
      id: 'upload-api', method: 'POST', path: '/v1/uploads', category: 'uploads', authRequired: true, authType: 'apiKey',
      titleVi: 'Tải lên bằng khoá API', titleEn: 'Upload with an API key',
      descVi: 'Dành cho script, CI, ứng dụng khác. Hỗ trợ xác thực bằng Khoá API (9d_live_…) hoặc Bearer token. Có thể tải đơn giản chỉ với trường file=@ten_tep, hoặc tải nhiều tệp kèm filesMeta (JSON). Tệp được stream thẳng tới tài khoản lưu trữ, không ghi đĩa.',
      descEn: 'For scripts, CI and external apps. Supports API keys (9d_live_…) or Bearer tokens. Simple upload with file=@your_file or batch upload with filesMeta (JSON). Files stream straight to storage.',
      params: [
        p.header('Authorization', true, 'Bearer 9d_live_… (hoặc X-API-Key: 9d_live_…)', 'Bearer 9d_live_… (or X-API-Key: 9d_live_…)'),
        p.form('file', 'file', true, 'Tệp cần tải lên (cách đơn giản 1 tệp)', 'File to upload (simple single-file method)'),
        p.form('folderId', 'string', false, 'Thư mục đích; trống = gốc', 'Target folder ID; empty = root'),
        p.form('filesMeta', 'JSON array', false, 'Tuỳ chọn: Mảng [{ fieldName, fileName, mimeType, sizeBytes, folderId? }] khi tải nhiều tệp cùng lúc', 'Optional: Array for batch uploads'),
      ],
      bodyExample: undefined,
      curlSnippet: `# Cách 1: Tải nhanh 1 tệp đơn giản
curl -X POST "${baseUrl}/v1/uploads" \\
  -H "Authorization: Bearer 9d_live_your_api_key" \\
  -F "file=@report.pdf"

# Cách 2: Tải nhiều tệp kèm metadata JSON
curl -X POST "${baseUrl}/v1/uploads" \\
  -H "Authorization: Bearer 9d_live_your_api_key" \\
  -F 'filesMeta=[{"fieldName":"file-0","fileName":"report.pdf","mimeType":"application/pdf","sizeBytes":"20480"}]' \\
  -F "file-0=@report.pdf;type=application/pdf"`,
      jsSnippet: `// Cách 1: Tải đơn giản với FormData
const form = new FormData();
form.append('file', file);
if (folderId) form.append('folderId', folderId);

const res = await fetch('${baseUrl}/v1/uploads', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer 9d_live_your_api_key' },
  body: form,
});
const data = await res.json();
console.log(data);`,
      pySnippet: `import requests

# Cách 1: Tải nhanh 1 tệp
with open("report.pdf", "rb") as f:
    res = requests.post(
        "${baseUrl}/v1/uploads",
        headers={"Authorization": "Bearer 9d_live_your_api_key"},
        files={"file": f},
        data={"folderId": "optional_folder_id"} # tuỳ chọn
    )
print(res.json())`,
      successStatus: 201,
      responseExample: json({ file: fileExample, files: [fileExample], failed: [] }),
      errorStatus: 400, errorExample: err('NO_ACCOUNT_WITH_ENOUGH_SPACE', 'No connected storage account has enough space.'),
    },
    {
      id: 'uploads-multipart', method: 'POST', path: '/uploads', category: 'uploads', ...bearer,
      titleVi: 'Tải lên (multipart)', titleEn: 'Upload (multipart)',
      descVi: 'Tải một hoặc nhiều tệp trong một request. Cách nhiều tệp: phần filesMeta rồi tới các tệp. Cách một tệp: các trường fileName, mimeType, sizeBytes, folderId? rồi phần tệp. Tài khoản lưu trữ được chọn theo chính sách phân bổ (hoặc targetAccountId).',
      descEn: 'One or many files per request. Many: a filesMeta part, then the files. One: fileName, mimeType, sizeBytes, folderId? fields, then the file. The storage account follows the routing policy (or targetAccountId).',
      params: [
        p.form('filesMeta', 'JSON array', false, 'Như /v1/uploads (cách nhiều tệp)', 'As in /v1/uploads (batch form)'),
        p.form('fileName / mimeType / sizeBytes', 'string', false, 'Cách một tệp', 'Single-file form'),
        p.form('folderId', 'string', false, 'Thư mục đích; trống = gốc', 'Target folder; empty = root'),
        p.form('targetAccountId', 'string', false, 'Ép lưu vào một tài khoản cụ thể', 'Force a specific storage account'),
      ],
      curlSnippet: `curl -X POST "${baseUrl}/uploads" \\\n  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\\n  -F "fileName=photo.jpg" -F "mimeType=image/jpeg" -F "sizeBytes=204800" \\\n  -F "file=@photo.jpg;type=image/jpeg"`,
      jsSnippet: `const form = new FormData();\nform.append('fileName', file.name);\nform.append('mimeType', file.type);\nform.append('sizeBytes', String(file.size));\nform.append('file', file);\nconst res = await fetch('${baseUrl}/uploads', {\n  method: 'POST',\n  headers: { 'Authorization': 'Bearer ' + accessToken },\n  body: form,\n});`,
      successStatus: 201,
      responseExample: json({ file: fileExample }),
      errorStatus: 400, errorExample: err('UPLOAD_INVALID_CONTENT_TYPE', 'multipart/form-data required.'),
    },
    {
      id: 'uploads-resumable-init', method: 'POST', path: '/uploads/resumable/init', category: 'uploads', ...bearer,
      titleVi: 'Bắt đầu tải lên tiếp tục được', titleEn: 'Start a resumable upload',
      descVi: 'Dùng cho tệp lớn hoặc mạng không ổn định: tạo phiên rồi gửi từng phần qua /uploads/resumable/chunk/:id. Mỗi phần nên là bội số 256 KB (giao diện dùng 5 MB).',
      descEn: 'For large files or flaky networks: create a session, then send parts to /uploads/resumable/chunk/:id. Parts should be multiples of 256 KB (the web app uses 5 MB).',
      params: [
        p.body('fileName', 'string', true, 'Tên tệp', 'File name'),
        p.body('mimeType', 'string', true, 'Kiểu MIME', 'MIME type'),
        p.body('sizeBytes', 'string', true, 'Kích thước (byte, dạng chuỗi)', 'Size in bytes, as a string'),
        p.body('folderId', 'string | null', false, 'Thư mục đích', 'Target folder'),
        p.body('targetAccountId', 'string | null', false, 'Tài khoản lưu trữ cụ thể', 'Specific storage account'),
      ],
      bodyExample: json({ fileName: 'video.mp4', mimeType: 'video/mp4', sizeBytes: '734003200', folderId: null }),
      successStatus: 201,
      responseExample: json({ sessionId: ID, provider: 'google_drive', offset: 0, targetAccountId: ID2 }),
      errorStatus: 400, errorExample: err('UPLOAD_TOO_LARGE', 'File exceeds max upload size.'),
    },
    {
      id: 'uploads-resumable-chunk', method: 'PUT', path: '/uploads/resumable/chunk/:id', category: 'uploads', ...bearer,
      titleVi: 'Gửi một phần tệp', titleEn: 'Send a part',
      descVi: 'Thân request là dữ liệu nhị phân của phần đó, header Content-Range cho biết vị trí. Phần cuối trả về 201 kèm tệp đã tạo.',
      descEn: 'The body is the raw bytes of the part; Content-Range gives its position. The last part returns 201 with the created file.',
      params: [p.path('id', 'sessionId từ /resumable/init', 'sessionId from /resumable/init'), p.header('Content-Range', true, 'bytes {start}-{end}/{total}', 'bytes {start}-{end}/{total}')],
      curlSnippet: `curl -X PUT "${baseUrl}/uploads/resumable/chunk/{id}" \\\n  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\\n  -H "Content-Range: bytes 0-5242879/734003200" \\\n  --data-binary @part-000.bin`,
      jsSnippet: `const chunk = file.slice(start, end);\nconst res = await fetch('${baseUrl}/uploads/resumable/chunk/' + sessionId, {\n  method: 'PUT',\n  headers: {\n    'Authorization': 'Bearer ' + accessToken,\n    'Content-Range': \`bytes \${start}-\${end - 1}/\${file.size}\`,\n  },\n  body: chunk,\n});`,
      responseExample: json({ status: 'uploading', offset: '5242880' }),
      errorStatus: 400, errorExample: err('MISSING_CONTENT_RANGE', 'Content-Range header is required.'),
    },
    {
      id: 'uploads-resumable-status', method: 'GET', path: '/uploads/resumable/status/:id', category: 'uploads', ...bearer,
      titleVi: 'Trạng thái tải lên', titleEn: 'Upload status',
      descVi: 'Sau khi mất mạng, hỏi offset đã nhận để gửi tiếp từ đó.', descEn: 'After a network drop, ask how far the server got and resume from there.',
      params: [p.path('id', 'sessionId', 'sessionId')],
      responseExample: json({ status: 'uploading', offset: '15728640' }),
    },

    // =============================== FILES ===============================
    {
      id: 'files-list', method: 'GET', path: '/files', category: 'files', ...bearer,
      titleVi: 'Danh sách / tìm kiếm tệp', titleEn: 'List / search files',
      descVi: 'Tệp trong một thư mục (folderId) hoặc ở gốc; có q thì tìm theo tên, thêm content=1 để tìm cả trong nội dung (full-text của Google Drive). thumbnailUrl là URL ảnh thu nhỏ đã ký, dùng thẳng trong <img>.',
      descEn: 'Files in a folder (folderId) or at the root; q searches names, content=1 also searches inside files (Google full-text). thumbnailUrl is a signed URL usable in <img>.',
      params: [
        p.query('folderId', 'string', false, 'Thư mục cần liệt kê', 'Folder to list'),
        p.query('q', 'string', false, 'Từ khoá tìm kiếm', 'Search text'),
        p.query('content', "'1'", false, 'Tìm cả trong nội dung tệp', 'Also search file contents'),
        p.query('kind', "'image' | 'video' | 'pdf' | 'doc' | 'sheet' | 'slide' | 'archive' | 'folder'", false, 'Lọc theo loại', 'Filter by kind'),
        p.query('accountId', 'string', false, 'Chỉ tệp của một tài khoản lưu trữ', 'Only one storage account'),
        p.query('minSize / maxSize', 'number', false, 'Khoảng dung lượng (byte)', 'Size range in bytes'),
        p.query('startDate / endDate', 'ISO datetime', false, 'Khoảng ngày sửa', 'Modified date range'),
        p.query('sort / order', "'name'|'modified'|'size'|'createdAt' / 'asc'|'desc'", false, 'Sắp xếp', 'Sorting'),
        p.query('scope', "'all'", false, 'Mọi thư mục (không chỉ gốc)', 'Every folder, not only the root'),
        p.query('limit', '1–1000', false, 'Số kết quả tối đa', 'Maximum results'),
      ],
      queryExample: '?q=report&content=1&sort=modified&order=desc',
      responseExample: json({ files: [{ ...fileExample, webViewLink: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view', thumbnailUrl: `/public/thumbnails/${ID}.1793750400.sig` }] }),
    },
    {
      id: 'files-get', method: 'GET', path: '/files/:id', category: 'files', ...bearer,
      titleVi: 'Chi tiết một tệp', titleEn: 'Get a file', descVi: 'Thông tin tệp kèm tài khoản lưu trữ và thư mục.', descEn: 'File metadata with its storage account and folder.',
      params: [p.path('id', 'ID tệp (hoặc ID tệp trên Google Drive)', 'File ID (or the Google Drive file ID)')],
      responseExample: json({ file: { ...fileExample, connectedAccount: { email: 'me@gmail.com', provider: 'google_drive' }, folder: null } }),
      errorStatus: 404, errorExample: err('FILE_NOT_FOUND', 'File not found.'),
    },
    {
      id: 'files-update', method: 'PATCH', path: '/files/:id', category: 'files', ...bearer,
      titleVi: 'Đổi tên / di chuyển tệp', titleEn: 'Rename / move a file', descVi: 'Chỉ chủ sở hữu được sửa; tệp của người khác trả 404.', descEn: 'Owner only; someone else\'s file returns 404.',
      params: [p.path('id', 'ID tệp', 'File ID'), p.body('name', 'string', false, 'Tên mới (1–255 ký tự)', 'New name'), p.body('folderId', 'string | null', false, 'Thư mục mới, null = gốc', 'New folder, null = root')],
      bodyExample: json({ name: 'bao-cao-2026.pdf', folderId: null }),
      responseExample: json({ file: { ...fileExample, name: 'bao-cao-2026.pdf' } }),
      errorStatus: 404, errorExample: NOT_FOUND('FILE_NOT_FOUND'),
    },
    {
      id: 'files-delete', method: 'DELETE', path: '/files/:id', category: 'files', ...bearer,
      titleVi: 'Chuyển tệp vào thùng rác', titleEn: 'Move a file to the trash', descVi: 'Khôi phục được qua /files/batch/restore.', descEn: 'Restorable with /files/batch/restore.',
      params: [p.path('id', 'ID tệp', 'File ID')], responseExample: OK,
    },
    {
      id: 'files-download', method: 'GET', path: '/files/:id/download', category: 'files', ...bearer, binary: true,
      titleVi: 'Tải tệp xuống (stream)', titleEn: 'Download a file (stream)',
      descVi: 'Truyền thẳng từ Google Drive / S3, hỗ trợ header Range. Google Docs được xuất sang PDF/XLSX mặc định, hoặc định dạng chọn bằng format (xem /files/:id/export-formats).',
      descEn: 'Streams from Google Drive / S3 and honours Range. Google Docs export to PDF/XLSX by default, or to format (see /files/:id/export-formats).',
      params: [p.path('id', 'ID tệp', 'File ID'), p.query('format', 'MIME type', false, 'Định dạng xuất cho Google Docs/Sheets/Slides', 'Export format for Google Docs'), p.header('Range', false, 'Tải một đoạn, ví dụ bytes=0-1048575', 'Partial download, e.g. bytes=0-1048575')],
      responseExample: 'HTTP/1.1 200 OK\nContent-Type: application/pdf\nContent-Disposition: attachment; filename="report.pdf"\nAccept-Ranges: bytes\n\n(binary stream)',
      errorStatus: 404, errorExample: err('FILE_NOT_FOUND', 'Tệp đã bị xóa trên Google Drive.'),
    },
    {
      id: 'files-star', method: 'POST', path: '/files/:id/star', category: 'files', ...bearer,
      titleVi: 'Gắn / bỏ dấu sao', titleEn: 'Star / unstar', descVi: 'Không gửi starred thì đảo trạng thái hiện tại. Đồng bộ với dấu sao trên Google Drive.', descEn: 'Without starred it toggles. Synced with Google Drive stars.',
      params: [p.path('id', 'ID tệp', 'File ID'), p.body('starred', 'boolean', false, 'Trạng thái mong muốn', 'Desired state')],
      bodyExample: json({ starred: true }), responseExample: json({ status: 'ok', starred: true }),
    },
    { id: 'files-recent', method: 'GET', path: '/files/recent', category: 'files', ...bearer, titleVi: 'Tệp gần đây', titleEn: 'Recent files', descVi: 'Tối đa 50 tệp mới sửa gần nhất trên mọi tài khoản.', descEn: 'Up to 50 most recently modified files across accounts.', responseExample: json({ files: [{ id: '1AbC…', name: 'report.pdf', mimeType: 'application/pdf', modifiedTime: NOW, accountEmail: 'me@gmail.com' }] }) },
    { id: 'files-starred', method: 'GET', path: '/files/starred', category: 'files', ...bearer, titleVi: 'Tệp có gắn dấu sao', titleEn: 'Starred files', descVi: 'Tệp và thư mục đã gắn sao.', descEn: 'Starred files and folders.', responseExample: json({ files: [{ id: ID, providerFileId: '1AbC…', name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: '1048576', modifiedTime: NOW, starredTime: NOW }] }) },
    {
      id: 'files-trash', method: 'GET', path: '/files/trash', category: 'files', ...bearer, titleVi: 'Thùng rác', titleEn: 'Trash', descVi: 'Tệp đã xoá tạm, lọc theo tên bằng q.', descEn: 'Trashed files, filter by name with q.',
      params: [p.query('q', 'string', false, 'Lọc theo tên', 'Name filter')], responseExample: json({ files: [{ ...fileExample, status: 'deleted', deletedAt: NOW }] }),
    },
    {
      id: 'files-batch-move', method: 'PATCH', path: '/files/batch', category: 'files', ...bearer, titleVi: 'Di chuyển nhiều tệp', titleEn: 'Move several files', descVi: 'Tối đa 100 tệp mỗi lần.', descEn: 'Up to 100 files per call.',
      params: [p.body('fileIds', 'string[]', true, 'Danh sách ID (1–100)', 'IDs (1–100)'), p.body('folderId', 'string | null', false, 'Thư mục đích', 'Target folder')],
      bodyExample: json({ fileIds: [ID, ID2], folderId: null }), responseExample: json({ status: 'ok', moved: 2 }),
    },
    {
      id: 'files-batch-delete', method: 'DELETE', path: '/files/batch', category: 'files', ...bearer, titleVi: 'Chuyển nhiều tệp vào thùng rác', titleEn: 'Trash several files', descVi: 'Tối đa 100 tệp.', descEn: 'Up to 100 files.',
      params: [p.body('fileIds', 'string[]', true, 'Danh sách ID', 'IDs')], bodyExample: json({ fileIds: [ID] }), responseExample: json({ status: 'ok', deleted: 1 }),
    },
    {
      id: 'files-batch-restore', method: 'POST', path: '/files/batch/restore', category: 'files', ...bearer, titleVi: 'Khôi phục từ thùng rác', titleEn: 'Restore from the trash', descVi: 'Khôi phục cả trên Google Drive.', descEn: 'Also restores on Google Drive.',
      params: [p.body('fileIds', 'string[]', true, 'Danh sách ID', 'IDs')], bodyExample: json({ fileIds: [ID] }), responseExample: json({ status: 'ok', restored: 1 }),
    },
    {
      id: 'files-batch-permanent', method: 'DELETE', path: '/files/batch/permanent', category: 'files', ...bearer, titleVi: 'Xoá vĩnh viễn', titleEn: 'Delete permanently', descVi: 'Xoá hẳn khỏi Google Drive / S3, không khôi phục được. failed liệt kê tệp không xoá được.', descEn: 'Deletes from Google Drive / S3 for good. failed lists what could not be deleted.',
      params: [p.body('fileIds', 'string[]', true, 'Danh sách ID', 'IDs')], bodyExample: json({ fileIds: [ID] }), responseExample: json({ status: 'ok', deleted: 1, failed: [] }),
      errorStatus: 400, errorExample: json({ code: 'FILES_DELETE_FAILED', message: 'No files were permanently deleted.', deleted: 0, failed: [{ id: ID, message: 'Insufficient permissions' }] }),
    },
    {
      id: 'files-batch-download', method: 'POST', path: '/files/batch-download', category: 'files', ...bearer, binary: true, titleVi: 'Tải nhiều tệp thành ZIP', titleEn: 'Download several files as a ZIP', descVi: 'Nén trong lúc truyền, không ghi đĩa máy chủ.', descEn: 'Zipped while streaming, nothing written to disk.',
      params: [p.body('fileIds', 'string[]', true, 'Danh sách ID (1–100)', 'IDs (1–100)')], bodyExample: json({ fileIds: [ID, ID2] }),
      responseExample: 'Content-Type: application/zip\nContent-Disposition: attachment; filename="HCDrive.zip"\n\n(binary stream)', errorStatus: 404, errorExample: err('FILES_NOT_FOUND', 'No files found.'),
    },
    {
      id: 'files-sync-google', method: 'POST', path: '/files/sync-google', category: 'files', ...bearer, titleVi: 'Đồng bộ với Google Drive', titleEn: 'Sync with Google Drive', descVi: 'Lấy thay đổi mới từ Google Drive (Changes API). force = true quét lại toàn bộ.', descEn: 'Pulls changes from Google Drive (Changes API). force = true rescans everything.',
      params: [p.body('connectedAccountId', 'string', false, 'Chỉ một tài khoản', 'Only one account'), p.body('force', 'boolean', false, 'Quét toàn bộ', 'Full rescan')],
      bodyExample: json({ force: false }), responseExample: json({ status: 'ok', results: [{ accountId: ID2, created: 4, updated: 1, deleted: 0 }] }),
    },
    {
      id: 'files-view-url', method: 'GET', path: '/files/:id/view-url', category: 'files', ...bearer, titleVi: 'Link mở trên Google Drive', titleEn: 'Google Drive view link', descVi: 'null với tệp S3.', descEn: 'null for S3 files.',
      params: [p.path('id', 'ID tệp', 'File ID')], responseExample: json({ url: 'https://drive.google.com/file/d/1AbC…/view' }),
    },
    {
      id: 'files-preview-token', method: 'POST', path: '/files/:id/preview-token', category: 'files', ...bearer, titleVi: 'Tạo link xem trước ngắn hạn', titleEn: 'Short-lived preview link', descVi: 'URL dùng được trong <video>, <img>, <iframe> mà không cần header, hết hạn sau 10 phút.', descEn: 'A URL usable in <video>, <img>, <iframe> without headers; expires in 10 minutes.',
      params: [p.path('id', 'ID tệp', 'File ID')], successStatus: 201, responseExample: json({ path: '/files/preview/5f2c…', url: 'https://drive.example.com/files/preview/5f2c…', webViewLink: 'https://drive.google.com/file/d/1AbC…/view' }),
    },
    {
      id: 'files-preview', method: 'GET', path: '/files/preview/:token', category: 'files', ...open, binary: true, titleVi: 'Xem trước bằng token', titleEn: 'Preview by token', descVi: 'Stream nội dung inline, hỗ trợ Range (tua video).', descEn: 'Streams inline, honours Range (video seeking).',
      params: [p.path('token', 'Token từ /preview-token', 'Token from /preview-token')], responseExample: 'Content-Type: video/mp4\nContent-Disposition: inline\nAccept-Ranges: bytes\n\n(binary stream)', errorStatus: 404, errorExample: err('PREVIEW_NOT_FOUND', 'Preview token not found.'),
    },

    // =============================== FOLDERS ===============================
    {
      id: 'folders-list', method: 'GET', path: '/folders', category: 'folders', ...bearer,
      titleVi: 'Danh sách thư mục', titleEn: 'List folders',
      descVi: 'Thư mục con của parentId (trống = gốc). Thư mục cùng tên ở nhiều tài khoản được gộp thành một. all=1 trả toàn bộ cây (cho breadcrumb, hộp di chuyển).',
      descEn: 'Children of parentId (empty = root). Same-named folders across accounts are merged. all=1 returns the whole tree.',
      params: [
        p.query('parentId', 'string', false, 'Thư mục cha', 'Parent folder'),
        p.query('all', "'1'", false, 'Lấy toàn bộ cây', 'Whole tree'),
        p.query('q', 'string', false, 'Tìm theo tên', 'Name search'),
        p.query('accountId', 'string', false, 'Chỉ một tài khoản', 'Only one account'),
        p.query('startDate / endDate', 'ISO datetime', false, 'Khoảng ngày sửa', 'Modified date range'),
      ],
      queryExample: '?parentId=' + ID,
      responseExample: json({ folders: [folderExample] }),
    },
    { id: 'folders-recent', method: 'GET', path: '/folders/recent', category: 'folders', ...bearer, titleVi: 'Thư mục gần đây', titleEn: 'Recent folders', descVi: 'Thư mục mới sửa gần nhất.', descEn: 'Most recently changed folders.', params: [p.query('limit', 'number', false, 'Số lượng', 'Count')], queryExample: '?limit=4', responseExample: json({ folders: [folderExample] }) },
    {
      id: 'folders-create', method: 'POST', path: '/folders', category: 'folders', ...bearer, titleVi: 'Tạo thư mục', titleEn: 'Create a folder', descVi: 'Tạo cả trên Google Drive, trong tài khoản của thư mục cha.', descEn: 'Also created on Google Drive, in the parent\'s account.',
      params: [p.body('name', 'string', true, 'Tên (1–255 ký tự)', 'Name'), p.body('parentId', 'string | null', false, 'Thư mục cha', 'Parent'), p.body('color', 'hex color', false, 'Màu thư mục', 'Folder colour'), p.body('iconUrl', 'string | null', false, 'Biểu tượng tuỳ chỉnh', 'Custom icon')],
      bodyExample: json({ name: 'Hợp đồng', parentId: null, color: '#1a73e8' }), successStatus: 201, responseExample: json({ folder: { ...folderExample, name: 'Hợp đồng', color: '#1a73e8' } }),
    },
    {
      id: 'folders-update', method: 'PATCH', path: '/folders/:id', category: 'folders', ...bearer, titleVi: 'Đổi tên / màu / di chuyển thư mục', titleEn: 'Rename / recolour / move a folder', descVi: 'Không di chuyển được vào chính nó hoặc thư mục con của nó.', descEn: 'Cannot move into itself or a descendant.',
      params: [p.path('id', 'ID thư mục', 'Folder ID'), p.body('name', 'string', false, 'Tên mới', 'New name'), p.body('parentId', 'string | null', false, 'Thư mục cha mới', 'New parent'), p.body('color', 'hex color', false, 'Màu', 'Colour')],
      bodyExample: json({ name: 'Hợp đồng 2026' }), responseExample: json({ folder: { ...folderExample, name: 'Hợp đồng 2026' } }), errorStatus: 400, errorExample: err('FOLDER_INVALID_PARENT', 'Folder cannot be moved into itself or a child folder.'),
    },
    { id: 'folders-delete', method: 'DELETE', path: '/folders/:id', category: 'folders', ...bearer, titleVi: 'Xoá thư mục', titleEn: 'Delete a folder', descVi: 'Chuyển thư mục và mọi thứ bên trong vào thùng rác.', descEn: 'Moves the folder and its contents to the trash.', params: [p.path('id', 'ID thư mục', 'Folder ID')], responseExample: OK },
    {
      id: 'folders-refresh', method: 'POST', path: '/folders/refresh', category: 'folders', ...bearer, titleVi: 'Làm mới từ Google Drive', titleEn: 'Refresh from Google Drive', descVi: 'Đọc trực tiếp một thư mục trên Google Drive để thấy ngay thay đổi vừa làm bên ngoài HCDrive.', descEn: 'Reads one folder straight from Google Drive to pick up outside changes.',
      params: [p.body('parentId', 'string | null', false, 'Thư mục cần làm mới, null = gốc', 'Folder to refresh, null = root')], bodyExample: json({ parentId: null }), responseExample: json({ changed: true, errors: [] }),
    },
    {
      id: 'folders-download', method: 'GET', path: '/folders/:id/download', category: 'folders', ...bearer, binary: true, titleVi: 'Tải thư mục thành ZIP', titleEn: 'Download a folder as a ZIP', descVi: 'Gồm mọi thư mục con, nén trong lúc truyền.', descEn: 'Includes every subfolder, zipped while streaming.',
      params: [p.path('id', 'ID thư mục', 'Folder ID')], responseExample: 'Content-Type: application/zip\nContent-Disposition: attachment; filename="Tài liệu.zip"\n\n(binary stream)', errorStatus: 404, errorExample: err('FOLDER_EMPTY', 'Thư mục không có tệp nào để tải xuống.'),
    },
    { id: 'home-suggestions', method: 'GET', path: '/home/suggestions', category: 'folders', ...bearer, titleVi: 'Gợi ý ở Trang chủ', titleEn: 'Home suggestions', descVi: 'Thư mục và tệp đề xuất cho Trang chủ, lấy từ hoạt động gần đây trên Google Drive.', descEn: 'Suggested folders and files for the home page.', responseExample: json({ folders: [{ ...folderExample, updated: NOW }], files: [] }) },

    // =============================== GOOGLE DRIVE FEATURES ===============================
    {
      id: 'drive-new-doc', method: 'POST', path: '/files/google-doc', category: 'drive', ...bearer, titleVi: 'Tạo Google Docs / Sheets / Slides / Forms', titleEn: 'Create a Google Doc / Sheet / Slide / Form', descVi: 'Tạo tệp Google mới, trả về webViewLink để mở trình soạn thảo.', descEn: 'Creates a new Google file and returns the editor link.',
      params: [p.body('kind', "'document' | 'spreadsheet' | 'presentation' | 'form'", true, 'Loại tệp', 'Kind'), p.body('name', 'string', false, 'Tên', 'Name'), p.body('folderId', 'string | null', false, 'Thư mục', 'Folder'), p.body('accountId', 'string', false, 'Tài khoản Google', 'Google account')],
      bodyExample: json({ kind: 'document', name: 'Biên bản họp', folderId: null }), successStatus: 201, responseExample: json({ file: { ...fileExample, name: 'Biên bản họp', mimeType: 'application/vnd.google-apps.document' }, webViewLink: 'https://docs.google.com/document/d/1DoC…/edit' }),
    },
    { id: 'drive-copy', method: 'POST', path: '/files/:id/copy', category: 'drive', ...bearer, titleVi: 'Tạo bản sao', titleEn: 'Make a copy', descVi: 'Bản sao nằm cùng thư mục, mặc định tên "Bản sao của …".', descEn: 'The copy goes in the same folder.', params: [p.path('id', 'ID tệp', 'File ID'), p.body('name', 'string', false, 'Tên bản sao', 'Copy name')], bodyExample: json({ name: 'report (bản sao).pdf' }), successStatus: 201, responseExample: json({ file: { ...fileExample, name: 'report (bản sao).pdf' } }) },
    { id: 'drive-export-formats', method: 'GET', path: '/files/:id/export-formats', category: 'drive', ...bearer, titleVi: 'Định dạng xuất của Google Docs', titleEn: 'Export formats', descVi: 'Các định dạng dùng được cho /files/:id/download?format=…', descEn: 'Formats usable with /files/:id/download?format=…', params: [p.path('id', 'ID tệp', 'File ID')], responseExample: json({ formats: [{ mimeType: 'application/pdf', extension: '.pdf' }, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' }] }) },
    { id: 'drive-shortcut', method: 'POST', path: '/files/:id/shortcut', category: 'drive', ...bearer, titleVi: 'Tạo lối tắt', titleEn: 'Create a shortcut', descVi: 'Lối tắt nằm trong cùng tài khoản với tệp gốc.', descEn: 'The shortcut lives in the same account as the target.', params: [p.path('id', 'ID tệp', 'File ID'), p.body('folderId', 'string | null', true, 'Thư mục chứa lối tắt', 'Folder for the shortcut')], bodyExample: json({ folderId: null }), successStatus: 201, responseExample: json({ file: { ...fileExample, mimeType: 'application/vnd.google-apps.shortcut' } }) },
    { id: 'drive-details', method: 'GET', path: '/files/:id/drive-details', category: 'drive', ...bearer, titleVi: 'Chi tiết từ Google Drive', titleEn: 'Google Drive details', descVi: 'Mô tả, người sửa cuối, thông số ảnh/video, khoá nội dung, quyền hạn.', descEn: 'Description, last modifier, image/video facts, content lock, capabilities.', params: [p.path('id', 'ID tệp', 'File ID')], responseExample: json({ details: { id: '1AbC…', name: 'report.pdf', description: '', md5Checksum: '9e107d9d…', capabilities: { canEdit: true, canDownload: true } }, accountEmail: 'me@gmail.com', canModify: true }) },
    { id: 'drive-details-update', method: 'PATCH', path: '/files/:id/drive-details', category: 'drive', ...bearer, titleVi: 'Sửa mô tả tệp', titleEn: 'Edit the description', descVi: 'Tối đa 25.000 ký tự.', descEn: 'Up to 25,000 characters.', params: [p.path('id', 'ID tệp', 'File ID'), p.body('description', 'string', true, 'Mô tả', 'Description')], bodyExample: json({ description: 'Báo cáo quý 4' }), responseExample: OK },
    { id: 'drive-lock', method: 'POST', path: '/files/:id/lock', category: 'drive', ...bearer, titleVi: 'Khoá / mở khoá tệp', titleEn: 'Lock / unlock', descVi: 'Khoá nội dung trên Google Drive (chỉ đọc).', descEn: 'Google Drive content restriction (read-only).', params: [p.path('id', 'ID tệp', 'File ID'), p.body('locked', 'boolean', true, 'Khoá hay mở', 'Lock or unlock'), p.body('reason', 'string', false, 'Lý do', 'Reason')], bodyExample: json({ locked: true, reason: 'Bản chốt' }), responseExample: json({ status: 'ok', locked: true }) },
    { id: 'drive-comments', method: 'GET', path: '/files/:id/comments', category: 'drive', ...bearer, titleVi: 'Bình luận', titleEn: 'Comments', descVi: 'Bình luận và trả lời trên Google Drive.', descEn: 'Google Drive comments with replies.', params: [p.path('id', 'ID tệp', 'File ID')], responseExample: json({ comments: [{ id: 'AAAA', content: 'Xem lại trang 3', resolved: false, author: { displayName: 'A', me: true }, replies: [] }] }) },
    { id: 'drive-comment-add', method: 'POST', path: '/files/:id/comments', category: 'drive', ...bearer, titleVi: 'Thêm bình luận', titleEn: 'Add a comment', descVi: 'Tối đa 20.000 ký tự.', descEn: 'Up to 20,000 characters.', params: [p.path('id', 'ID tệp', 'File ID'), p.body('content', 'string', true, 'Nội dung', 'Text')], bodyExample: json({ content: 'Đã duyệt' }), successStatus: 201, responseExample: json({ comment: { id: 'AAAB', content: 'Đã duyệt' } }) },
    { id: 'drive-comment-reply', method: 'POST', path: '/files/:id/comments/:commentId/replies', category: 'drive', ...bearer, titleVi: 'Trả lời / đóng / mở lại bình luận', titleEn: 'Reply / resolve / reopen', descVi: 'Gửi content, hoặc action = resolve / reopen.', descEn: 'Send content, or action = resolve / reopen.', params: [p.path('id', 'ID tệp', 'File ID'), p.path('commentId', 'ID bình luận', 'Comment ID'), p.body('content', 'string', false, 'Nội dung trả lời', 'Reply text'), p.body('action', "'resolve' | 'reopen'", false, 'Đóng hoặc mở lại', 'Resolve or reopen')], bodyExample: json({ action: 'resolve' }), successStatus: 201, responseExample: json({ reply: { id: 'BBBB', action: 'resolve' } }) },
    { id: 'drive-comment-delete', method: 'DELETE', path: '/files/:id/comments/:commentId', category: 'drive', ...bearer, titleVi: 'Xoá bình luận', titleEn: 'Delete a comment', descVi: 'Chỉ xoá được bình luận của mình.', descEn: 'Only your own comments.', params: [p.path('id', 'ID tệp', 'File ID'), p.path('commentId', 'ID bình luận', 'Comment ID')], responseExample: OK },
    { id: 'drive-revisions', method: 'GET', path: '/files/:id/revisions', category: 'drive', ...bearer, titleVi: 'Các phiên bản', titleEn: 'Versions', descVi: 'Lịch sử phiên bản trên Google Drive.', descEn: 'Google Drive version history.', params: [p.path('id', 'ID tệp', 'File ID')], responseExample: json({ revisions: [{ id: '0B7…', modifiedTime: NOW, keepForever: false, size: '1048576', originalFilename: 'report.pdf' }], isGoogleDoc: false, canModify: true }) },
    { id: 'drive-revision-download', method: 'GET', path: '/files/:id/revisions/:revisionId/download', category: 'drive', ...bearer, binary: true, titleVi: 'Tải một phiên bản', titleEn: 'Download a version', descVi: 'Google Docs cần format (MIME xuất).', descEn: 'Google Docs need format (export MIME).', params: [p.path('id', 'ID tệp', 'File ID'), p.path('revisionId', 'ID phiên bản', 'Revision ID'), p.query('format', 'MIME type', false, 'Định dạng xuất', 'Export format')], responseExample: 'Content-Disposition: attachment; filename="report.pdf"\n\n(binary stream)' },
    { id: 'drive-revision-keep', method: 'PATCH', path: '/files/:id/revisions/:revisionId', category: 'drive', ...bearer, titleVi: 'Giữ vĩnh viễn một phiên bản', titleEn: 'Keep a version forever', descVi: 'Google tự xoá phiên bản cũ sau 30 ngày trừ khi keepForever.', descEn: 'Google prunes old versions after 30 days unless keepForever.', params: [p.path('id', 'ID tệp', 'File ID'), p.path('revisionId', 'ID phiên bản', 'Revision ID'), p.body('keepForever', 'boolean', true, 'Giữ vĩnh viễn', 'Keep forever')], bodyExample: json({ keepForever: true }), responseExample: OK },
    { id: 'drive-revision-delete', method: 'DELETE', path: '/files/:id/revisions/:revisionId', category: 'drive', ...bearer, titleVi: 'Xoá một phiên bản', titleEn: 'Delete a version', descVi: 'Không xoá được phiên bản duy nhất.', descEn: 'The only version cannot be deleted.', params: [p.path('id', 'ID tệp', 'File ID'), p.path('revisionId', 'ID phiên bản', 'Revision ID')], responseExample: OK },
    { id: 'drive-revision-restore', method: 'POST', path: '/files/:id/revisions/:revisionId/restore', category: 'drive', ...bearer, titleVi: 'Khôi phục một phiên bản', titleEn: 'Restore a version', descVi: 'Tải lại nội dung phiên bản đó thành phiên bản mới nhất.', descEn: 'Re-uploads that version as the newest one.', params: [p.path('id', 'ID tệp', 'File ID'), p.path('revisionId', 'ID phiên bản', 'Revision ID')], responseExample: OK },
    { id: 'drive-empty-trash', method: 'POST', path: '/connected-accounts/:id/empty-trash', category: 'drive', ...bearer, titleVi: 'Dọn thùng rác Google Drive', titleEn: 'Empty the Google Drive trash', descVi: 'Xoá vĩnh viễn mọi thứ trong thùng rác của tài khoản Google đó.', descEn: 'Permanently empties that Google account\'s trash.', params: [p.path('id', 'ID tài khoản lưu trữ', 'Storage account ID')], responseExample: json({ status: 'ok', removed: 12 }) },

    // =============================== SHARING ===============================
    { id: 'share-create', method: 'POST', path: '/files/:id/share', category: 'sharing', ...bearer, titleVi: 'Tạo link chia sẻ công khai', titleEn: 'Create a public link', descVi: 'Ai có link đều xem / tải được qua HCDrive, không cần tài khoản Google. Gọi lại trả về link đang có.', descEn: 'Anyone with the link can view / download through HCDrive. Calling again returns the existing link.', params: [p.path('id', 'ID tệp', 'File ID')], successStatus: 201, responseExample: json({ url: 'https://drive.example.com/public/files/Zx81…', shareId: ID, webViewLink: 'https://drive.google.com/file/d/1AbC…/view' }) },
    { id: 'share-get', method: 'GET', path: '/files/:id/share', category: 'sharing', ...bearer, titleVi: 'Link chia sẻ hiện có', titleEn: 'Current public link', descVi: 'null nếu chưa chia sẻ.', descEn: 'null when not shared.', params: [p.path('id', 'ID tệp', 'File ID')], responseExample: json({ url: 'https://drive.example.com/public/files/Zx81…' }) },
    { id: 'share-delete', method: 'DELETE', path: '/files/:id/share', category: 'sharing', ...bearer, titleVi: 'Tắt link chia sẻ', titleEn: 'Turn off the public link', descVi: 'Link cũ trả 404 ngay.', descEn: 'The old link returns 404 at once.', params: [p.path('id', 'ID tệp', 'File ID')], responseExample: OK },
    { id: 'share-links', method: 'GET', path: '/files/shared-links', category: 'sharing', ...bearer, titleVi: 'Mọi link chia sẻ của tôi', titleEn: 'All my public links', descVi: 'Link còn hiệu lực, kèm tệp.', descEn: 'Active links with their files.', responseExample: json({ shares: [{ id: ID, url: 'https://drive.example.com/public/files/Zx81…', createdAt: NOW, expiresAt: null, file: fileExample }] }) },
    { id: 'share-with-me', method: 'GET', path: '/files/shared-with-me', category: 'sharing', ...bearer, titleVi: 'Được chia sẻ với tôi', titleEn: 'Shared with me', descVi: 'Những gì người khác chia sẻ cho các tài khoản Google đã kết nối.', descEn: 'What others shared with your connected Google accounts.', params: [p.query('accountId', 'string', false, 'Chỉ một tài khoản', 'Only one account')], responseExample: json({ items: [{ id: '1XyZ…', name: 'Khóa React', mimeType: 'application/vnd.google-apps.folder', ownerName: 'Thầy A', ownerEmail: 'teacher@example.com', accountId: ID2, accountEmail: 'me@gmail.com', sharedWithMeTime: NOW, isFolder: true }] }) },
    { id: 'share-by-me', method: 'GET', path: '/files/shared-by-me', category: 'sharing', ...bearer, titleVi: 'Tôi đã chia sẻ', titleEn: 'Shared by me', descVi: 'Tệp trên Google Drive bạn đã chia sẻ cho người khác.', descEn: 'Your Google Drive files shared with others.', params: [p.query('accountId', 'string', false, 'Chỉ một tài khoản', 'Only one account')], responseExample: json({ items: [{ id: '1AbC…', hcdriveId: ID, name: 'report.pdf', mimeType: 'application/pdf', sharedWith: 'b@example.com, c@example.com', accountEmail: 'me@gmail.com' }], nextPageToken: null }) },
    { id: 'share-public-permission', method: 'POST', path: '/files/:id/public-permission', category: 'sharing', ...bearer, titleVi: 'Mở quyền "ai có link" trên Google Drive', titleEn: 'Make it public on Google Drive', descVi: 'Thêm quyền anyone-with-link (người xem) trực tiếp trên Google Drive.', descEn: 'Adds an anyone-with-link reader permission on Google Drive.', params: [p.path('id', 'ID tệp', 'File ID')], responseExample: json({ status: 'ok', url: 'https://drive.google.com/file/d/1AbC…/view' }) },
    { id: 'perm-list', method: 'GET', path: '/files/:id/drive-permissions', category: 'sharing', ...bearer, titleVi: 'Quyền truy cập trên Google Drive', titleEn: 'Google Drive permissions', descVi: 'Cũng có cho thư mục: /folders/:id/drive-permissions (và các route con bên dưới).', descEn: 'Also for folders: /folders/:id/drive-permissions (and the sub-routes below).', params: [p.path('id', 'ID tệp hoặc thư mục', 'File or folder ID')], responseExample: json({ name: 'report.pdf', accountId: ID2, accountEmail: 'me@gmail.com', webViewLink: 'https://drive.google.com/file/d/1AbC…/view', canShare: true, canManage: true, copyRequiresWriterPermission: false, permissions: [{ id: '0123', type: 'user', role: 'owner', emailAddress: 'me@gmail.com', displayName: 'Me', inherited: false, expirationTime: null }] }) },
    {
      id: 'perm-add', method: 'POST', path: '/files/:id/drive-permissions', category: 'sharing', ...bearer, titleVi: 'Chia sẻ với người / mọi người có link', titleEn: 'Share with a person / anyone with the link', descVi: 'type = user cần emailAddress. type = anyone đặt quyền truy cập chung. expirationTime giới hạn thời hạn (chỉ cho người, trong vòng 1 năm).', descEn: 'type = user needs emailAddress. type = anyone sets general access. expirationTime ends access (people only, within a year).',
      params: [p.path('id', 'ID tệp hoặc thư mục', 'File or folder ID'), p.body('type', "'user' | 'anyone'", true, 'Người cụ thể hay ai có link', 'A person or anyone with the link'), p.body('role', "'reader' | 'commenter' | 'writer'", true, 'Quyền', 'Role'), p.body('emailAddress', 'string', false, 'Email người nhận', 'Recipient email'), p.body('sendNotificationEmail', 'boolean', false, 'Gửi email báo', 'Send a notification email'), p.body('emailMessage', 'string', false, 'Lời nhắn', 'Message'), p.body('expirationTime', 'ISO datetime | null', false, 'Hết hạn truy cập', 'Access expiry')],
      bodyExample: json({ type: 'user', role: 'reader', emailAddress: 'b@example.com', sendNotificationEmail: true, expirationTime: '2026-12-31T23:59:00.000Z' }), successStatus: 201, responseExample: json({ permission: { id: '0456', type: 'user', role: 'reader', emailAddress: 'b@example.com', expirationTime: '2026-12-31T23:59:00.000Z', inherited: false } }),
    },
    { id: 'perm-update', method: 'PATCH', path: '/files/:id/drive-permissions/:permissionId', category: 'sharing', ...bearer, titleVi: 'Đổi quyền / thời hạn', titleEn: 'Change role / expiry', descVi: 'expirationTime = null để bỏ thời hạn.', descEn: 'expirationTime = null removes the expiry.', params: [p.path('id', 'ID tệp hoặc thư mục', 'File or folder ID'), p.path('permissionId', 'ID quyền', 'Permission ID'), p.body('role', "'reader' | 'commenter' | 'writer'", true, 'Quyền mới', 'New role'), p.body('expirationTime', 'ISO datetime | null', false, 'Thời hạn', 'Expiry')], bodyExample: json({ role: 'writer', expirationTime: null }), responseExample: json({ permission: { id: '0456', role: 'writer', expirationTime: null } }) },
    { id: 'perm-delete', method: 'DELETE', path: '/files/:id/drive-permissions/:permissionId', category: 'sharing', ...bearer, titleVi: 'Gỡ quyền truy cập', titleEn: 'Remove access', descVi: 'Người đó không mở được nữa.', descEn: 'That person loses access.', params: [p.path('id', 'ID tệp hoặc thư mục', 'File or folder ID'), p.path('permissionId', 'ID quyền', 'Permission ID')], responseExample: OK },
    { id: 'perm-transfer', method: 'POST', path: '/files/:id/drive-permissions/:permissionId/transfer-ownership', category: 'sharing', ...bearer, titleVi: 'Chuyển quyền sở hữu', titleEn: 'Transfer ownership', descVi: 'Cùng tổ chức: chuyển ngay (mode = transferred). Gmail cá nhân: gửi lời mời, người nhận phải chấp nhận (mode = pending).', descEn: 'Same organisation: immediate (mode = transferred). Personal Gmail: an invitation the recipient accepts (mode = pending).', params: [p.path('id', 'ID tệp', 'File ID'), p.path('permissionId', 'ID quyền của người nhận', 'Recipient permission ID')], responseExample: json({ status: 'ok', mode: 'pending' }) },
    { id: 'perm-settings', method: 'PATCH', path: '/files/:id/drive-settings', category: 'sharing', ...bearer, titleVi: 'Chặn tải xuống / sao chép', titleEn: 'Block download / copy', descVi: 'copyRequiresWriterPermission = true: người xem và người bình luận không tải, in, sao chép được.', descEn: 'copyRequiresWriterPermission = true: viewers and commenters cannot download, print or copy.', params: [p.path('id', 'ID tệp', 'File ID'), p.body('copyRequiresWriterPermission', 'boolean', true, 'Bật / tắt', 'On / off')], bodyExample: json({ copyRequiresWriterPermission: true }), responseExample: OK },
    { id: 'invites-list', method: 'GET', path: '/invites', category: 'sharing', ...bearer, titleVi: 'Lời mời trong HCDrive', titleEn: 'HCDrive invites', descVi: 'sent: lời mời bạn gửi; received: lời mời bạn nhận.', descEn: 'sent: invites you sent; received: invites you got.', responseExample: json({ sent: [{ id: ID, email: 'b@example.com', role: 'viewer', status: 'pending', targetType: 'file', targetId: ID2, target: { name: 'report.pdf' }, createdAt: NOW }], received: [] }) },
    { id: 'invites-create', method: 'POST', path: '/invites', category: 'sharing', ...bearer, titleVi: 'Mời người dùng HCDrive', titleEn: 'Invite an HCDrive user', descVi: 'Cấp quyền xem hoặc sửa một tệp / thư mục cho người dùng khác trong HCDrive.', descEn: 'Gives another HCDrive user view or edit access to a file / folder.', params: [p.body('email', 'string', true, 'Email người được mời', 'Invitee email'), p.body('role', "'viewer' | 'editor'", false, 'Mặc định viewer', 'Default viewer'), p.body('targetType', "'file' | 'folder'", true, 'Loại đối tượng', 'Target type'), p.body('targetId', 'string', true, 'ID tệp / thư mục', 'File / folder ID')], bodyExample: json({ email: 'b@example.com', role: 'viewer', targetType: 'folder', targetId: ID }), successStatus: 201, responseExample: json({ invite: { id: ID2, email: 'b@example.com', role: 'viewer', targetType: 'folder', targetId: ID } }), errorStatus: 400, errorExample: err('INVITE_SELF_NOT_ALLOWED', 'You cannot invite yourself.') },
    { id: 'invites-delete', method: 'DELETE', path: '/invites/:id', category: 'sharing', ...bearer, titleVi: 'Huỷ lời mời', titleEn: 'Revoke an invite', descVi: 'Người nhận mất quyền ngay.', descEn: 'Access ends at once.', params: [p.path('id', 'ID lời mời', 'Invite ID')], responseExample: OK },
    { id: 'public-file', method: 'GET', path: '/public/files/:token', category: 'sharing', ...open, titleVi: 'Thông tin tệp chia sẻ công khai', titleEn: 'Public file info', descVi: 'Không cần đăng nhập.', descEn: 'No sign-in needed.', params: [p.path('token', 'Token trong link chia sẻ', 'Token from the share link')], responseExample: json({ file: { id: ID, name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: '1048576', createdAt: NOW } }), errorStatus: 404, errorExample: err('SHARE_NOT_FOUND', 'Shared file not found') },
    { id: 'public-download', method: 'GET', path: '/public/files/:token/download', category: 'sharing', ...open, binary: true, titleVi: 'Tải tệp chia sẻ công khai', titleEn: 'Download a public file', descVi: 'Tải về dạng tệp đính kèm.', descEn: 'Downloads as an attachment.', params: [p.path('token', 'Token chia sẻ', 'Share token')], responseExample: 'Content-Disposition: attachment; filename="report.pdf"\n\n(binary stream)' },
    { id: 'public-preview', method: 'GET', path: '/public/files/:token/preview', category: 'sharing', ...open, binary: true, titleVi: 'Xem trực tiếp tệp chia sẻ', titleEn: 'Preview a public file', descVi: 'Inline, hỗ trợ Range (video tua được).', descEn: 'Inline, honours Range.', params: [p.path('token', 'Token chia sẻ', 'Share token')], responseExample: 'Content-Disposition: inline\nAccept-Ranges: bytes\n\n(binary stream)' },
    { id: 'public-thumbnail', method: 'GET', path: '/public/thumbnails/:token', category: 'sharing', ...open, binary: true, titleVi: 'Ảnh thu nhỏ (URL ký)', titleEn: 'Thumbnail (signed URL)', descVi: 'URL lấy từ trường thumbnailUrl của /files, hết hạn sau vài giờ. 503 khi tài khoản đang bị Google giới hạn request.', descEn: 'URL from the thumbnailUrl field of /files; expires after a few hours. 503 while the account is rate limited by Google.', params: [p.path('token', 'Token ký', 'Signed token'), p.query('size', 'number', false, 'Cạnh dài (px)', 'Long edge in px')], responseExample: 'Content-Type: image/jpeg\nCache-Control: private, max-age=3600\n\n(binary image)' },

    // =============================== STORAGE ACCOUNTS ===============================
    { id: 'accounts-list', method: 'GET', path: '/connected-accounts', category: 'storage', ...bearer, titleVi: 'Tài khoản lưu trữ', titleEn: 'Storage accounts', descVi: 'Tài khoản của bạn và tài khoản được chia sẻ chung, kèm dung lượng. Không trả token.', descEn: 'Your accounts and shared ones, with quota. Tokens are never returned.', responseExample: json({ canConnectStorage: true, accounts: [{ id: ID2, provider: 'google_drive', email: 'me@gmail.com', status: 'connected', isShared: true, isOwner: true, hasProxy: false, lastError: null, storageAccount: { totalBytes: '16106127360', usedBytes: '5368709120', availableBytes: '10737418240', trashBytes: '0', lastSyncedAt: NOW } }] }) },
    { id: 'accounts-details', method: 'GET', path: '/connected-accounts/:id/details', category: 'storage', ...bearer, titleVi: 'Chi tiết tài khoản lưu trữ', titleEn: 'Storage account details', descVi: 'Cách kết nối, OAuth client, proxy, dung lượng, lỗi gần nhất.', descEn: 'How it was connected, OAuth client, proxy, quota, last error.', params: [p.path('id', 'ID tài khoản', 'Account ID')], responseExample: json({ id: ID2, provider: 'google_drive', email: 'me@gmail.com', status: 'connected', connectedVia: 'oauth', lastError: null, isOwner: true, usedForLogin: true, oauthClient: { kind: 'custom', clientId: '1234-abc.apps.googleusercontent.com' }, customOAuthAvailable: undefined, token: { hasRefreshToken: true, accessTokenExpiresAt: NOW }, hasProxy: false, storage: { totalBytes: '16106127360', usedBytes: '5368709120', availableBytes: '10737418240', trashBytes: '0', lastSyncedAt: NOW } }), errorStatus: 404, errorExample: err('ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản lưu trữ.') },
    { id: 'accounts-google-methods', method: 'GET', path: '/connected-accounts/google/auth-methods', category: 'storage', ...bearer, titleVi: 'Cách kết nối Google Drive', titleEn: 'Google connect methods', descVi: 'Các OAuth client dùng được để kết nối tài khoản.', descEn: 'OAuth clients available for connecting.', responseExample: json({ hasCustom: true, customClientId: '1234-abc.apps.googleusercontent.com', defaultMethod: 'custom', methods: [{ id: 'rclone', name: 'Rclone Desktop OAuth' }, { id: 'custom', name: 'OAuth riêng' }] }) },
    { id: 'accounts-google-connect-url', method: 'GET', path: '/connected-accounts/google/connect-url', category: 'storage', ...bearer, titleVi: 'Link kết nối Google Drive', titleEn: 'Google Drive connect URL', descVi: 'Mở URL này trong trình duyệt; Google chuyển về /connected-accounts/google/callback.', descEn: 'Open it in a browser; Google redirects to /connected-accounts/google/callback.', params: [p.query('method', "'rclone' | 'custom'", false, 'OAuth client', 'OAuth client')], queryExample: '?method=custom', responseExample: json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?…' }) },
    { id: 'accounts-google-code', method: 'POST', path: '/connected-accounts/google/exchange-code', category: 'storage', ...bearer, titleVi: 'Kết nối bằng cách dán mã', titleEn: 'Connect by pasting a code', descVi: 'Cho máy chủ trong LAN (Google không nhận redirect URI là IP nội bộ): dán mã 4/0A… hoặc cả link callback.', descEn: 'For LAN servers (Google rejects private-IP redirect URIs): paste the 4/0A… code or the whole callback URL.', params: [p.body('code', 'string', true, 'Mã hoặc link callback', 'Code or callback URL'), p.body('method', "'rclone' | 'custom'", false, 'OAuth client', 'OAuth client'), p.body('redirectUri', 'string', false, 'Redirect URI đã dùng', 'Redirect URI used'), p.body('proxyUrl', 'string', false, 'Proxy cho tài khoản', 'Proxy for the account')], bodyExample: json({ code: '4/0AeaYSHA…', method: 'rclone' }), successStatus: 201, responseExample: json({ status: 'success', accountId: ID2, email: 'me@gmail.com' }), errorStatus: 400, errorExample: err('MISSING_REFRESH_TOKEN', 'Google did not provide a refresh token. Try signing in again.') },
    { id: 'accounts-google-token', method: 'POST', path: '/connected-accounts/google/manual-token', category: 'storage', ...bearer, titleVi: 'Kết nối bằng refresh token', titleEn: 'Connect with a refresh token', descVi: 'Dùng refresh token có sẵn (ví dụ từ rclone). clientId/clientSecret phải là client đã cấp token đó.', descEn: 'Uses an existing refresh token (e.g. from rclone). clientId/clientSecret must be the client that issued it.', params: [p.body('refreshToken', 'string', true, 'Refresh token', 'Refresh token'), p.body('clientId / clientSecret', 'string', false, 'OAuth client đã cấp token', 'Issuing OAuth client'), p.body('proxyUrl', 'string', false, 'Proxy', 'Proxy')], bodyExample: json({ refreshToken: '1//0gAbC…' }), successStatus: 201, responseExample: json({ status: 'success', accountId: ID2, email: 'me@gmail.com' }), errorStatus: 400, errorExample: err('INVALID_TOKEN', 'Failed to verify Google refresh token.') },
    { id: 'accounts-s3', method: 'POST', path: '/connected-accounts/s3', category: 'storage', ...bearer, titleVi: 'Kết nối bucket S3', titleEn: 'Connect an S3 bucket', descVi: 'R2, AWS S3, MinIO, Wasabi, B2… Khoá được mã hoá trước khi lưu. quotaBytes đặt hạn mức tự chọn.', descEn: 'R2, AWS S3, MinIO, Wasabi, B2… Keys are encrypted at rest. quotaBytes sets your own cap.', params: [p.body('name', 'string', true, 'Tên hiển thị', 'Display name'), p.body('bucket', 'string', true, 'Tên bucket', 'Bucket'), p.body('region', 'string', true, 'Vùng (R2: auto)', 'Region (R2: auto)'), p.body('endpoint', 'URL', false, 'Endpoint tuỳ chỉnh', 'Custom endpoint'), p.body('accessKeyId', 'string', true, 'Access key', 'Access key'), p.body('secretAccessKey', 'string', true, 'Secret key', 'Secret key'), p.body('forcePathStyle', 'boolean', false, 'Bật cho MinIO', 'On for MinIO'), p.body('quotaBytes', 'string | null', false, 'Hạn mức (byte)', 'Cap in bytes')], bodyExample: json({ name: 'R2 backup', bucket: 'hcdrive', region: 'auto', endpoint: 'https://<account>.r2.cloudflarestorage.com', accessKeyId: 'AKIA…', secretAccessKey: '…', quotaBytes: '10737418240' }), successStatus: 201, responseExample: json({ account: { id: ID2, provider: 's3', email: 'hcdrive', displayName: 'R2 backup', storageAccount: { totalBytes: '10737418240', usedBytes: '0', availableBytes: '10737418240' } } }) },
    { id: 'accounts-sync-quota', method: 'POST', path: '/connected-accounts/:id/sync-quota', category: 'storage', ...bearer, titleVi: 'Cập nhật dung lượng', titleEn: 'Refresh the quota', descVi: 'Hỏi lại dung lượng và đồng bộ tệp ở nền.', descEn: 'Re-reads the quota and syncs files in the background.', params: [p.path('id', 'ID tài khoản', 'Account ID')], responseExample: json({ quota: { totalBytes: '16106127360', usedBytes: '5368709120', availableBytes: '10737418240', trashBytes: '0' } }) },
    { id: 'accounts-proxy', method: 'PATCH', path: '/connected-accounts/:id/proxy', category: 'storage', ...bearer, titleVi: 'Đặt proxy cho tài khoản', titleEn: 'Set the account proxy', descVi: 'http, https, socks5 hoặc socks5h; null để bỏ. Mọi request tới Google / S3 của tài khoản đi qua proxy này.', descEn: 'http, https, socks5 or socks5h; null removes it.', params: [p.path('id', 'ID tài khoản', 'Account ID'), p.body('proxyUrl', 'string | null', false, 'Ví dụ socks5://user:pass@host:1080', 'e.g. socks5://user:pass@host:1080')], bodyExample: json({ proxyUrl: 'socks5://user:pass@10.0.0.5:1080' }), responseExample: json({ status: 'ok', hasProxy: true, proxyUrl: 'socks5://user:****@10.0.0.5:1080' }), errorStatus: 400, errorExample: err('INVALID_PROXY_PROTOCOL', 'Proxy protocol must be http, https, socks5 or socks5h.') },
    { id: 'accounts-test-proxy', method: 'POST', path: '/connected-accounts/:id/test-proxy', category: 'storage', ...bearer, titleVi: 'Kiểm tra proxy', titleEn: 'Test a proxy', descVi: 'Thử kết nối ra ngoài qua proxy (của tài khoản hoặc proxyUrl gửi kèm).', descEn: 'Tries an outbound request through the proxy.', params: [p.path('id', 'ID tài khoản', 'Account ID'), p.body('proxyUrl', 'string', false, 'Proxy cần thử', 'Proxy to test')], bodyExample: json({ proxyUrl: 'http://10.0.0.5:3128' }), responseExample: json({ success: true, latencyMs: 182 }) },
    { id: 'accounts-share', method: 'PATCH', path: '/connected-accounts/:id/share', category: 'storage', ...bearer, titleVi: 'Dùng chung tài khoản lưu trữ', titleEn: 'Share a storage account', descVi: 'isShared = true: người dùng khác trong HCDrive cũng lưu vào được tài khoản này.', descEn: 'isShared = true: other HCDrive users can store files in it too.', params: [p.path('id', 'ID tài khoản', 'Account ID'), p.body('isShared', 'boolean', true, 'Dùng chung hay riêng', 'Shared or private')], bodyExample: json({ isShared: false }), responseExample: json({ status: 'ok', isShared: false }) },
    { id: 'accounts-delete', method: 'DELETE', path: '/connected-accounts/:id', category: 'storage', ...bearer, titleVi: 'Ngắt kết nối tài khoản', titleEn: 'Disconnect an account', descVi: 'Xoá token và thông tin tệp trong HCDrive; tệp trên Google Drive / S3 vẫn còn.', descEn: 'Removes tokens and file records from HCDrive; files on Google Drive / S3 stay.', params: [p.path('id', 'ID tài khoản', 'Account ID')], responseExample: OK, errorStatus: 403, errorExample: err('FORBIDDEN', 'Bạn không có quyền ngắt kết nối tài khoản này.') },
    { id: 'accounts-drive-items', method: 'GET', path: '/connected-accounts/:id/drive-items', category: 'storage', ...bearer, titleVi: 'Duyệt trực tiếp Google Drive', titleEn: 'Browse Google Drive live', descVi: 'Đọc thẳng một thư mục của tài khoản Google, có phân trang.', descEn: 'Lists a Google Drive folder directly, paginated.', params: [p.path('id', 'ID tài khoản', 'Account ID'), p.query('parentId', 'string', false, 'Thư mục trên Drive, mặc định root', 'Drive folder, default root'), p.query('q', 'string', false, 'Lọc tên', 'Name filter'), p.query('pageToken', 'string', false, 'Trang tiếp', 'Next page')], queryExample: '?parentId=root', responseExample: json({ parentId: 'root', items: [{ id: '1AbC…', name: 'Ảnh', mimeType: 'application/vnd.google-apps.folder', isFolder: true }], nextPageToken: null }) },
    { id: 'accounts-drive-folder', method: 'POST', path: '/connected-accounts/:id/drive-folder', category: 'storage', ...bearer, titleVi: 'Tạo thư mục trên Google Drive', titleEn: 'Create a Drive folder', descVi: 'Tạo trực tiếp trong tài khoản Google.', descEn: 'Created directly in that Google account.', params: [p.path('id', 'ID tài khoản', 'Account ID'), p.body('name', 'string', true, 'Tên', 'Name'), p.body('parentId', 'string', false, 'Thư mục cha, mặc định root', 'Parent, default root')], bodyExample: json({ name: 'Backup', parentId: 'root' }), successStatus: 201, responseExample: json({ folder: { id: '1NeW…', name: 'Backup' } }) },
    { id: 'accounts-drive-upload', method: 'POST', path: '/connected-accounts/:id/drive-items/upload', category: 'storage', ...bearer, titleVi: 'Tải tệp vào thư mục Drive bất kỳ', titleEn: 'Upload into any Drive folder', descVi: 'Thân request là nội dung tệp (raw), thông tin tệp đặt trên query.', descEn: 'The body is the raw file; metadata goes in the query.', params: [p.path('id', 'ID tài khoản', 'Account ID'), p.query('parentId', 'string', true, 'Thư mục trên Drive', 'Drive folder'), p.query('name', 'string', true, 'Tên tệp', 'File name'), p.query('mimeType', 'string', false, 'Kiểu MIME', 'MIME type')], curlSnippet: `curl -X POST "${baseUrl}/connected-accounts/{id}/drive-items/upload?parentId=root&name=photo.jpg&mimeType=image/jpeg" \\\n  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\\n  --data-binary @photo.jpg`, successStatus: 201, responseExample: json({ item: { id: '1PhO…', name: 'photo.jpg', mimeType: 'image/jpeg', size: '204800' } }) },
    { id: 'accounts-drive-item-delete', method: 'DELETE', path: '/connected-accounts/:id/drive-item/:fileId', category: 'storage', ...bearer, titleVi: 'Xoá mục trên Google Drive', titleEn: 'Delete a Drive item', descVi: 'Chuyển vào thùng rác của Google Drive.', descEn: 'Moves it to the Google Drive trash.', params: [p.path('id', 'ID tài khoản', 'Account ID'), p.path('fileId', 'ID trên Google Drive', 'Google Drive ID')], responseExample: OK },
    { id: 'accounts-export', method: 'POST', path: '/connected-accounts/export', category: 'storage', ...bearer, titleVi: 'Xuất token tài khoản (JSON)', titleEn: 'Export account tokens (JSON)', descVi: 'Để chuyển tài khoản sang máy chủ HCDrive khác. Chứa refresh token ở dạng rõ: giữ file thật kỹ. Cần mật khẩu nếu tài khoản có mật khẩu.', descEn: 'For moving accounts to another HCDrive. Contains plain refresh tokens: keep the file safe. Needs your password if you have one.', params: [p.body('password', 'string', false, 'Mật khẩu HCDrive', 'HCDrive password'), p.body('accountIds', 'string[]', false, 'Chỉ các tài khoản này', 'Only these accounts')], bodyExample: json({ password: 'mat-khau-manh' }), responseExample: json({ format: 'hcdrive.storage-accounts', version: 1, exportedAt: NOW, accounts: [{ provider: 'google_drive', email: 'me@gmail.com', token: { refreshToken: '1//0gAbC…' }, oauthClient: { kind: 'rclone' } }] }), errorStatus: 400, errorExample: err('INVALID_CURRENT_PASSWORD', 'Mật khẩu không chính xác.') },
    { id: 'accounts-import', method: 'POST', path: '/connected-accounts/import', category: 'storage', ...bearer, titleVi: 'Nhập token tài khoản (JSON)', titleEn: 'Import account tokens (JSON)', descVi: 'Gửi nguyên nội dung file đã xuất. Tài khoản đã có sẽ được cập nhật token.', descEn: 'Send the exported file as is. Existing accounts get their tokens updated.', bodyExample: json({ format: 'hcdrive.storage-accounts', version: 1, accounts: [{ provider: 'google_drive', email: 'me@gmail.com', token: { refreshToken: '1//0gAbC…' } }] }), responseExample: json({ imported: 1, failed: 0, results: [{ index: 0, provider: 'google_drive', label: 'me@gmail.com', status: 'imported' }] }) },
    { id: 'storage-summary', method: 'GET', path: '/storage/summary', category: 'storage', ...bearer, titleVi: 'Tổng dung lượng', titleEn: 'Storage summary', descVi: 'Tổng, đã dùng, còn trống trên mọi tài khoản, và từng tài khoản. Số byte là chuỗi.', descEn: 'Total, used and free across accounts, and per account. Byte counts are strings.', responseExample: json({ totalBytes: '32212254720', usedBytes: '6442450944', availableBytes: '25769803776', accounts: [{ id: ID2, provider: 'google_drive', email: 'me@gmail.com', status: 'connected', totalBytes: '16106127360', usedBytes: '5368709120', availableBytes: '10737418240', lastSyncedAt: NOW }] }) },
    { id: 'storage-breakdown', method: 'GET', path: '/storage/breakdown', category: 'storage', ...bearer, titleVi: 'Dung lượng theo loại tệp', titleEn: 'Usage by file type', descVi: 'Ảnh, video, tài liệu (byte).', descEn: 'Photos, videos, documents in bytes.', responseExample: json({ photo: '1073741824', video: '4294967296', document: '536870912' }) },
    { id: 'storage-routing-get', method: 'GET', path: '/storage/routing-policy', category: 'storage', ...bearer, titleVi: 'Chính sách phân bổ tải lên', titleEn: 'Upload routing policy', descVi: 'Cách chọn tài khoản cho tệp mới.', descEn: 'How a storage account is picked for new files.', responseExample: json({ policy: { id: ID, mode: 'priority', priorityAccountIds: [ID2], roundRobinCursor: 0 } }) },
    { id: 'storage-routing-set', method: 'PATCH', path: '/storage/routing-policy', category: 'storage', ...bearer, titleVi: 'Đổi chính sách phân bổ', titleEn: 'Change the routing policy', descVi: 'most_available: còn trống nhiều nhất. round_robin: lần lượt theo priorityAccountIds. priority: lấp đầy tài khoản đầu rồi tới tài khoản kế. Tài khoản đầy hoặc đang bị Google giới hạn được bỏ qua.', descEn: 'most_available, round_robin (in priorityAccountIds order) or priority (fill the first, then the next). Full or rate-limited accounts are skipped.', params: [p.body('mode', "'most_available' | 'round_robin' | 'priority'", true, 'Chế độ', 'Mode'), p.body('priorityAccountIds', 'string[]', false, 'Thứ tự tài khoản', 'Account order')], bodyExample: json({ mode: 'priority', priorityAccountIds: [ID2, ID] }), responseExample: json({ policy: { id: ID, mode: 'priority', priorityAccountIds: [ID2, ID], roundRobinCursor: 0 } }) },

    // =============================== LIBRARY ===============================
    { id: 'library-list', method: 'GET', path: '/library', category: 'library', ...bearer, titleVi: 'Danh sách khóa học', titleEn: 'List the library', descVi: 'Link đã lưu và các tài khoản Google của bạn (dùng để mở link).', descEn: 'Saved links and your Google accounts (used to open them).', responseExample: json({ links: [savedLinkExample], accounts: [{ id: ID2, email: 'me@gmail.com' }] }) },
    { id: 'library-add', method: 'POST', path: '/library', category: 'library', ...bearer, titleVi: 'Thêm link khóa học', titleEn: 'Add a link', descVi: 'Nhận mọi dạng link Google Drive / Docs (cả link có resourcekey) hoặc fileId + accountId từ "Được chia sẻ với tôi". HCDrive thử lần lượt các tài khoản Google của bạn để tìm tài khoản mở được. Link đã có thì trả về bản cũ (200, existed = true).', descEn: 'Accepts any Drive / Docs link (resourcekey included) or fileId + accountId. HCDrive tries your Google accounts until one can open it. A link already saved returns 200 with existed = true.', params: [p.body('url', 'string', false, 'Link Google Drive / Docs', 'Drive / Docs link'), p.body('fileId', 'string', false, 'ID trên Drive (thay cho url)', 'Drive ID (instead of url)'), p.body('accountId', 'string', false, 'Tài khoản thử trước', 'Account to try first'), p.body('collection', 'string', false, 'Khóa / nhóm', 'Course / group'), p.body('title', 'string', false, 'Tên hiển thị', 'Display name'), p.body('teacher', 'string', false, 'Giảng viên', 'Teacher')], bodyExample: json({ url: 'https://drive.google.com/drive/folders/1CoUrSeFoLdErId?usp=sharing', collection: 'Lập trình Web', teacher: 'ThS. Nguyễn Văn A' }), successStatus: 201, responseExample: json({ link: savedLinkExample, existed: false }), errorStatus: 404, errorExample: err('LINK_NOT_ACCESSIBLE', 'Không tài khoản Google nào của bạn mở được link này. Hãy kết nối tài khoản Google có email được chia sẻ.') },
    { id: 'library-update', method: 'PATCH', path: '/library/:id', category: 'library', ...bearer, titleVi: 'Sửa khóa học', titleEn: 'Edit a link', descVi: 'Tên, khóa, giảng viên, ghi chú.', descEn: 'Name, course, teacher, note.', params: [p.path('id', 'ID link', 'Link ID'), p.body('title', 'string', false, 'Tên', 'Name'), p.body('collection', 'string', false, 'Khóa', 'Course'), p.body('teacher', 'string', false, 'Giảng viên', 'Teacher'), p.body('note', 'string', false, 'Ghi chú (≤ 5000 ký tự)', 'Note')], bodyExample: json({ teacher: 'TS. Trần B', note: 'Nhóm hỗ trợ: …' }), responseExample: json({ link: { ...savedLinkExample, teacher: 'TS. Trần B' } }) },
    { id: 'library-delete', method: 'DELETE', path: '/library/:id', category: 'library', ...bearer, titleVi: 'Xoá khỏi thư viện', titleEn: 'Remove from the library', descVi: 'Tệp trên Google Drive không bị ảnh hưởng.', descEn: 'Drive files are untouched.', params: [p.path('id', 'ID link', 'Link ID')], responseExample: json({ ok: true }) },
    { id: 'library-rename-collection', method: 'POST', path: '/library/collections/rename', category: 'library', ...bearer, titleVi: 'Đổi tên khóa', titleEn: 'Rename a course group', descVi: 'to rỗng = bỏ nhóm.', descEn: 'Empty to ungroups.', params: [p.body('from', 'string', true, 'Tên cũ', 'Old name'), p.body('to', 'string', true, 'Tên mới', 'New name')], bodyExample: json({ from: 'Web', to: 'Lập trình Web' }), responseExample: json({ updated: 4 }) },
    { id: 'library-items', method: 'GET', path: '/library/:id/items', category: 'library', ...bearer, titleVi: 'Danh sách bài học', titleEn: 'Lessons', descVi: 'Nội dung thư mục khóa (hoặc chương folderId), xếp theo số tự nhiên. streamUrl là URL ký để phát hoặc tải trực tiếp; tự động kích hoạt cơ chế bypass nếu tệp bị Google Drive chặn tải.', descEn: 'Contents of the course folder (or chapter folderId), naturally sorted. streamUrl is a signed URL to stream or download; automatically activates bypass if Google blocks downloads.', params: [p.path('id', 'ID link', 'Link ID'), p.query('folderId', 'string', false, 'Chương (thư mục con)', 'Chapter (subfolder)'), p.query('rk', 'string', false, 'resourceKey của chương', 'Chapter resourceKey')], responseExample: json({ items: [{ id: '1ViD…', name: 'Bài 1 - Giới thiệu.mp4', mimeType: 'video/mp4', isFolder: false, size: '104857600', durationSeconds: 754, canDownload: true, resourceKey: null, webViewLink: 'https://drive.google.com/file/d/1ViD…/view', previewUrl: 'https://drive.google.com/file/d/1ViD…/preview', streamUrl: `/library/stream/${ID}~1ViD….1793750400.sig`, completed: true, positionSeconds: 0 }], account: { id: ID2, email: 'me@gmail.com' } }) },
    { id: 'library-progress', method: 'PUT', path: '/library/:id/progress', category: 'library', ...bearer, titleVi: 'Lưu tiến độ học', titleEn: 'Save progress', descVi: 'Đánh dấu đã học và / hoặc vị trí video (giây).', descEn: 'Done flag and / or video position in seconds.', params: [p.path('id', 'ID link', 'Link ID'), p.body('fileId', 'string', true, 'ID bài trên Drive', 'Lesson Drive ID'), p.body('completed', 'boolean', false, 'Đã học', 'Done'), p.body('positionSeconds', 'integer', false, 'Vị trí video', 'Video position')], bodyExample: json({ fileId: '1ViD…', completed: true }), responseExample: json({ completed: true, positionSeconds: 754 }) },
    { id: 'library-stream', method: 'GET', path: '/library/stream/:token', category: 'library', ...open, binary: true, titleVi: 'Phát / tải một bài (URL ký)', titleEn: 'Play / download a lesson (signed URL)', descVi: 'Không cần header; token lấy từ streamUrl, hết hạn sau vài giờ. Tự động bypass khi Google Drive chặn tải; trả về lỗi 403 nếu người chia sẻ tắt quyền tải (allowDownload: false).', descEn: 'No header needed; signed token from streamUrl. Automatically bypasses Google Drive download blocks; returns 403 if sharer turned off downloads.', params: [p.path('token', 'Token ký', 'Signed token'), p.query('download', 'string', false, 'Tên tệp khi tải về', 'File name to save as'), p.header('Range', false, 'Tua video', 'Video seeking')], responseExample: 'HTTP/1.1 206 Partial Content\nContent-Type: video/mp4\nContent-Range: bytes 0-1048575/104857600\nAccept-Ranges: bytes\n\n(binary stream)', errorStatus: 403, errorExample: err('DOWNLOAD_BLOCKED', 'Người chia sẻ đã tắt tính năng tải xuống cho liên kết này.') },
    { id: 'library-download-link', method: 'POST', path: '/library/:id/download-link', category: 'library', ...bearer, titleVi: 'Link tải khóa / chương thành ZIP', titleEn: 'ZIP download link', descVi: 'Trả về URL ký để tải ZIP trong lúc truyền. Tự động bypass các tệp bị Google Drive chặn tải xuống.', descEn: 'Returns signed URL to download ZIP stream. Automatically bypasses files blocked by Google Drive.', params: [p.path('id', 'ID link', 'Link ID'), p.body('folderId', 'string', false, 'Chỉ một chương', 'Only one chapter'), p.body('rk', 'string', false, 'resourceKey của chương', 'Chapter resourceKey'), p.body('name', 'string', false, 'Tên chương (đặt tên file)', 'Chapter name for the file name')], bodyExample: json({}), responseExample: json({ path: `/library/download/${ID}~root.1793750400.sig` }) },
    { id: 'library-download', method: 'GET', path: '/library/download/:token', category: 'library', ...open, binary: true, titleVi: 'Tải ZIP khóa học', titleEn: 'Download the course ZIP', descVi: 'URL từ /download-link, không cần header.', descEn: 'URL from /download-link, no header needed.', params: [p.path('token', 'Token ký', 'Signed token')], responseExample: 'Content-Type: application/zip\nContent-Disposition: attachment; filename*=UTF-8\'\'Kh%C3%B3a%20React%20-%20Th%E1%BA%A7y%20A.zip\n\n(binary stream)' },
    { id: 'library-save-to-drive', method: 'POST', path: '/library/:id/save-to-drive', category: 'library', ...bearer, titleVi: 'Lưu khóa học vào Drive của tôi', titleEn: 'Save the course to my Drive', descVi: 'Chép thật cả khóa vào thư mục gốc Drive của bạn; tự động bypass các tệp bị chặn sao chép bằng cơ chế stream và tạo tệp mới.', descEn: 'Real copies of the whole course into your Drive; automatically bypasses copy-restricted files by streaming and creating new files.', params: [p.path('id', 'ID link', 'Link ID')], successStatus: 202, responseExample: json({ job: { status: 'running', accountEmail: 'me@gmail.com', folderName: 'Khóa React - Thầy A', folderUrl: null, copied: 0, folders: 0, skipped: 0, failed: 0, current: null, error: null, startedAt: NOW, finishedAt: null } }) },
    { id: 'library-save-status', method: 'GET', path: '/library/:id/save-to-drive', category: 'library', ...bearer, titleVi: 'Tiến độ lưu vào Drive', titleEn: 'Save-to-Drive progress', descVi: 'job = null khi chưa chạy. Trạng thái sao chép và số lượng tệp đã xử lý.', descEn: 'job = null when none ran. Copy status and count of processed files.', params: [p.path('id', 'ID link', 'Link ID')], responseExample: json({ job: { status: 'done', accountEmail: 'me@gmail.com', folderName: 'Khóa React - Thầy A', folderUrl: 'https://drive.google.com/drive/folders/1NeW…', copied: 42, folders: 6, skipped: 0, failed: 0, current: null, error: null, startedAt: NOW, finishedAt: NOW } }) },
    { id: 'library-share-create', method: 'POST', path: '/library/:id/share', category: 'library', ...bearer, titleVi: 'Tạo link chia sẻ nội bộ / công khai', titleEn: 'Create share link', descVi: 'Người dùng bất kỳ mở /library/s/:token để xem trực tuyến (không cần đăng nhập hoặc đăng nhập tùy ý), tải bài hoặc lưu vào thư viện. Có thể bật hoặc tắt allowDownload để chặn/cho phép tải.', descEn: 'Anyone can open /library/s/:token to view without login, download lessons, or save to their library. Can toggle allowDownload.', params: [p.path('id', 'ID link', 'Link ID'), p.body('allowDownload', 'boolean', false, 'Cho phép tải bài học & ZIP', 'Allow downloading lessons & ZIP')], bodyExample: json({ allowDownload: true }), successStatus: 201, responseExample: json({ path: '/library/s/Q2x8bG…', allowDownload: true }) },
    { id: 'library-share-get', method: 'GET', path: '/library/:id/share', category: 'library', ...bearer, titleVi: 'Link chia sẻ hiện có', titleEn: 'Current share link', descVi: 'null nếu chưa tạo.', descEn: 'null when none.', params: [p.path('id', 'ID link', 'Link ID')], responseExample: json({ path: '/library/s/Q2x8bG…', allowDownload: true }) },
    { id: 'library-share-delete', method: 'DELETE', path: '/library/:id/share', category: 'library', ...bearer, titleVi: 'Tắt link chia sẻ', titleEn: 'Turn off share link', descVi: 'Link cũ trả 404.', descEn: 'The old link returns 404.', params: [p.path('id', 'ID link', 'Link ID')], responseExample: json({ ok: true }) },
    { id: 'library-shared-view', method: 'GET', path: '/library/shared/:token', category: 'library', ...open, titleVi: 'Xem khóa được chia sẻ (Công khai)', titleEn: 'View shared course (Public)', descVi: 'Thông tin khóa, người chia sẻ, quyền tải allowDownload và trạng thái đăng nhập. Không bắt buộc đăng nhập.', descEn: 'Course details, sharer, allowDownload permissions, and login status. Optional authentication.', params: [p.path('token', 'Token trong /library/s/:token', 'Token from /library/s/:token')], responseExample: json({ course: { title: 'Khóa React', teacher: 'Thầy A', collection: 'Lập trình Web', mimeType: 'application/vnd.google-apps.folder', isFolder: true, url: 'https://drive.google.com/drive/folders/1CoUrSeFoLdErId', ownerName: 'Thầy A', ownerEmail: 'teacher@example.com', sharedBy: 'Alice', allowDownload: true }, savedLinkId: null, isLoggedIn: false, access: { ok: true, accountEmail: null }, accountEmails: [] }), errorStatus: 404, errorExample: err('SHARE_NOT_FOUND', 'Link chia sẻ không tồn tại hoặc đã bị tắt.') },
    { id: 'library-shared-items', method: 'GET', path: '/library/shared/:token/items', category: 'library', ...open, titleVi: 'Danh sách bài học chia sẻ (Công khai)', titleEn: 'Shared course lessons (Public)', descVi: 'Nội dung thư mục khóa học hoặc chương được chia sẻ. streamUrl phát hoặc tải bài; áp dụng quyền allowDownload.', descEn: 'Contents of the shared course folder or chapter. streamUrl streams or downloads; honors allowDownload.', params: [p.path('token', 'Token chia sẻ', 'Share token'), p.query('folderId', 'string', false, 'Chương', 'Chapter'), p.query('rk', 'string', false, 'resourceKey của chương', 'Chapter resourceKey')], responseExample: json({ items: [{ id: '1ViD…', name: 'Bài 1 - Giới thiệu.mp4', mimeType: 'video/mp4', isFolder: false, size: '104857600', durationSeconds: 754, canDownload: true, resourceKey: null, webViewLink: 'https://drive.google.com/file/d/1ViD…/view', previewUrl: 'https://drive.google.com/file/d/1ViD…/preview', streamUrl: `/library/stream/${ID}~1ViD….1793750400.sig`, completed: false, positionSeconds: 0 }], allowDownload: true }) },
    { id: 'library-shared-download-link', method: 'POST', path: '/library/shared/:token/download-link', category: 'library', ...open, titleVi: 'Tải ZIP khóa học chia sẻ (Công khai)', titleEn: 'Shared course ZIP link (Public)', descVi: 'Tải toàn bộ khóa học hoặc từng chương thành file ZIP từ link chia sẻ công khai. Bị chặn nếu allowDownload = false.', descEn: 'Download shared course or chapter as ZIP. Blocked if allowDownload = false.', params: [p.path('token', 'Token chia sẻ', 'Share token'), p.body('folderId', 'string', false, 'Chỉ một chương', 'Only one chapter'), p.body('rk', 'string', false, 'resourceKey của chương', 'Chapter resourceKey'), p.body('name', 'string', false, 'Tên chương', 'Chapter name')], bodyExample: json({}), responseExample: json({ path: `/library/download/${ID}~root.1793750400.sig` }), errorStatus: 403, errorExample: err('DOWNLOAD_BLOCKED', 'Người chia sẻ đã tắt tính năng tải xuống cho liên kết này.') },
    { id: 'library-shared-save', method: 'POST', path: '/library/shared/:token/save', category: 'library', ...bearer, titleVi: 'Lưu khóa được chia sẻ vào thư viện', titleEn: 'Save shared course to my library', descVi: 'Lưu khóa học vào thư viện cá nhân để theo dõi tiến độ. Hỗ trợ fallback tài khoản người chia sẻ nếu người nhận chưa được cấp quyền riêng.', descEn: 'Save course to personal library to track progress. Supports fallback to sharer account if not directly shared.', params: [p.path('token', 'Token chia sẻ', 'Share token'), p.body('collection', 'string', false, 'Xếp vào nhóm / khóa', 'Course group')], bodyExample: json({ collection: 'Học chung' }), successStatus: 201, responseExample: json({ link: savedLinkExample, existed: false }), errorStatus: 404, errorExample: err('LINK_NOT_ACCESSIBLE', 'Tài khoản Google của bạn chưa được chia sẻ khóa học này.') },

    // =============================== KEYS & AUDIT ===============================
    { id: 'api-keys-list', method: 'GET', path: '/api-keys', category: 'keys', ...bearer, titleVi: 'Danh sách khoá API', titleEn: 'List API keys', descVi: 'Chỉ trả phần đầu khoá (keyPrefix), không bao giờ trả khoá đầy đủ.', descEn: 'Only the key prefix, never the full secret.', responseExample: json({ apiKeys: [{ id: ID, name: 'CI deploy', keyPrefix: '9d_live_ab12', scopes: ['files:upload'], status: 'active', lastUsedAt: NOW, expiresAt: null, revokedAt: null, createdAt: NOW }] }) },
    { id: 'api-keys-create', method: 'POST', path: '/api-keys', category: 'keys', ...bearer, titleVi: 'Tạo khoá API', titleEn: 'Create an API key', descVi: 'Khoá có scope files:upload. secret chỉ hiện một lần — lưu lại ngay; máy chủ chỉ giữ bản băm.', descEn: 'The key gets the files:upload scope. secret is shown once; the server keeps only a hash.', params: [p.body('name', 'string', true, 'Tên gợi nhớ (1–191 ký tự)', 'Label'), p.body('expiresAt', 'ISO datetime | null', false, 'Ngày hết hạn', 'Expiry')], bodyExample: json({ name: 'Backup script', expiresAt: null }), successStatus: 201, responseExample: json({ apiKey: { id: ID, name: 'Backup script', keyPrefix: '9d_live_ab12', scopes: ['files:upload'], status: 'active', createdAt: NOW }, secret: '9d_live_ab12…(64 ký tự)' }) },
    { id: 'api-keys-revoke', method: 'DELETE', path: '/api-keys/:id', category: 'keys', ...bearer, titleVi: 'Thu hồi khoá API', titleEn: 'Revoke an API key', descVi: 'Khoá ngừng hoạt động ngay.', descEn: 'Stops working at once.', params: [p.path('id', 'ID khoá', 'Key ID')], responseExample: OK },
    { id: 'audit-logs', method: 'GET', path: '/audit-logs', category: 'keys', ...bearer, titleVi: 'Nhật ký hoạt động', titleEn: 'Audit log', descVi: '100 hoạt động gần nhất của bạn: đăng nhập, tải lên, đổi tên, xoá, chia sẻ…', descEn: 'Your last 100 actions: sign-ins, uploads, renames, deletes, shares…', responseExample: json({ logs: [{ id: ID, userId: ID2, action: 'UPLOAD_FILE', entityType: 'file', entityId: ID, metadata: { name: 'report.pdf' }, createdAt: NOW }] }) },

    { id: 'files-open-drive', method: 'GET', path: '/files/open-drive', category: 'files', ...bearer, titleVi: 'Mở tệp trên Google Drive', titleEn: 'Open a file in Google Drive', descVi: 'Chuyển hướng (302) tới trang của tệp trên Google Drive; redirect=false để nhận URL dạng JSON.', descEn: 'Redirects (302) to the file on Google Drive; redirect=false returns the URL as JSON.', params: [p.query('fileId', 'string', true, 'ID tệp (HCDrive hoặc Google Drive)', 'File ID (HCDrive or Google Drive)'), p.query('accountId', 'string', false, 'Tài khoản chứa tệp', 'Account holding the file'), p.query('redirect', "'false'", false, 'Trả JSON thay vì chuyển hướng', 'Return JSON instead of redirecting')], queryExample: `?fileId=${ID}&redirect=false`, responseExample: json({ url: 'https://drive.google.com/file/d/1AbC…/view' }), errorStatus: 400, errorExample: err('UNSUPPORTED_PROVIDER', 'Direct open is only available for Google Drive files.') },
    { id: 'provider-configs-list', method: 'GET', path: '/provider-configs', category: 'keys', ...bearer, titleVi: 'OAuth client cá nhân (cũ)', titleEn: 'Personal OAuth clients (legacy)', descVi: 'Cách cấu hình cũ, theo từng người dùng. Nên dùng /system/google-config.', descEn: 'Older per-user setup; prefer /system/google-config.', responseExample: json({ configs: [{ id: ID, provider: 'google', redirectUri: 'https://drive.example.com/connected-accounts/google/callback', scopes: ['https://www.googleapis.com/auth/drive'], status: 'active', createdAt: NOW }] }) },
    { id: 'provider-configs-create', method: 'POST', path: '/provider-configs/google', category: 'keys', ...bearer, titleVi: 'Thêm OAuth client cá nhân (cũ)', titleEn: 'Add a personal OAuth client (legacy)', descVi: 'Client ID / secret được mã hoá trước khi lưu.', descEn: 'Client ID / secret are encrypted at rest.', params: [p.body('clientId', 'string', true, 'Client ID', 'Client ID'), p.body('clientSecret', 'string', true, 'Client secret', 'Client secret'), p.body('redirectUri', 'URL', true, 'Redirect URI', 'Redirect URI'), p.body('scopes', 'string[]', true, 'Scope OAuth', 'OAuth scopes')], bodyExample: json({ clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-…', redirectUri: 'https://drive.example.com/connected-accounts/google/callback', scopes: ['https://www.googleapis.com/auth/drive'] }), successStatus: 201, responseExample: json({ id: ID, provider: 'google', redirectUri: 'https://drive.example.com/connected-accounts/google/callback', scopes: ['https://www.googleapis.com/auth/drive'], status: 'active' }) },
    { id: 'provider-configs-delete', method: 'DELETE', path: '/provider-configs/:id', category: 'keys', ...bearer, titleVi: 'Xoá OAuth client cá nhân (cũ)', titleEn: 'Delete a personal OAuth client (legacy)', descVi: 'Tài khoản đã kết nối bằng client này cũng bị gỡ.', descEn: 'Accounts connected with it are removed too.', params: [p.path('id', 'ID cấu hình', 'Config ID')], responseExample: OK },

    // =============================== ADMIN ===============================
    { id: 'admin-settings', method: 'GET', path: '/system/settings', category: 'admin', ...admin, titleVi: 'Cài đặt hệ thống', titleEn: 'System settings', descVi: 'Cho phép đăng ký, cho người dùng thường tự kết nối tài khoản lưu trữ.', descEn: 'Open sign-up; let regular users connect storage.', responseExample: json({ allowRegistration: true, allowUserDriveConnect: false }) },
    { id: 'admin-settings-update', method: 'PATCH', path: '/system/settings', category: 'admin', ...admin, titleVi: 'Sửa cài đặt hệ thống', titleEn: 'Update system settings', descVi: 'Gửi trường cần đổi.', descEn: 'Send the fields to change.', params: [p.body('allowRegistration', 'boolean', false, 'Cho phép đăng ký', 'Open sign-up'), p.body('allowUserDriveConnect', 'boolean', false, 'Người dùng tự kết nối lưu trữ', 'Users connect storage')], bodyExample: json({ allowRegistration: false }), responseExample: json({ status: 'ok', allowRegistration: false, allowUserDriveConnect: false }) },
    { id: 'admin-users', method: 'GET', path: '/system/users', category: 'admin', ...admin, titleVi: 'Danh sách người dùng', titleEn: 'List users', descVi: 'Kèm cờ quản trị viên.', descEn: 'With the admin flag.', responseExample: json({ users: [{ id: ID, name: 'Alice', email: 'alice@example.com', status: 'active', createdAt: NOW, isAdmin: true }] }) },
    { id: 'admin-users-create', method: 'POST', path: '/system/users', category: 'admin', ...admin, titleVi: 'Tạo người dùng', titleEn: 'Create a user', descVi: 'Quản trị viên tạo tài khoản cho người khác.', descEn: 'An admin creates an account for someone.', params: [p.body('name', 'string', true, 'Tên', 'Name'), p.body('email', 'string', true, 'Email', 'Email'), p.body('password', 'string', true, 'Mật khẩu (≥ 6)', 'Password (≥ 6)')], bodyExample: json({ name: 'Bob', email: 'bob@example.com', password: 'tam-thoi-123' }), successStatus: 201, responseExample: json({ status: 'ok', user: { id: ID2, name: 'Bob', email: 'bob@example.com', status: 'active' } }), errorStatus: 409, errorExample: err('USER_EXISTS', 'Email này đã tồn tại trong hệ thống.') },
    { id: 'admin-users-update', method: 'PATCH', path: '/system/users/:id', category: 'admin', ...admin, titleVi: 'Sửa / khoá người dùng', titleEn: 'Edit / disable a user', descVi: 'status = disabled chặn đăng nhập. Không tự khoá chính mình.', descEn: 'status = disabled blocks sign-in. You cannot disable yourself.', params: [p.path('id', 'ID người dùng', 'User ID'), p.body('name', 'string', false, 'Tên', 'Name'), p.body('status', "'active' | 'disabled'", false, 'Trạng thái', 'Status'), p.body('password', 'string', false, 'Đặt lại mật khẩu', 'Reset password')], bodyExample: json({ status: 'disabled' }), responseExample: json({ status: 'ok', user: { id: ID2, status: 'disabled' } }), errorStatus: 400, errorExample: err('CANNOT_DISABLE_SELF', 'Bạn không thể tự vô hiệu hoá tài khoản của chính mình.') },
    { id: 'admin-users-delete', method: 'DELETE', path: '/system/users/:id', category: 'admin', ...admin, titleVi: 'Xoá người dùng', titleEn: 'Delete a user', descVi: 'Xoá tài khoản và dữ liệu HCDrive của người đó.', descEn: 'Deletes the account and its HCDrive data.', params: [p.path('id', 'ID người dùng', 'User ID')], responseExample: OK, errorStatus: 400, errorExample: err('CANNOT_DELETE_SELF', 'Bạn không thể tự xoá tài khoản quản trị của mình.') },
    { id: 'admin-google-config', method: 'GET', path: '/system/google-config', category: 'admin', ...admin, titleVi: 'OAuth client riêng', titleEn: 'Custom OAuth client', descVi: 'Client ID và redirect URI đang dùng; secret không bao giờ trả về.', descEn: 'Client ID and redirect URI; the secret is never returned.', responseExample: json({ exists: true, clientId: '1234-abc.apps.googleusercontent.com', redirectUri: 'https://drive.example.com/connected-accounts/google/callback', hasSecret: true, defaultRedirectUri: 'https://drive.example.com/connected-accounts/google/callback' }) },
    { id: 'admin-google-config-set', method: 'POST', path: '/system/google-config', category: 'admin', ...admin, titleVi: 'Lưu OAuth client riêng', titleEn: 'Save the custom OAuth client', descVi: 'clientSecret để trống thì giữ secret cũ. Lưu mã hoá.', descEn: 'Empty clientSecret keeps the stored one. Stored encrypted.', params: [p.body('clientId', 'string', true, 'Client ID', 'Client ID'), p.body('clientSecret', 'string', false, 'Client secret', 'Client secret'), p.body('redirectUri', 'string', false, 'Redirect URI', 'Redirect URI')], bodyExample: json({ clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-…', redirectUri: 'https://drive.example.com/connected-accounts/google/callback' }), successStatus: 201, responseExample: json({ status: 'success', message: 'Global Google OAuth configuration updated successfully.', id: ID }) },
    { id: 'admin-captcha', method: 'GET', path: '/system/security/captcha', category: 'admin', ...admin, titleVi: 'Cài đặt captcha', titleEn: 'Captcha settings', descVi: 'Chỉ cho biết đã có secret chưa, không trả secret.', descEn: 'Tells whether a secret is stored, never the secret.', responseExample: json({ provider: 'turnstile', recaptchaSiteKey: '', hasRecaptchaSecret: false, turnstileSiteKey: '0x4AAAAAAA…', hasTurnstileSecret: true, onRegister: true, onLogin: false, fromEnv: false, disabledByEnv: false }) },
    { id: 'admin-captcha-set', method: 'PUT', path: '/system/security/captcha', category: 'admin', ...admin, titleVi: 'Lưu cài đặt captcha', titleEn: 'Save captcha settings', descVi: 'Khi đổi loại captcha hoặc khoá phải gửi testToken — token của captcha vừa giải bằng khoá mới — để máy chủ xác minh cặp khoá trước khi lưu. Secret để trống thì giữ secret cũ.', descEn: 'Changing provider or keys needs testToken from a captcha solved with the new keys, so the pair is verified before saving. Empty secrets keep the stored ones.', params: [p.body('provider', "'none' | 'recaptcha' | 'turnstile'", true, 'Loại captcha', 'Provider'), p.body('recaptchaSiteKey / recaptchaSecret', 'string', false, 'Khoá reCAPTCHA v2', 'reCAPTCHA v2 keys'), p.body('turnstileSiteKey / turnstileSecret', 'string', false, 'Khoá Turnstile', 'Turnstile keys'), p.body('onRegister', 'boolean', true, 'Bật khi đăng ký', 'On sign-up'), p.body('onLogin', 'boolean', true, 'Bật khi đăng nhập', 'On sign-in'), p.body('testToken', 'string', false, 'Token captcha thử', 'Test captcha token')], bodyExample: json({ provider: 'turnstile', turnstileSiteKey: '0x4AAAAAAA…', turnstileSecret: '0x4AAAAAAA…secret', onRegister: true, onLogin: true, testToken: 'XXXX.DUMMY.TOKEN' }), responseExample: json({ provider: 'turnstile', hasTurnstileSecret: true, onRegister: true, onLogin: true }), errorStatus: 400, errorExample: err('CAPTCHA_TEST_FAILED', 'Secret key không đúng (hoặc không khớp với Site key).') },
    { id: 'admin-network', method: 'GET', path: '/system/security/network', category: 'admin', ...admin, titleVi: 'Nhận diện proxy và IP', titleEn: 'Proxy detection and client IP', descVi: 'HCDrive có đang chạy sau Cloudflare / reverse proxy không, IP người gọi theo HCDrive, và header của chính request này.', descEn: 'Whether HCDrive runs behind Cloudflare / a reverse proxy, the caller\'s IP as seen, and this request\'s headers.', responseExample: json({ mode: 'auto', envTrustProxy: null, clientIp: '203.0.113.9', detected: { ip: '203.0.113.9', viaCloudflare: true, viaProxy: true }, request: { peer: '172.18.0.5', host: 'drive.example.com', forwardedFor: '203.0.113.9, 172.70.1.2', realIp: '172.70.1.2', cfConnectingIp: '203.0.113.9', cfRay: '8f1a2b3c4d5e-SIN', forwardedProto: 'https' }, seenSecondsAgo: { cloudflare: 0, proxy: 0, direct: null } }) },
    { id: 'admin-network-set', method: 'PUT', path: '/system/security/network', category: 'admin', ...admin, titleVi: 'Chế độ tin proxy', titleEn: 'Proxy trust mode', descVi: 'auto: chỉ tin header từ Cloudflare và mạng nội bộ. off: không tin header nào. Bị khoá khi TRUST_PROXY đặt trong env.', descEn: 'auto: trust headers only from Cloudflare and private networks. off: trust none. Locked when TRUST_PROXY is set.', params: [p.body('mode', "'auto' | 'off'", true, 'Chế độ', 'Mode')], bodyExample: json({ mode: 'auto' }), responseExample: json({ mode: 'auto' }), errorStatus: 409, errorExample: err('SET_BY_ENV', 'TRUST_PROXY đang được đặt trong biến môi trường; xoá nó đi để chỉnh ở đây.') },
    { id: 'admin-backup', method: 'GET', path: '/system/backup', category: 'admin', ...admin, binary: true, titleVi: 'Sao lưu cơ sở dữ liệu', titleEn: 'Back up the database', descVi: 'Tải tệp SQLite. Chứa token đã mã hoá: cần cùng TOKEN_ENCRYPTION_KEY để dùng lại.', descEn: 'Downloads the SQLite file. Tokens inside are encrypted: restoring needs the same TOKEN_ENCRYPTION_KEY.', responseExample: 'Content-Disposition: attachment; filename="hcdrive-backup-2026-11-03.db"\n\n(binary)' },
    { id: 'admin-restore', method: 'POST', path: '/system/restore', category: 'admin', ...admin, titleVi: 'Khôi phục cơ sở dữ liệu', titleEn: 'Restore the database', descVi: 'multipart/form-data với tệp sao lưu SQLite của HCDrive. Thay thế toàn bộ dữ liệu hiện tại.', descEn: 'multipart/form-data with an HCDrive SQLite backup. Replaces all current data.', params: [p.form('file', '.db', true, 'Tệp sao lưu', 'Backup file')], curlSnippet: `curl -X POST "${baseUrl}/system/restore" \\\n  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\\n  -F "file=@hcdrive-backup.db"`, responseExample: json({ status: 'success', message: 'Database restored successfully. Server will restart in 2 seconds.' }), errorStatus: 400, errorExample: err('INVALID_BACKUP_FILE', 'The uploaded file is not an HCDrive SQLite backup.') },
    { id: 'admin-update', method: 'POST', path: '/system/update', category: 'admin', ...admin, titleVi: 'Cập nhật HCDrive', titleEn: 'Update HCDrive', descVi: 'Chạy quy trình cập nhật mã nguồn trên máy chủ (khi cài thủ công); theo dõi bằng /system/update-log.', descEn: 'Runs the server-side update (manual installs); follow /system/update-log.', responseExample: json({ status: 'success', message: 'System update initiated. Rebuilding and restarting backend & frontend in the background. Please wait ~1 minute and refresh the page.' }) },
    { id: 'admin-update-log', method: 'GET', path: '/system/update-log', category: 'admin', ...admin, titleVi: 'Nhật ký cập nhật', titleEn: 'Update log', descVi: 'Nội dung log của lần cập nhật gần nhất.', descEn: 'Output of the latest update.', responseExample: json({ log: '[update] git pull…\n[update] npm run build…' }) },
  ]
  return list.map((endpoint) => withSnippets(baseUrl, endpoint))
}
