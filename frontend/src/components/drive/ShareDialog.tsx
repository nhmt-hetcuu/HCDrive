import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle, Copy, Globe, Link2, Lock, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { apiFetch } from '@/lib/api'
import { copyText as writeClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

// One "Share" dialog for files and folders, laid out like Google Drive's:
// - Google Drive part: add people by email, change/remove their access, "anyone with the link".
// - HCDrive part (files only): the public HCDrive link that works without a Google account.

export type ShareTarget = {
  kind?: 'file' | 'folder'
  id: string
  name: string
  isFolder?: boolean
  /** 'google_drive' | 's3' for files; folders are treated as Google Drive. */
  provider?: string
}

type Role = 'reader' | 'commenter' | 'writer'
type Permission = { id: string; type: string; role: string; emailAddress: string | null; displayName: string | null; photoLink: string | null; domain: string | null; inherited: boolean; inheritedFrom: string | null; expirationTime: string | null; pendingOwner: boolean }
type DriveSharing = {
  name: string
  accountId: string
  accountEmail: string
  webViewLink: string | null
  canShare: boolean
  canManage: boolean
  copyRequiresWriterPermission: boolean
  copies: Array<{ accountId: string; email: string }>
  permissions: Permission[]
}

const roleLabels: Record<'vi' | 'en', Record<string, string>> = {
  vi: { owner: 'Chủ sở hữu', organizer: 'Người quản lý', fileOrganizer: 'Người quản lý nội dung', writer: 'Người chỉnh sửa', commenter: 'Người nhận xét', reader: 'Người xem' },
  en: { owner: 'Owner', organizer: 'Manager', fileOrganizer: 'Content manager', writer: 'Editor', commenter: 'Commenter', reader: 'Viewer' },
}
const editableRoles: Role[] = ['reader', 'commenter', 'writer']

function splitEmails(value: string) {
  return value.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean)
}

export function ShareDialog({ target, lang, onClose }: { target: ShareTarget | null; lang: 'vi' | 'en'; onClose: () => void }) {
  const vi = lang === 'vi'
  // Callers pass either `kind` or `isFolder`, and the provider either raw ('s3') or as the list label ('S3 Storage').
  const kind = target ? target.kind ?? (target.isFolder ? 'folder' : 'file') : 'file'
  const isS3 = target?.provider === 's3' || target?.provider === 'S3 Storage'
  const isDrive = target ? kind === 'folder' || !isS3 : false
  const base = target ? `/${kind === 'file' ? 'files' : 'folders'}/${target.id}` : ''

  const [accountId, setAccountId] = useState<string | null>(null)
  const [sharing, setSharing] = useState<DriveSharing | null>(null)
  const [loadingDrive, setLoadingDrive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [emails, setEmails] = useState('')
  const [newRole, setNewRole] = useState<Role>('reader')
  const [notify, setNotify] = useState(true)
  const [note, setNote] = useState('')
  const [applyToAllCopies, setApplyToAllCopies] = useState(false)

  const [hcdriveLink, setHcdriveLink] = useState('')
  const [copied, setCopied] = useState('')

  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''

  async function loadDrive() {
    if (!target || !isDrive) return
    setLoadingDrive(true)
    setError('')
    try {
      setSharing(await apiFetch<DriveSharing>(`${base}/drive-permissions${query}`))
    } catch (err) {
      setSharing(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingDrive(false)
    }
  }

  useEffect(() => {
    setAccountId(null)
    setSharing(null)
    setEmails('')
    setNote('')
    setNewRole('reader')
    setNotify(true)
    setApplyToAllCopies(false)
    setHcdriveLink('')
    setCopied('')
    setError('')
    setNotice('')
  }, [target?.kind, target?.id])

  useEffect(() => {
    loadDrive().catch(() => undefined)
  }, [target?.kind, target?.id, accountId])

  // A file that already has an HCDrive link shows it (with "Disable") instead of "Create".
  useEffect(() => {
    if (!target || kind !== 'file') return
    let cancelled = false
    apiFetch<{ url: string | null }>(`/files/${target.id}/share`)
      .then((data) => { if (!cancelled && data.url) setHcdriveLink(data.url) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [target?.kind, target?.id])

  if (!target) return null

  function flash(text: string) {
    setNotice(text)
    window.setTimeout(() => setNotice((current) => (current === text ? '' : current)), 3000)
  }

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError('')
    try {
      await task()
      flash(success)
      await loadDrive()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function addPeople(event: FormEvent) {
    event.preventDefault()
    const list = splitEmails(emails)
    if (list.length === 0) return
    const targets = applyToAllCopies && sharing && sharing.copies.length > 1 ? sharing.copies.map((copy) => copy.accountId) : [accountId]
    await run(async () => {
      for (const copyAccountId of targets) {
        const copyQuery = copyAccountId ? `?accountId=${encodeURIComponent(copyAccountId)}` : ''
        for (const emailAddress of list) {
          await apiFetch(`${base}/drive-permissions${copyQuery}`, {
            method: 'POST',
            body: JSON.stringify({ type: 'user', role: newRole, emailAddress, sendNotificationEmail: notify, ...(notify && note.trim() ? { emailMessage: note.trim() } : {}) }),
          })
        }
      }
      setEmails('')
      setNote('')
    }, vi ? `Đã chia sẻ với ${list.join(', ')}` : `Shared with ${list.join(', ')}`)
  }

  const anyone = sharing?.permissions.find((permission) => permission.type === 'anyone') ?? null
  const people = (sharing?.permissions ?? [])
    .filter((permission) => permission.type !== 'anyone')
    .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0))
  const readOnly = !sharing?.canShare || busy

  function setGeneralAccess(mode: 'restricted' | 'anyone', role: Role = 'reader') {
    if (mode === 'restricted') {
      if (!anyone) return
      return run(() => apiFetch(`${base}/drive-permissions/${anyone.id}${query}`, { method: 'DELETE' }), vi ? 'Đã chuyển về Hạn chế' : 'Access restricted')
    }
    return run(() => apiFetch(`${base}/drive-permissions${query}`, { method: 'POST', body: JSON.stringify({ type: 'anyone', role }) }), vi ? 'Ai có link đều mở được' : 'Anyone with the link can open it')
  }

  // Returns false when the browser refuses to copy; the link is still on screen to copy by hand.
  async function copyText(text: string, key: string) {
    try {
      await writeClipboard(text)
    } catch {
      flash(vi ? 'Trình duyệt không cho sao chép tự động, hãy chép link trong ô.' : 'The browser blocked copying; copy the link from the box.')
      return false
    }
    setCopied(key)
    window.setTimeout(() => setCopied((current) => (current === key ? '' : current)), 1800)
    return true
  }

  async function createHcdriveLink() {
    setBusy(true)
    setError('')
    try {
      const data = await apiFetch<{ url: string }>(`/files/${target!.id}/share`, { method: 'POST' })
      setHcdriveLink(data.url)
      if (await copyText(data.url, 'hcdrive')) flash(vi ? 'Đã tạo và sao chép link HCDrive' : 'HCDrive link created and copied')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function disableHcdriveLink() {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/files/${target!.id}/share`, { method: 'DELETE' })
      setHcdriveLink('')
      flash(vi ? 'Đã tắt link HCDrive' : 'HCDrive link disabled')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Access ends at the end of the chosen day (local time); an empty value removes the end date.
  function setExpiry(permission: Permission, day: string) {
    const expirationTime = day ? new Date(`${day}T23:59:59`).toISOString() : null
    return run(
      () => apiFetch(`${base}/drive-permissions/${permission.id}${query}`, { method: 'PATCH', body: JSON.stringify({ role: permission.role, expirationTime }) }),
      day ? (vi ? `Quyền truy cập hết hạn ngày ${new Date(`${day}T00:00:00`).toLocaleDateString('vi-VN')}` : 'Expiry date set') : (vi ? 'Đã bỏ ngày hết hạn' : 'Expiry removed'),
    )
  }

  function transferOwnership(permission: Permission, label: string) {
    if (!window.confirm(vi ? `Chuyển quyền sở hữu "${target!.name}" cho ${label}? Bạn vẫn còn quyền chỉnh sửa, nhưng không còn là chủ sở hữu.` : `Make ${label} the owner of "${target!.name}"? You keep edit access but stop being the owner.`)) return
    return run(async () => {
      const result = await apiFetch<{ mode: 'transferred' | 'pending' }>(`${base}/drive-permissions/${permission.id}/transfer-ownership${query}`, { method: 'POST' })
      if (result.mode === 'pending') window.alert(vi ? `Đã gửi lời mời làm chủ sở hữu tới ${label}. Họ cần chấp nhận trong Google Drive thì quyền sở hữu mới chuyển.` : `Ownership was offered to ${label}; it moves once they accept it in Google Drive.`)
    }, vi ? 'Đã gửi yêu cầu chuyển quyền sở hữu' : 'Ownership request sent')
  }

  const roleSelect = (value: string, onChange: (role: Role) => void, disabled: boolean, extra?: { remove?: () => void; transferOwner?: () => void }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => {
        if (event.target.value === '__remove') extra?.remove?.()
        else if (event.target.value === '__owner') extra?.transferOwner?.()
        else onChange(event.target.value as Role)
      }}
      className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-2 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-60"
    >
      {editableRoles.map((role) => <option key={role} value={role}>{roleLabels[lang][role]}</option>)}
      {!editableRoles.includes(value as Role) ? <option value={value}>{roleLabels[lang][value] ?? value}</option> : null}
      {extra?.transferOwner ? <option value="__owner">{vi ? 'Chuyển quyền sở hữu' : 'Transfer ownership'}</option> : null}
      {extra?.remove ? <option value="__remove">{vi ? 'Xoá quyền truy cập' : 'Remove access'}</option> : null}
    </select>
  )

  return (
    <DummyModal open title={vi ? `Chia sẻ "${target.name}"` : `Share "${target.name}"`} description={sharing ? (vi ? `Lưu trên ${sharing.accountEmail}` : `Stored in ${sharing.accountEmail}`) : ''} onClose={onClose} className="sm:max-w-xl">
      <div className="grid gap-5">
        {error ? <p className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {notice ? <p className="flex items-center gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle className="h-4 w-4" />{notice}</p> : null}

        {isDrive ? (
          <section className="grid gap-4">
            {sharing && sharing.copies.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {sharing.copies.map((copy) => (
                  <button
                    key={copy.accountId}
                    type="button"
                    onClick={() => setAccountId(copy.accountId)}
                    className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition', copy.accountId === sharing.accountId ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282a2c]')}
                  >
                    {copy.email}
                  </button>
                ))}
              </div>
            ) : null}

            {loadingDrive && !sharing ? <p className="text-sm text-slate-500 dark:text-slate-400">{vi ? 'Đang đọc quyền chia sẻ từ Google Drive…' : 'Loading Google Drive sharing…'}</p> : null}

            {sharing ? (
              <>
                {!sharing.canManage ? <p className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">{vi ? 'Chỉ chủ của tài khoản lưu trữ này mới đổi được quyền chia sẻ trên Google Drive.' : 'Only the owner of this storage account can change Google Drive sharing.'}</p> : null}

                <form onSubmit={addPeople} className="grid gap-2">
                  <div className="flex gap-2">
                    <input
                      value={emails}
                      onChange={(event) => setEmails(event.target.value)}
                      disabled={readOnly}
                      placeholder={vi ? 'Thêm người: nhập email (cách nhau bởi dấu phẩy)' : 'Add people: emails, comma separated'}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-3 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                    />
                    {roleSelect(newRole, setNewRole, readOnly)}
                  </div>
                  {splitEmails(emails).length > 0 ? (
                    <div className="grid gap-2 rounded-xl bg-slate-50 dark:bg-[#282a2c] p-3">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />{vi ? 'Gửi email thông báo' : 'Notify people'}</label>
                      {notify ? <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder={vi ? 'Lời nhắn (tuỳ chọn)' : 'Message (optional)'} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e1f20] p-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none" /> : null}
                      {sharing.copies.length > 1 ? <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><input type="checkbox" checked={applyToAllCopies} onChange={(event) => setApplyToAllCopies(event.target.checked)} />{vi ? `Áp dụng cho cả ${sharing.copies.length} bản của thư mục (mỗi tài khoản một bản)` : `Apply to all ${sharing.copies.length} copies of this folder`}</label> : null}
                      <div className="flex justify-end"><Button size="sm" disabled={readOnly}>{vi ? 'Gửi' : 'Share'}</Button></div>
                    </div>
                  ) : null}
                </form>

                <div className="grid gap-1">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{vi ? 'Những người có quyền truy cập' : 'People with access'}</h3>
                  <ul className="grid gap-1">
                    {people.map((permission) => {
                      const label = permission.displayName || permission.emailAddress || permission.domain || permission.type
                      const fixed = permission.role === 'owner' || permission.inherited
                      return (
                        <li key={permission.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-[#282a2c]">
                          {permission.photoLink ? <img src={permission.photoLink} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-xs font-bold text-blue-700 dark:text-blue-300">{label.charAt(0).toUpperCase()}</span>}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                              {permission.emailAddress ?? permission.domain ?? ''}
                              {permission.inherited ? (vi ? ' · kế thừa từ thư mục cha' : ' · inherited from parent folder') : ''}
                              {permission.pendingOwner ? (vi ? ' · chờ nhận quyền sở hữu' : ' · pending owner') : ''}
                            </p>
                            {!fixed && permission.type === 'user' ? (
                              <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {vi ? 'Hết hạn:' : 'Expires:'}
                                <input
                                  type="date"
                                  disabled={readOnly}
                                  min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                                  value={permission.expirationTime ? new Date(permission.expirationTime).toLocaleDateString('en-CA') : ''}
                                  onChange={(event) => setExpiry(permission, event.target.value)}
                                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-1 py-0.5 text-[11px] text-slate-700 dark:text-slate-200 disabled:opacity-60"
                                />
                                {permission.expirationTime ? <button type="button" disabled={readOnly} onClick={() => setExpiry(permission, '')} className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">{vi ? 'Bỏ' : 'Clear'}</button> : null}
                              </label>
                            ) : null}
                          </div>
                          {fixed ? (
                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{roleLabels[lang][permission.role] ?? permission.role}</span>
                          ) : (
                            roleSelect(
                              permission.role,
                              (role) => run(() => apiFetch(`${base}/drive-permissions/${permission.id}${query}`, { method: 'PATCH', body: JSON.stringify({ role }) }), vi ? 'Đã đổi quyền' : 'Access updated'),
                              readOnly,
                              {
                                remove: () => run(() => apiFetch(`${base}/drive-permissions/${permission.id}${query}`, { method: 'DELETE' }), vi ? `Đã xoá quyền của ${label}` : `Removed ${label}`),
                                ...(permission.type === 'user' ? { transferOwner: () => transferOwnership(permission, label) } : {}),
                              },
                            )
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>

                <div className="grid gap-2">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{vi ? 'Quyền truy cập chung' : 'General access'}</h3>
                  <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', anyone ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400')}>
                      {anyone ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <select
                        value={anyone ? 'anyone' : 'restricted'}
                        disabled={readOnly}
                        onChange={(event) => setGeneralAccess(event.target.value as 'restricted' | 'anyone')}
                        className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-2 text-sm font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-60"
                      >
                        <option value="restricted">{vi ? 'Hạn chế' : 'Restricted'}</option>
                        <option value="anyone">{vi ? 'Bất kỳ ai có đường liên kết' : 'Anyone with the link'}</option>
                      </select>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {anyone
                          ? (vi ? 'Mọi người trên Internet có đường liên kết đều mở được.' : 'Anyone on the Internet with the link can open it.')
                          : (vi ? 'Chỉ những người được thêm ở trên mới mở được.' : 'Only people added above can open it.')}
                      </p>
                    </div>
                    {anyone ? roleSelect(anyone.role, (role) => setGeneralAccess('anyone', role), readOnly) : null}
                  </div>
                  <label className="flex items-start gap-2 px-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={readOnly}
                      checked={sharing.copyRequiresWriterPermission}
                      onChange={(event) => run(() => apiFetch(`${base}/drive-settings${query}`, { method: 'PATCH', body: JSON.stringify({ copyRequiresWriterPermission: event.target.checked }) }), vi ? 'Đã lưu cài đặt' : 'Setting saved')}
                    />
                    {vi ? 'Người xem và người nhận xét không được tải xuống, in hoặc sao chép' : 'Viewers and commenters cannot download, print or copy'}
                  </label>
                  {anyone?.role === 'writer' ? <p className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-950/40 p-2.5 text-xs font-semibold text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{vi ? 'Ai có link cũng sửa và xoá được nội dung.' : 'Anyone with the link can edit and delete the content.'}</p> : null}
                </div>

                {sharing.webViewLink ? (
                  <Button variant="outline" className="justify-center" onClick={() => copyText(sharing.webViewLink!, 'drive')}>
                    {copied === 'drive' ? <CheckCircle className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    {copied === 'drive' ? (vi ? 'Đã sao chép' : 'Copied') : (vi ? 'Sao chép đường liên kết Google Drive' : 'Copy Google Drive link')}
                  </Button>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {kind === 'file' ? (
          <section className={cn('grid gap-2', isDrive && 'border-t border-slate-100 dark:border-slate-800 pt-4')}>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{vi ? 'Link HCDrive (không cần tài khoản Google)' : 'HCDrive link (no Google account needed)'}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{vi ? 'Ai có link đều xem và tải được qua HCDrive. Tắt link bất cứ lúc nào.' : 'Anyone with the link can view and download through HCDrive. Turn it off at any time.'}</p>
            {hcdriveLink ? (
              <>
                <div className="flex gap-2">
                  <input readOnly value={hcdriveLink} className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#282a2c] px-3 text-sm text-slate-900 dark:text-slate-100" onFocus={(event) => event.currentTarget.select()} />
                  <Button variant="outline" onClick={() => copyText(hcdriveLink, 'hcdrive')}>{copied === 'hcdrive' ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === 'hcdrive' ? (vi ? 'Đã chép' : 'Copied') : (vi ? 'Chép' : 'Copy')}</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => copyText(`<iframe src="${hcdriveLink}/embed" width="640" height="480" allow="fullscreen" style="border:0"></iframe>`, 'embed')}>
                    {copied === 'embed' ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{vi ? 'Chép mã nhúng' : 'Copy embed code'}
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={disableHcdriveLink}><Trash2 className="h-4 w-4" />{vi ? 'Tắt link' : 'Disable link'}</Button>
                </div>
              </>
            ) : (
              <Button variant="outline" disabled={busy} onClick={createHcdriveLink} className="justify-center"><Link2 className="h-4 w-4" />{vi ? 'Tạo & sao chép link HCDrive' : 'Create & copy HCDrive link'}</Button>
            )}
          </section>
        ) : null}

        <div className="flex justify-end"><Button onClick={onClose}><X className="h-4 w-4" />{vi ? 'Xong' : 'Done'}</Button></div>
      </div>
    </DummyModal>
  )
}
