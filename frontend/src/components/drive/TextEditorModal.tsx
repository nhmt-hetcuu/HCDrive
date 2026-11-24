import { useEffect, useState, useRef, useMemo } from 'react'
import {
  FileText,
  Save,
  Check,
  Download,
  Sparkles,
  Loader2,
  AlertCircle,
  Copy,
} from 'lucide-react'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { useLanguage } from '@/context/LanguageContext'
import { useSnackbar } from '@/context/SnackbarContext'
import { useDownload } from '@/context/DownloadContext'
import { startDriveAction } from '@/lib/drive-actions'
import type { FileItem } from '@/data/drive-data'

interface TextEditorModalProps {
  open: boolean
  file: FileItem | null
  onClose: () => void
}

export function TextEditorModal({ open, file, onClose }: TextEditorModalProps) {
  const { lang } = useLanguage()
  const { showSnackbar } = useSnackbar()
  const { startDownload } = useDownload()
  const vi = lang === 'vi'

  const fileId = file?.id || file?.providerFileId

  const [content, setContent] = useState('')
  const [initialContent, setInitialContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isGoogleDoc, setIsGoogleDoc] = useState(false)
  const [canSaveDirectly, setCanSaveDirectly] = useState(true)
  const [docNotice, setDocNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isDirty = useMemo(() => content !== initialContent, [content, initialContent])

  useEffect(() => {
    if (!open || !fileId) return
    setErrorMsg(null)
    setDocNotice(null)
    setLoading(true)

    apiFetch<{
      name: string
      mimeType: string
      content: string
      isGoogleDoc: boolean
      canSaveDirectly: boolean
      message?: string
    }>(`/files/${fileId}/text-content`)
      .then((res) => {
        setContent(res.content || '')
        setInitialContent(res.content || '')
        setIsGoogleDoc(Boolean(res.isGoogleDoc))
        setCanSaveDirectly(Boolean(res.canSaveDirectly))
        if (res.message) setDocNotice(res.message)
      })
      .catch((err: any) => {
        setErrorMsg(err?.message || (vi ? 'Không thể tải nội dung tệp.' : 'Failed to load file text.'))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, fileId, vi])

  // Support Ctrl+S / Cmd+S keyboard shortcut
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (canSaveDirectly && isDirty && !saving) {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, canSaveDirectly, isDirty, saving, content])

  async function handleSave() {
    if (!fileId || !canSaveDirectly || saving) return
    setSaving(true)
    setErrorMsg(null)
    try {
      await apiFetch(`/files/${fileId}/text-content`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      })
      setInitialContent(content)
      showSnackbar(vi ? 'Đã lưu thay đổi thành công' : 'File saved successfully')
    } catch (err: any) {
      const msg = err?.message || (vi ? 'Lỗi khi lưu tệp.' : 'Failed to save file.')
      setErrorMsg(msg)
      showSnackbar(msg)
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDownInTextarea(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Support Tab key indentation (2 spaces)
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const newContent = content.substring(0, start) + '  ' + content.substring(end)
      setContent(newContent)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2
        }
      }, 0)
    }
  }

  function handleOpenTemporaryEdit() {
    if (!file) return
    onClose()
    startDriveAction({ action: 'temporary_edit', file })
  }

  function handleCopy() {
    navigator.clipboard.writeText(content)
    setCopied(true)
    showSnackbar(vi ? 'Đã sao chép văn bản' : 'Text copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDownload() {
    if (!file || !fileId) return
    startDownload(`/files/${fileId}/download`, file.name, { auth: true })
  }

  const lineCount = useMemo(() => {
    if (!content) return 0
    return content.split('\n').length
  }, [content])

  return (
    <DummyModal
      open={open}
      onClose={() => {
        if (isDirty && canSaveDirectly) {
          if (confirm(vi ? 'Bạn có thay đổi chưa lưu. Bạn có chắc muốn đóng?' : 'You have unsaved changes. Discard?')) {
            onClose()
          }
        } else {
          onClose()
        }
      }}
      className="sm:max-w-4xl h-[90vh] flex flex-col"
      title={
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium text-slate-900 dark:text-slate-100 truncate">
                {file?.name || 'Text Editor'}
              </h2>
              {isDirty && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-medium">
                  {vi ? 'Chưa lưu' : 'Unsaved'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              {lineCount} {vi ? 'dòng' : 'lines'} • {content.length} {vi ? 'ký tự' : 'chars'}
            </p>
          </div>
        </div>
      }
    >
      <div className="flex flex-1 flex-col min-h-0 space-y-2 pt-2">
        {/* Google Doc Notice Banner */}
        {isGoogleDoc && docNotice && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200">
            <div className="space-y-0.5 min-w-0">
              <p className="font-semibold">{vi ? 'Xem trước nội dung Google Docs' : 'Google Docs Preview'}</p>
              <p className="text-blue-700 dark:text-blue-300 text-[11px] truncate">{docNotice}</p>
            </div>
            <Button
              size="sm"
              onClick={handleOpenTemporaryEdit}
              className="gap-1.5 text-xs h-7 shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{vi ? 'Tự cấp quyền chỉnh sửa' : 'Grant Edit'}</span>
            </Button>
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="truncate">{errorMsg}</span>
          </div>
        )}

        {/* Text Area */}
        <div className="relative flex-1 min-h-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span>{vi ? 'Đang tải nội dung...' : 'Loading content...'}</span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDownInTextarea}
              readOnly={!canSaveDirectly}
              placeholder={vi ? 'Nhập nội dung văn bản...' : 'Enter text here...'}
              className="w-full h-full p-4 font-mono text-xs sm:text-[13px] leading-relaxed text-slate-800 dark:text-slate-100 bg-transparent resize-none focus:outline-none selection:bg-blue-200 dark:selection:bg-blue-900/60"
            />
          )}
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 text-xs gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {vi ? 'Sao chép' : 'Copy'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} className="h-8 text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" />
              {vi ? 'Tải tệp' : 'Download'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
              className="h-8 text-xs text-slate-600 dark:text-slate-400"
            >
              {vi ? 'Đóng' : 'Close'}
            </Button>
            {canSaveDirectly && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{vi ? 'Đang lưu...' : 'Saving...'}</span>
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    <span>{vi ? 'Lưu thay đổi (Ctrl+S)' : 'Save (Ctrl+S)'}</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </DummyModal>
  )
}
