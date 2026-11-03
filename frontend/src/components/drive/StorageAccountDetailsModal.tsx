import { useEffect, useState, type ReactNode } from 'react'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'

type AccountDetails = {
  id: string
  provider: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  providerAccountId: string
  status: string
  lastError: string | null
  connectedVia: 'login' | 'oauth' | 'manual_token' | 'auth_code' | 's3' | 'import' | null
  createdAt: string
  updatedAt: string
  isShared: boolean
  isOwner: boolean
  owner: { name: string; email: string }
  usedForLogin: boolean
  oauthClient: { kind: 'rclone' | 'custom'; clientId: string | null } | null
  customOAuthAvailable?: boolean
  scopes: string[] | null
  token: { hasRefreshToken: boolean; accessTokenExpiresAt: string | null } | null
  proxyUrl: string | null
  hasProxy: boolean
  s3: {
    name: string
    bucket: string
    region: string
    endpoint: string | null
    prefix: string
    forcePathStyle: boolean
    quotaBytes: string | null
    accessKeyId: string | null
  } | null
  storage: { totalBytes: string | null; usedBytes: string; availableBytes: string | null; trashBytes: string | null; lastSyncedAt: string | null } | null
  hcdrive: { fileCount: number; fileBytes: string; duplicateRows?: number; folderCount: number }
}

const SCOPE_LABELS: Record<string, [string, string]> = {
  'https://www.googleapis.com/auth/drive': ['Toàn quyền Google Drive', 'Full Google Drive access'],
  'https://www.googleapis.com/auth/drive.file': ['Tệp do HCDrive tạo', 'Files created by HCDrive'],
  'https://www.googleapis.com/auth/userinfo.email': ['Email', 'Email address'],
  'https://www.googleapis.com/auth/userinfo.profile': ['Tên và ảnh hồ sơ', 'Name and profile picture'],
  openid: ['Định danh OpenID', 'OpenID identity'],
}

function connectedViaLabel(via: AccountDetails['connectedVia'], vi: boolean) {
  switch (via) {
    case 'login': return vi ? 'Đăng nhập HCDrive bằng Google (tự kết nối Drive)' : 'Signing in to HCDrive with Google (Drive connected automatically)'
    case 'oauth': return vi ? 'Nút "Kết nối Google Drive" (đăng nhập Google, cấp quyền)' : '"Connect Google Drive" button (Google sign-in and consent)'
    case 'manual_token': return vi ? 'Dán refresh token thủ công' : 'Pasted refresh token'
    case 'auth_code': return vi ? 'Dán mã uỷ quyền (authorization code)' : 'Pasted authorization code'
    case 's3': return vi ? 'Khoá truy cập S3 (access key)' : 'S3 access keys'
    case 'import': return vi ? 'Nhập từ tệp JSON' : 'Imported from a JSON file'
    default: return vi ? 'Không rõ (kết nối trước khi HCDrive ghi lại thông tin này)' : 'Unknown (connected before HCDrive recorded this)'
  }
}

export function StorageAccountDetailsModal({ accountId, vi, isAdmin = false, onClose, onReconnect }: { accountId: string | null; vi: boolean; isAdmin?: boolean; onClose: () => void; onReconnect?: () => void }) {
  const [details, setDetails] = useState<AccountDetails | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    setDetails(null)
    setError('')
    apiFetch<AccountDetails>(`/connected-accounts/${accountId}/details`)
      .then((data) => { if (!cancelled) setDetails(data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : vi ? 'Không tải được thông tin' : 'Could not load details') })
    return () => { cancelled = true }
  }, [accountId])

  const isGoogle = details?.provider === 'google_drive'

  return (
    <DummyModal
      open={Boolean(accountId)}
      title={vi ? 'Thông tin tài khoản lưu trữ' : 'Storage account details'}
      description={details ? (details.displayName && details.displayName !== details.email ? `${details.displayName} · ${details.email}` : details.email) : undefined}
      onClose={onClose}
      className="sm:max-w-xl"
    >
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {!details && !error ? <p className="py-6 text-center text-xs text-slate-400">{vi ? 'Đang tải...' : 'Loading...'}</p> : null}
      {details ? (
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-xs">
          <Section title={vi ? 'Liên kết' : 'Connection'}>
            <Row label={vi ? 'Loại' : 'Type'}>{isGoogle ? 'Google Drive' : vi ? 'Bộ nhớ tương thích S3' : 'S3-compatible storage'}</Row>
            <Row label={vi ? 'Kết nối bằng' : 'Connected via'}>{connectedViaLabel(details.connectedVia, vi)}</Row>
            {details.oauthClient ? (
              <Row label={vi ? 'Ứng dụng OAuth' : 'OAuth client'}>
                {details.oauthClient.kind === 'custom'
                  ? (vi ? 'OAuth riêng (Google Cloud của bạn)' : 'Your own OAuth client (Google Cloud)')
                  : (vi ? 'OAuth mặc định dùng chung (rclone)' : 'Default shared OAuth client (rclone)')}
                {details.oauthClient.clientId ? <span className="block break-all font-mono text-[11px] text-slate-400">{details.oauthClient.clientId}</span> : null}
              </Row>
            ) : null}
            {details.oauthClient?.kind === 'rclone' ? (
              <div className="bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                <p>
                  {vi
                    ? 'OAuth mặc định (rclone) dùng chung hạn mức request/phút với mọi người dùng rclone trên thế giới, nên hay gặp lỗi "Quota exceeded … Requests per minute". OAuth riêng có hạn mức riêng (khoảng 12.000 request/phút).'
                    : 'The default (rclone) OAuth client shares its per-minute request limit with every rclone user, hence frequent "Quota exceeded … Requests per minute". Your own OAuth client has its own limit (about 12,000 requests/minute).'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {details.customOAuthAvailable && onReconnect && details.isOwner ? (
                    <Button size="sm" variant="filled" onClick={onReconnect}>{vi ? 'Kết nối lại bằng OAuth riêng' : 'Reconnect with your OAuth client'}</Button>
                  ) : null}
                  {!details.customOAuthAvailable && isAdmin ? (
                    <a href="/settings?tab=google" className="font-semibold text-[#0b57d0] dark:text-[#a8c7fa] hover:underline">{vi ? 'Nhập OAuth riêng trong Cài đặt → Google OAuth' : 'Add your OAuth client in Settings → Google OAuth'}</a>
                  ) : null}
                  {!details.customOAuthAvailable && !isAdmin ? <span>{vi ? 'Nhờ quản trị viên nhập OAuth riêng trong Cài đặt → Google OAuth.' : 'Ask an administrator to add an OAuth client in Settings → Google OAuth.'}</span> : null}
                </div>
                {details.customOAuthAvailable ? (
                  <p className="mt-1.5 text-amber-800/80 dark:text-amber-300/80">
                    {vi
                      ? 'Trong hộp kết nối chọn "OAuth riêng" rồi đăng nhập đúng tài khoản Google này: HCDrive cập nhật tài khoản đang có, tệp và thư mục giữ nguyên.'
                      : 'Pick "Custom OAuth" in the connect dialog and sign in to this same Google account: HCDrive updates the existing account; files and folders stay.'}
                  </p>
                ) : null}
              </div>
            ) : null}
            {isGoogle ? <Row label={vi ? 'ID tài khoản Google' : 'Google account ID'}><span className="font-mono">{details.providerAccountId}</span></Row> : null}
            {isGoogle ? (
              <Row label={vi ? 'Dùng để đăng nhập' : 'Used to sign in'}>
                {details.usedForLogin
                  ? (vi ? 'Có, chủ tài khoản đăng nhập HCDrive được bằng Google này' : 'Yes, the owner can sign in to HCDrive with this Google account')
                  : (vi ? 'Không, chỉ dùng làm kho lưu trữ' : 'No, storage only')}
              </Row>
            ) : null}
            <Row label={vi ? 'Kết nối lúc' : 'Connected on'}>{formatDate(details.createdAt)}</Row>
            <Row label={vi ? 'Cập nhật lần cuối' : 'Last updated'}>{formatDate(details.updatedAt)}</Row>
            <Row label={vi ? 'Trạng thái' : 'Status'}>
              {details.status === 'connected' ? (vi ? 'Đã kết nối' : 'Connected') : details.status}
              {details.lastError ? <span className="block text-red-600 dark:text-red-400">{details.lastError}</span> : null}
              {details.lastError && /quota exceeded|rate limit/i.test(details.lastError) ? (
                <span className="block text-slate-500 dark:text-slate-400">
                  {vi
                    ? 'Google từ chối vì OAuth client đã dùng hết lượt request trong phút đó. HCDrive tự tạm dừng đồng bộ của tài khoản này 1 phút, tải lên chuyển sang tài khoản khác; lỗi tự xoá khi Google trả lời bình thường lại.'
                    : 'Google refused because the OAuth client used up its requests for that minute. HCDrive pauses this account\'s syncing for a minute and routes uploads elsewhere; the error clears once Google answers again.'}
                </span>
              ) : null}
            </Row>
          </Section>

          <Section title={vi ? 'Quyền sở hữu' : 'Ownership'}>
            <Row label={vi ? 'Chủ sở hữu' : 'Owner'}>{details.isOwner ? (vi ? 'Bạn' : 'You') : `${details.owner.name} (${details.owner.email})`}</Row>
            <Row label={vi ? 'Dùng chung' : 'Shared'}>{details.isShared ? (vi ? 'Mọi người dùng HCDrive đều tải lên được' : 'Every HCDrive user can upload to it') : (vi ? 'Chỉ chủ sở hữu' : 'Owner only')}</Row>
          </Section>

          {details.token ? (
            <Section title={vi ? 'Mã truy cập Google' : 'Google tokens'}>
              <Row label="Refresh token">{details.token.hasRefreshToken ? (vi ? 'Có (đã mã hoá trong cơ sở dữ liệu)' : 'Stored (encrypted)') : (vi ? 'Không có, cần kết nối lại' : 'Missing, reconnect needed')}</Row>
              {details.token.accessTokenExpiresAt ? <Row label="Access token">{(vi ? 'Hết hạn ' : 'Expires ') + formatDate(details.token.accessTokenExpiresAt)}<span className="block text-slate-400">{vi ? 'Tự làm mới khi cần' : 'Refreshed automatically'}</span></Row> : null}
              {details.scopes ? (
                <Row label={vi ? 'Quyền đã cấp' : 'Granted scopes'}>
                  <ul className="space-y-0.5">
                    {details.scopes.map((scope) => (
                      <li key={scope} title={scope}>{SCOPE_LABELS[scope]?.[vi ? 0 : 1] ?? scope}</li>
                    ))}
                  </ul>
                </Row>
              ) : null}
            </Section>
          ) : null}

          {details.s3 ? (
            <Section title="S3">
              <Row label="Bucket">{details.s3.bucket}</Row>
              <Row label="Region">{details.s3.region}</Row>
              <Row label="Endpoint">{details.s3.endpoint || 'Amazon S3'}</Row>
              <Row label={vi ? 'Thư mục gốc (prefix)' : 'Prefix'}>{details.s3.prefix}</Row>
              <Row label="Path-style">{details.s3.forcePathStyle ? (vi ? 'Bật' : 'On') : (vi ? 'Tắt' : 'Off')}</Row>
              {details.s3.accessKeyId ? <Row label="Access key ID"><span className="font-mono">{details.s3.accessKeyId}</span></Row> : null}
              <Row label={vi ? 'Hạn mức' : 'Quota'}>{details.s3.quotaBytes ? formatBytes(details.s3.quotaBytes) : (vi ? 'Không giới hạn' : 'Unlimited')}</Row>
            </Section>
          ) : null}

          {isGoogle && (details.isOwner || details.proxyUrl) ? (
            <Section title="Proxy">
              <Row label={vi ? 'Kết nối' : 'Route'}>
                {details.hasProxy ? <span className="break-all font-mono">{details.proxyUrl ?? (vi ? 'Có' : 'Yes')}</span> : (vi ? 'Trực tiếp, không qua proxy' : 'Direct, no proxy')}
              </Row>
            </Section>
          ) : null}

          <Section title={vi ? 'Dung lượng' : 'Storage'}>
            {details.storage ? (
              <>
                <Row label={vi ? 'Đã dùng' : 'Used'}>{formatBytes(details.storage.usedBytes)} / {details.storage.totalBytes ? formatBytes(details.storage.totalBytes) : (vi ? 'không giới hạn' : 'unlimited')}</Row>
                {details.storage.availableBytes ? <Row label={vi ? 'Còn trống' : 'Free'}>{formatBytes(details.storage.availableBytes)}</Row> : null}
                {details.storage.trashBytes && details.storage.trashBytes !== '0' ? <Row label={vi ? 'Trong thùng rác' : 'In trash'}>{formatBytes(details.storage.trashBytes)}</Row> : null}
                <Row label={vi ? 'Đồng bộ lần cuối' : 'Last synced'}>{details.storage.lastSyncedAt ? formatDate(details.storage.lastSyncedAt) : '--'}</Row>
              </>
            ) : (
              <Row label={vi ? 'Đã dùng' : 'Used'}>{vi ? 'Chưa đồng bộ' : 'Not synced yet'}</Row>
            )}
            <Row label={vi ? 'Danh mục HCDrive' : 'HCDrive index'}>
              {vi
                ? `${details.hcdrive.fileCount} tệp, ${details.hcdrive.folderCount} thư mục (tổng kích thước theo Google: ${formatBytes(details.hcdrive.fileBytes)})`
                : `${details.hcdrive.fileCount} files, ${details.hcdrive.folderCount} folders (${formatBytes(details.hcdrive.fileBytes)} in total, as reported by Google)`}
              <span className="block text-slate-400">
                {vi
                  ? 'HCDrive chỉ lưu tên, ID Google, kích thước và thư mục của tệp. Nội dung nằm trên Google; xem và tải đều stream thẳng từ Drive.'
                  : 'HCDrive keeps only each file\'s name, Google id, size and folder. The content stays on Google; viewing and downloading stream straight from Drive.'}
              </span>
              {details.hcdrive.duplicateRows ? (
                <span className="block text-amber-600 dark:text-amber-400">
                  {vi ? `${details.hcdrive.duplicateRows} dòng ghi trùng, sẽ được gộp ở lần đồng bộ tới.` : `${details.hcdrive.duplicateRows} duplicate rows, merged on the next sync.`}
                </span>
              ) : null}
            </Row>
          </Section>
        </div>
      ) : null}
    </DummyModal>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
      <dl className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800">{children}</dl>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  )
}
