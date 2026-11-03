import { createContext, useContext, useState, type ReactNode } from 'react'
import { API_URL, apiFetch } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'

export type UploadProgressStatus = 'uploading' | 'done' | 'error' | 'partial'
export type UploadProgressFile = { name: string; size: number; percent: number; status: UploadProgressStatus }
export type UploadProgressState = { open: boolean; fileName: string; percent: number; status: UploadProgressStatus; files: UploadProgressFile[] }

export type UploadBatchItem = { file: File; folderId: string | null }
type ResumableSession = { sessionId: string; file: File; folderId?: string | null; targetAccountId?: string | null }

type UploadContextType = {
  uploadProgress: UploadProgressState
  setUploadProgress: React.Dispatch<React.SetStateAction<UploadProgressState>>
  uploadFiles: (files: File[], folderId: string | null, targetAccountId?: string | null) => Promise<void>
  uploadBatch: (items: UploadBatchItem[], targetAccountId?: string | null) => Promise<void>
  retryFailedUpload: (fileName: string) => Promise<void>
}

const UploadContext = createContext<UploadContextType | undefined>(undefined)

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>({
    open: false,
    fileName: '',
    percent: 0,
    status: 'uploading',
    files: []
  })
  const [resumableSessions, setResumableSessions] = useState<Record<string, ResumableSession>>({})

  function uploadSingleFileS3(file: File, folderId: string | null, onProgress: (percent: number) => void, targetAccountId?: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_URL}/uploads`)
      const token = getAccessToken()
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.min(99, Math.round((e.loaded / e.total) * 100))
          onProgress(percent)
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100)
          resolve()
        } else {
          try {
            const err = JSON.parse(xhr.responseText)
            reject(new Error(err.message || 'S3 upload failed'))
          } catch {
            reject(new Error(`S3 upload failed with status ${xhr.status}`))
          }
        }
      }

      xhr.onerror = () => reject(new Error('Network error during S3 upload'))

      const formData = new FormData()
      formData.append('filesMeta', JSON.stringify([{
        fieldName: 'file-0',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        folderId: folderId || undefined,
        targetAccountId: targetAccountId || undefined,
      }]))
      formData.append('file-0', file)
      xhr.send(formData)
    })
  }

  async function uploadSingleFileResumable(file: File, folderId: string | null, onProgress: (percent: number) => void, sessionIdToRetry?: string, targetAccountId?: string | null) {
    const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB chunks (must be multiple of 256KB for Google Drive)
    let sessionId = sessionIdToRetry || ''
    let startOffset = 0

    // Pre-save session parameters so that retry is functional even if the init API call fails
    setResumableSessions(prev => ({
      ...prev,
      [file.name]: { sessionId, file, folderId, targetAccountId }
    }))

    // 1. Initialize or get status
    if (!sessionId) {
      let initData: { sessionId: string; provider: string; targetAccountId?: string }
      try {
        initData = await apiFetch<{ sessionId: string; provider: string; targetAccountId?: string }>('/uploads/resumable/init', {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: String(file.size),
            folderId: folderId || undefined,
            targetAccountId: targetAccountId || undefined
          })
        })
      } catch (err: any) {
        if (err.message && err.message.includes('Quota exceeded')) {
          throw new Error('Google OAuth Client bị giới hạn số lượt request/phút từ Google. Hãy thử lại sau 1-2 phút hoặc dùng OAuth cá nhân trong Settings!')
        }
        throw err
      }
      sessionId = initData.sessionId
      // Update session with the active sessionId
      setResumableSessions(prev => ({
        ...prev,
        [file.name]: { sessionId, file, folderId, targetAccountId }
      }))

      // S3 storage uses standard multipart upload via backend
      if (initData.provider === 's3') {
        await uploadSingleFileS3(file, folderId, onProgress, initData.targetAccountId || targetAccountId)
        return
      }
    } else {
      const statusData = await apiFetch<{ status: string; offset: string }>(`/uploads/resumable/status/${sessionId}`)
      startOffset = Number(statusData.offset)
      if (statusData.status === 'completed') {
        onProgress(100)
        return
      }
    }

    // 2. Upload chunk by chunk
    while (startOffset < file.size) {
      const endOffset = Math.min(startOffset + CHUNK_SIZE, file.size)
      const chunk = file.slice(startOffset, endOffset)

      // We use raw fetch with authorization header for binary stream upload
      const response = await fetch(`${API_URL}/uploads/resumable/chunk/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getAccessToken()}`,
          'Content-Range': `bytes ${startOffset}-${endOffset - 1}/${file.size}`,
          'Content-Length': String(chunk.size)
        },
        body: chunk
      })

      if (!response.ok) {
        throw new Error('Chunk upload failed')
      }

      const resData = await response.json() as { status: string; offset?: string }
      if (resData.status === 'completed') {
        onProgress(100)
        break
      }

      startOffset = Number(resData.offset)
      const percent = Math.min(99, Math.round((startOffset / file.size) * 100))
      onProgress(percent)
    }
  }

  async function uploadBatch(items: UploadBatchItem[], targetAccountId?: string | null) {
    if (items.length === 0) return

    setUploadProgress({
      open: true,
      fileName: items.length === 1 ? items[0].file.name : `${items.length} files`,
      percent: 0,
      status: 'uploading',
      files: items.map(item => ({ name: item.file.name, size: item.file.size, percent: 0, status: 'uploading' }))
    })

    for (let i = 0; i < items.length; i++) {
      const { file, folderId } = items[i]
      try {
        await uploadSingleFileResumable(file, folderId, (filePercent) => {
          setUploadProgress((current) => {
            const nextFiles = [...current.files]
            if (nextFiles[i]) {
              nextFiles[i] = { ...nextFiles[i], percent: filePercent, status: filePercent >= 100 ? 'done' : 'uploading' }
            }
            const overallPercent = Math.round(nextFiles.reduce((sum, f) => sum + f.percent, 0) / nextFiles.length)
            return {
              ...current,
              percent: overallPercent,
              files: nextFiles
            }
          })
        }, undefined, targetAccountId)
      } catch (err) {
        console.error('File upload failed:', file.name, err)
        setUploadProgress((current) => {
          const nextFiles = [...current.files]
          if (nextFiles[i]) {
            nextFiles[i] = { ...nextFiles[i], status: 'error' }
          }
          return {
            ...current,
            status: 'partial',
            files: nextFiles
          }
        })
      }
    }

    setUploadProgress((current) => {
      const allDone = current.files.every(f => f.status === 'done')
      return {
        ...current,
        status: allDone ? 'done' : 'partial'
      }
    })

    window.dispatchEvent(new Event('hcdrive:storage-changed'))
    window.dispatchEvent(new Event('9drive:storage-changed'))
    window.dispatchEvent(new Event('hcdrive:upload-completed'))
    window.dispatchEvent(new Event('9drive:upload-completed'))
  }

  async function uploadFiles(filesToUpload: File[], targetFolderId: string | null, targetAccountId?: string | null) {
    return uploadBatch(filesToUpload.map(f => ({ file: f, folderId: targetFolderId })), targetAccountId)
  }

  async function retryFailedUpload(fileName: string) {
    const session = resumableSessions[fileName]
    if (!session) return

    setUploadProgress((current) => {
      const nextFiles = current.files.map(f => f.name === fileName ? { ...f, status: 'uploading' as const } : f)
      return {
        ...current,
        status: 'uploading',
        files: nextFiles
      }
    })

    try {
      const fileIndex = uploadProgress.files.findIndex(f => f.name === fileName)
      await uploadSingleFileResumable(session.file, session.folderId || null, (filePercent) => {
        setUploadProgress((current) => {
          const nextFiles = [...current.files]
          if (nextFiles[fileIndex]) {
            nextFiles[fileIndex] = { ...nextFiles[fileIndex], percent: filePercent, status: filePercent >= 100 ? 'done' : 'uploading' }
          }
          const overallPercent = Math.round(nextFiles.reduce((sum, f) => sum + f.percent, 0) / nextFiles.length)
          const allDone = nextFiles.every(f => f.status === 'done')
          return {
            ...current,
            percent: overallPercent,
            status: allDone ? 'done' : 'uploading',
            files: nextFiles
          }
        })
      }, session.sessionId, session.targetAccountId)

      window.dispatchEvent(new Event('hcdrive:storage-changed'))
      window.dispatchEvent(new Event('9drive:storage-changed'))
      window.dispatchEvent(new Event('hcdrive:upload-completed'))
      window.dispatchEvent(new Event('9drive:upload-completed'))
    } catch (err) {
      console.error('Retry upload failed:', fileName, err)
      setUploadProgress((current) => {
        const nextFiles = current.files.map(f => f.name === fileName ? { ...f, status: 'error' as const } : f)
        return {
          ...current,
          status: 'partial',
          files: nextFiles
        }
      })
    }
  }

  return (
    <UploadContext.Provider value={{ uploadProgress, setUploadProgress, uploadFiles, uploadBatch, retryFailedUpload }}>
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload() {
  const context = useContext(UploadContext)
  if (context === undefined) {
    throw new Error('useUpload must be used within an UploadProvider')
  }
  return context
}
