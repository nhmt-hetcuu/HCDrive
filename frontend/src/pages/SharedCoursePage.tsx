import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ExternalLink, GraduationCap, Loader2, Plus, UserRound, XCircle } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { Button } from '@/components/ui/button'

// Opens an internal course share link (/library/s/:token): the course details someone in this HCDrive
// shared, and a button to add it to the viewer's own Courses. Watching needs the viewer's own Google access.

type SharedCourse = {
  course: { title: string; teacher: string; collection: string; isFolder: boolean; url: string; ownerName: string | null; ownerEmail: string | null; sharedBy: string }
  savedLinkId: string | null
  access: { ok: boolean; accountEmail: string | null }
  accountEmails: string[]
}

export function SharedCoursePage() {
  const { token = '' } = useParams()
  const { lang } = useLanguage()
  const vi = lang === 'vi'
  const navigate = useNavigate()
  const [data, setData] = useState<SharedCourse | null>(null)
  const [error, setError] = useState('')
  const [collection, setCollection] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    apiFetch<SharedCourse>(`/library/shared/${encodeURIComponent(token)}`)
      .then((result) => {
        setData(result)
        setCollection(result.course.collection)
      })
      .catch((err) => setError(err instanceof Error ? err.message : vi ? 'Không mở được link' : 'Could not open the link'))
  }, [token, vi])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      const result = await apiFetch<{ link: { id: string } }>(`/library/shared/${encodeURIComponent(token)}/save`, { method: 'POST', body: JSON.stringify({ collection: collection.trim() }) })
      navigate(`/library?link=${result.link.id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : vi ? 'Không thêm được' : 'Could not add')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full justify-center overflow-y-auto p-4 sm:p-8">
      <div className="w-full max-w-lg">
        {!data && !error ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : null}
        {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
        {data ? (
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 dark:border-slate-800 dark:bg-[#1e1f20]">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#c2e7ff]/60 dark:bg-[#004a77]">
                <GraduationCap className="h-6 w-6 text-[#0b57d0] dark:text-[#a8c7fa]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400">{vi ? `${data.course.sharedBy} chia sẻ khóa học` : `${data.course.sharedBy} shared a course`}</p>
                <h1 className="mt-0.5 text-lg font-medium text-slate-900 dark:text-slate-100">{data.course.title}</h1>
                {data.course.teacher ? <p className="mt-1 flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300"><UserRound className="h-4 w-4 text-slate-400" />{vi ? 'Giảng viên' : 'Teacher'}: {data.course.teacher}</p> : null}
                {data.course.ownerName || data.course.ownerEmail ? <p className="mt-1 text-xs text-slate-500">{vi ? 'Chủ sở hữu trên Drive' : 'Drive owner'}: {data.course.ownerName || data.course.ownerEmail}</p> : null}
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-slate-50 p-3 text-sm dark:bg-[#131314]">
              {data.access.ok ? (
                <p className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{vi ? `Bạn xem được khóa này bằng ${data.access.accountEmail}.` : `You can watch this course with ${data.access.accountEmail}.`}</p>
              ) : (
                <div className="space-y-2 text-slate-700 dark:text-slate-200">
                  <p className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    {data.accountEmails.length
                      ? vi ? `Chưa tài khoản Google nào của bạn (${data.accountEmails.join(', ')}) được chia sẻ khóa này.` : `None of your Google accounts (${data.accountEmails.join(', ')}) has access to this course.`
                      : vi ? 'Bạn chưa kết nối tài khoản Google nào với HCDrive.' : 'You have not connected a Google account to HCDrive.'}
                  </p>
                  <p className="text-xs text-slate-500">{vi ? 'Xin người bán / giảng viên chia sẻ khóa cho email Google của bạn (mở link bên dưới để gửi yêu cầu), rồi tải lại trang này.' : 'Ask the course owner to share it with your Google email (open the link below to request access), then reload this page.'}</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <a href={data.course.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]"><ExternalLink className="h-3.5 w-3.5" />{vi ? 'Xin quyền trên Google Drive' : 'Request access on Google Drive'}</a>
                    {!data.accountEmails.length ? <a href="/accounts" className="font-medium text-[#0b57d0] hover:underline dark:text-[#a8c7fa]">{vi ? 'Kết nối tài khoản Google' : 'Connect a Google account'}</a> : null}
                  </div>
                </div>
              )}
            </div>

            {data.savedLinkId ? (
              <div className="mt-5 flex justify-end">
                <Button size="sm" onClick={() => navigate(`/library?link=${data.savedLinkId}`)}>{vi ? 'Đã có trong Khóa học — mở' : 'Already in your Courses — open'}</Button>
              </div>
            ) : (
              <form onSubmit={save} className="mt-5 space-y-3">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {vi ? 'Xếp vào khóa (nhóm)' : 'File under course (group)'}
                  <input value={collection} onChange={(event) => setCollection(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/20 dark:border-slate-700 dark:bg-[#131314] dark:text-slate-100" />
                </label>
                {saveError ? <p className="text-[13px] text-red-600 dark:text-red-400">{saveError}</p> : null}
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={saving || !data.access.ok}>
                    {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                    {vi ? 'Thêm vào Khóa học của tôi' : 'Add to my Courses'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
