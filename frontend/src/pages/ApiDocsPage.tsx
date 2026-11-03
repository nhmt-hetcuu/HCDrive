import { useState, useMemo, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { API_URL } from "@/lib/api"
import { cn } from "@/lib/utils"
import { BrandLogo } from "@/components/drive/BrandLogo"

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

type Endpoint = {
  id: string
  method: HttpMethod
  path: string
  titleVi: string
  titleEn: string
  descVi: string
  descEn: string
  category: "uploads" | "folders" | "files" | "storage" | "auth" | "shares" | "keys"
  authRequired: boolean
  authType?: "bearer" | "apiKey" | "public"
  params?: { name: string; type: string; required: boolean; descVi: string; descEn: string }[]
  bodyExample?: string
  responseExample?: string
  errorExample?: string
  curlSnippet?: string
  jsSnippet?: string
  pySnippet?: string
}

export function ApiDocsPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState("")
  const [activeSection, setActiveSection] = useState<string>("upload-api")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeSnippetTab, setActiveSnippetTab] = useState<Record<string, "curl" | "js" | "python">>({})
  const [activeResponseTab, setActiveResponseTab] = useState<Record<string, "200" | "400">>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    const saved = localStorage.getItem("hcdrive_theme")
    return saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)
  })

  const baseUrl = API_URL ? (API_URL.endsWith("/api") ? API_URL : API_URL + "/api") : (typeof window !== "undefined" ? window.location.origin + "/api" : "/api")
  const mainContentRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark")
      localStorage.setItem("hcdrive_theme", "dark")
    } else {
      document.documentElement.classList.remove("dark")
      localStorage.setItem("hcdrive_theme", "light")
    }
  }, [isDark])

  function copyText(text: string, id: string) {
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const categories = [
    {
      id: "uploads",
      labelVi: "Tải lên & API Key",
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9m-4-4 4-4 4 4" />
        </svg>
      ),
    },
    {
      id: "folders",
      labelVi: "Thư mục & Tải ZIP",
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
        </svg>
      ),
    },
    {
      id: "files",
      labelVi: "Tệp tin & Tải gộp",
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8m8 4H8m8 4H8" />
        </svg>
      ),
    },
    {
      id: "storage",
      labelVi: "Lưu trữ & Dung lượng",
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </svg>
      ),
    },
    {
      id: "auth",
      labelVi: "Xác thực tài khoản",
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ),
    },
    {
      id: "shares",
      labelVi: "Chia sẻ công khai",
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
          <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
        </svg>
      ),
    },
    {
      id: "keys",
      labelVi: "Quản lý API Key",
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
          <path d="m21 2-9.6 9.6" />
          <circle cx="7.5" cy="15.5" r="5.5" />
        </svg>
      ),
    },
  ]

  const endpoints: Endpoint[] = useMemo(() => [
    // 1. UPLOADS & EXTERNAL API
    {
      id: 'upload-api',
      method: 'POST',
      path: '/api/v1/uploads',
      titleVi: 'API tải lên bằng API Key (Developer)',
      titleEn: 'Upload files via API Key (Developer)',
      descVi: 'Tải tệp trực tiếp lên hệ thống bằng API Key. Hỗ trợ gửi tệp qua multipart/form-data kèm filesMeta mô tả từng tệp. Tự động định tuyến đến tài khoản lưu trữ phù hợp mà không lưu đĩa máy chủ (zero-disk streaming).',
      descEn: 'Upload files directly using an API key with files:upload scope. Streams files through the backend directly to storage accounts without local disk buffering.',
      category: 'uploads',
      authRequired: true,
      authType: 'apiKey',
      params: [
        { name: 'Authorization', type: 'Header', required: true, descVi: 'Mã API Key dạng: Bearer 9d_live_...', descEn: 'Bearer API Key format: Bearer 9d_live_...' },
        { name: 'filesMeta', type: 'JSON Array', required: true, descVi: 'Chuỗi JSON mô tả mảng các tệp: [{ fieldName, fileName, mimeType, sizeBytes, folderId? }]', descEn: 'JSON array of file metadata matching multipart field names' },
        { name: '[fieldName]', type: 'Binary File', required: true, descVi: 'Dữ liệu nhị phân của tệp có tên trường khớp với fieldName trong filesMeta', descEn: 'Binary file payload corresponding to fieldName in filesMeta' },
      ],
      bodyExample: `// multipart/form-data
filesMeta: '[{"fieldName":"file-0","fileName":"report.pdf","mimeType":"application/pdf","sizeBytes":"1048576"}]'
file-0: (binary payload)`,
      responseExample: `{
  "success": true,
  "uploaded": [
    {
      "id": "fil_98a7bcd",
      "name": "report.pdf",
      "sizeBytes": "1048576",
      "mimeType": "application/pdf",
      "folderId": null,
      "createdAt": "2026-11-01T12:00:00.000Z"
    }
  ]
}`,
      errorExample: `{
  "code": "STORAGE_QUOTA_EXCEEDED",
  "message": "No connected storage accounts have sufficient free space."
}`,
      curlSnippet: `curl -X POST "${baseUrl}/api/v1/uploads" \\
  -H "Authorization: Bearer 9d_live_your_api_key_here" \\
  -F 'filesMeta=[{"fieldName":"file-0","fileName":"document.pdf","mimeType":"application/pdf","sizeBytes":"1024"}]' \\
  -F "file-0=@document.pdf;type=application/pdf"`,
      jsSnippet: `const form = new FormData();
form.append('filesMeta', JSON.stringify([{
  fieldName: 'file-0',
  fileName: file.name,
  mimeType: file.type || 'application/octet-stream',
  sizeBytes: String(file.size)
}]));
form.append('file-0', file);

const response = await fetch('${baseUrl}/api/v1/uploads', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer 9d_live_your_api_key_here'
  },
  body: form
});
const data = await response.json();`,
      pySnippet: `import requests
import json

url = "${baseUrl}/api/v1/uploads"
headers = {"Authorization": "Bearer 9d_live_your_api_key_here"}

files_meta = [{
    "fieldName": "file-0",
    "fileName": "document.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": "1024"
}]

files = {
    "filesMeta": (None, json.dumps(files_meta), "application/json"),
    "file-0": ("document.pdf", open("document.pdf", "rb"), "application/pdf")
}

r = requests.post(url, headers=headers, files=files)
print(r.json())`,
    },

    // 2. FOLDERS & STREAMING ZIP
    {
      id: 'folders-download',
      method: 'GET',
      path: '/folders/:id/download',
      titleVi: 'Nén và tải thư mục thành ZIP (Streaming)',
      titleEn: 'Download folder as ZIP (Streaming)',
      descVi: 'Quét toàn bộ cấu trúc thư mục con và tệp tin bên trong virtual folder trên cơ sở dữ liệu và nén thành tệp ZIP truyền phát trực tiếp đến trình duyệt.',
      descEn: 'Recursively packages folder contents into a streaming ZIP archive using archiver with zero local disk buffering.',
      category: 'folders',
      authRequired: true,
      authType: 'bearer',
      params: [
        { name: 'id', type: 'Path (String)', required: true, descVi: 'ID của thư mục cần tải xuống', descEn: 'Target folder ID' }
      ],
      responseExample: `Content-Type: application/zip
Content-Disposition: attachment; filename="Folder.zip"
Transfer-Encoding: chunked

[Binary ZIP Stream containing folder hierarchy]`,
      errorExample: `{
  "code": "FOLDER_NOT_FOUND",
  "message": "Virtual folder does not exist or has been deleted."
}`,
      curlSnippet: `curl -X GET "${baseUrl}/folders/fld_123/download" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  --output "my_folder.zip"`,
      jsSnippet: `const res = await fetch('${baseUrl}/folders/fld_123/download', {
  headers: { 'Authorization': 'Bearer ' + accessToken }
});
const blob = await res.blob();
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'My_Folder.zip';
a.click();`,
    },
    {
      id: 'folders-list',
      method: 'GET',
      path: '/folders',
      titleVi: 'Lấy danh sách thư mục (Gộp nhiều tài khoản)',
      titleEn: 'List folders (Merged across accounts)',
      descVi: 'Lấy các thư mục con trong thư mục cha (hoặc thư mục gốc nếu parentId rỗng). Tự động gộp các thư mục cùng tên từ nhiều tài khoản Google Drive.',
      descEn: 'Get subfolders under parentId or root. Merges folders with identical names across connected accounts.',
      category: 'folders',
      authRequired: true,
      authType: 'bearer',
      params: [
        { name: 'parentId', type: 'Query (String)', required: false, descVi: 'ID thư mục cha (để trống = thư mục gốc)', descEn: 'Parent folder ID (empty = root)' },
        { name: 'all', type: 'Query (Number)', required: false, descVi: 'Truyền all=1 để lấy toàn bộ cây thư mục', descEn: 'Pass all=1 to fetch entire tree' }
      ],
      responseExample: `[
  {
    "id": "fld_01",
    "name": "Tài liệu 2026",
    "parentId": null,
    "hasChildren": true
  }
]`,
      errorExample: `{
  "code": "AUTH_REQUIRED",
  "message": "Bearer token required."
}`,
      curlSnippet: `curl -X GET "${baseUrl}/folders?parentId=root" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`,
      jsSnippet: `const res = await fetch('${baseUrl}/folders?parentId=root', {
  headers: { 'Authorization': 'Bearer ' + accessToken }
});
const folders = await res.json();`,
    },
    {
      id: 'folders-refresh',
      method: 'POST',
      path: '/folders/refresh',
      titleVi: 'Làm mới trực tiếp từ Google Drive (Live Refresh)',
      titleEn: 'Live refresh from Google Drive',
      descVi: 'Gọi trực tiếp Google Drive v3 API để đồng bộ các thay đổi mới nhất (thêm, sửa, xoá file trên Drive) vào cơ sở dữ liệu HCDrive tức thì.',
      descEn: 'Directly polls Google Drive v3 API to synchronize remote changes into HCDrive database.',
      category: 'folders',
      authRequired: true,
      authType: 'bearer',
      responseExample: `{
  "success": true,
  "syncedFiles": 14,
  "syncedFolders": 3
}`,
      errorExample: `{
  "code": "SYNC_FAILED",
  "message": "Failed to communicate with Google Drive API."
}`,
      curlSnippet: `curl -X POST "${baseUrl}/folders/refresh" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`,
      jsSnippet: `const res = await fetch('${baseUrl}/folders/refresh', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + accessToken }
});
const result = await res.json();`,
    },

    // 3. FILES & BATCH ACTIONS
    {
      id: 'files-batch-download',
      method: 'POST',
      path: '/files/batch-download',
      titleVi: 'Tải gộp nhiều tệp thành ZIP (Multi-Selection)',
      titleEn: 'Batch download selected files as ZIP',
      descVi: 'Truyền mảng fileIds đã tick chọn trên giao diện HCDrive để đóng gói trực tiếp thành một file ZIP duy nhất.',
      descEn: 'Takes array of file IDs selected in multi-file view and streams a single packaged ZIP archive.',
      category: 'files',
      authRequired: true,
      authType: 'bearer',
      params: [
        { name: 'fileIds', type: 'JSON Array', required: true, descVi: 'Mảng chuỗi ID các file cần tải gộp', descEn: 'Array of file IDs to package' }
      ],
      bodyExample: `{
  "fileIds": [
    "fil_abc123",
    "fil_xyz789"
  ]
}`,
      responseExample: `Content-Type: application/zip
Content-Disposition: attachment; filename="HCDrive_Selected.zip"
Transfer-Encoding: chunked

[Binary ZIP Stream]`,
      errorExample: `{
  "code": "FILES_NOT_FOUND",
  "message": "No valid files found for the given IDs."
}`,
      curlSnippet: `curl -X POST "${baseUrl}/files/batch-download" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"fileIds": ["fil_abc123", "fil_xyz789"]}' \\
  --output "HCDrive_Selected.zip"`,
      jsSnippet: `const res = await fetch('${baseUrl}/files/batch-download', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ fileIds: selectedFileIds })
});
const blob = await res.blob();
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'HCDrive_Selected.zip';
a.click();`,
    },
    {
      id: 'files-download',
      method: 'GET',
      path: '/files/:id/download',
      titleVi: 'Tải tệp tin đơn lẻ (Direct Stream)',
      titleEn: 'Stream or download single file',
      descVi: 'Truyền phát trực tiếp tệp tin từ tài khoản lưu trữ Google Drive hoặc S3 tới người dùng mà không lưu cache trên đĩa cứng máy chủ.',
      descEn: 'Directly streams the file from Google Drive or S3 to client with proper Content-Type and Range support.',
      category: 'files',
      authRequired: true,
      authType: 'bearer',
      params: [
        { name: 'id', type: 'Path (String)', required: true, descVi: 'ID của tệp tin cần tải', descEn: 'Target file ID' }
      ],
      responseExample: `Content-Type: application/octet-stream
Content-Disposition: attachment; filename="document.pdf"

[Binary File Payload]`,
      errorExample: `{
  "code": "FILE_NOT_FOUND",
  "message": "File does not exist or has been moved to trash."
}`,
      curlSnippet: `curl -X GET "${baseUrl}/files/fil_123/download" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  --output "downloaded_file.pdf"`,
      jsSnippet: `window.open('${baseUrl}/files/fil_123/download?token=' + accessToken);`,
    },

    // 4. STORAGE & QUOTAS
    {
      id: 'storage-summary',
      method: 'GET',
      path: '/storage/summary',
      titleVi: 'Tổng hợp dung lượng lưu trữ (Quota Tracker)',
      titleEn: 'Combined storage quota summary',
      descVi: 'Lấy tổng dung lượng đã dùng, tổng dung lượng khả dụng và danh sách các tài khoản Google Drive & S3 đang kết nối.',
      descEn: 'Returns real-time aggregated quota stats across all connected accounts.',
      category: 'storage',
      authRequired: true,
      authType: 'bearer',
      responseExample: `{
  "totalCapacityBytes": 107374182400,
  "totalUsedBytes": 34892182000,
  "totalAvailableBytes": 72482000400,
  "accountCount": 4,
  "routingPolicy": "most_available"
}`,
      errorExample: `{
  "code": "UNAUTHORIZED",
  "message": "Invalid or expired session token."
}`,
      curlSnippet: `curl -X GET "${baseUrl}/storage/summary" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`,
      jsSnippet: `const res = await fetch('${baseUrl}/storage/summary', {
  headers: { 'Authorization': 'Bearer ' + accessToken }
});
const summary = await res.json();`,
    },
    {
      id: 'storage-policy',
      method: 'PATCH',
      path: '/storage/routing-policy',
      titleVi: 'Cập nhật chính sách định tuyến tải lên',
      titleEn: 'Update upload routing policy',
      descVi: 'Chọn phương thức chọn tài khoản khi tải tệp: most_available (nhiều dung lượng trống nhất), round_robin (xoay vòng đều) hoặc priority (theo thứ tự ưu tiên).',
      descEn: 'Updates account selection policy: most_available, round_robin, or priority.',
      category: 'storage',
      authRequired: true,
      authType: 'bearer',
      params: [
        { name: 'mode', type: 'String', required: true, descVi: '"most_available" | "round_robin" | "priority"', descEn: 'Routing strategy' },
        { name: 'priorityAccountIds', type: 'String[]', required: false, descVi: 'Mảng ID tài khoản ưu tiên khi dùng chế độ priority', descEn: 'Priority account IDs array' }
      ],
      bodyExample: `{
  "mode": "most_available",
  "priorityAccountIds": []
}`,
      responseExample: `{
  "success": true,
  "policy": {
    "mode": "most_available",
    "updatedAt": "2026-11-01T12:00:00.000Z"
  }
}`,
      errorExample: `{
  "code": "INVALID_POLICY_MODE",
  "message": "Allowed modes: most_available, round_robin, priority"
}`,
      curlSnippet: `curl -X PATCH "${baseUrl}/storage/routing-policy" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"mode": "most_available"}'`,
      jsSnippet: `const res = await fetch('${baseUrl}/storage/routing-policy', {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ mode: 'most_available' })
});`,
    },

    // 5. AUTHENTICATION
    {
      id: 'auth-login',
      method: 'POST',
      path: '/auth/login',
      titleVi: 'Đăng nhập hệ thống',
      titleEn: 'User login',
      descVi: 'Đăng nhập bằng email và mật khẩu, trả về Access Token và thông tin tài khoản.',
      descEn: 'Authenticates with email and password, returning JWT Access Token.',
      category: 'auth',
      authRequired: false,
      authType: 'public',
      params: [
        { name: 'email', type: 'String', required: true, descVi: 'Email tài khoản', descEn: 'Account email' },
        { name: 'password', type: 'String', required: true, descVi: 'Mật khẩu bảo mật', descEn: 'Secure password' }
      ],
      bodyExample: `{
  "email": "user@example.com",
  "password": "your_secure_password"
}`,
      responseExample: `{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_123",
    "email": "user@example.com",
    "name": "Nguyen Hoang",
    "isAdmin": true
  }
}`,
      errorExample: `{
  "code": "INVALID_CREDENTIALS",
  "message": "Incorrect email or password."
}`,
      curlSnippet: `curl -X POST "${baseUrl}/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "password": "password123"}'`,
      jsSnippet: `const res = await fetch('${baseUrl}/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', password: 'password123' })
});
const { accessToken, user } = await res.json();`,
    },
    {
      id: 'auth-me',
      method: 'GET',
      path: '/auth/me',
      titleVi: 'Lấy thông tin người dùng hiện tại',
      titleEn: 'Get current user profile',
      descVi: 'Trả về thông tin hồ sơ của tài khoản đang đăng nhập từ access token.',
      descEn: 'Returns current authenticated user details from access token.',
      category: 'auth',
      authRequired: true,
      authType: 'bearer',
      responseExample: `{
  "id": "usr_123",
  "email": "user@example.com",
  "name": "Nguyen Hoang",
  "isAdmin": true,
  "createdAt": "2026-01-15T08:30:00Z"
}`,
      errorExample: `{
  "code": "AUTH_REQUIRED",
  "message": "Valid Bearer access token must be provided."
}`,
      curlSnippet: `curl -X GET "${baseUrl}/auth/me" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`,
      jsSnippet: `const res = await fetch('${baseUrl}/auth/me', {
  headers: { 'Authorization': 'Bearer ' + accessToken }
});
const profile = await res.json();`,
    },

    // 6. SHARES
    {
      id: 'files-share',
      method: 'POST',
      path: '/files/:id/share',
      titleVi: 'Tạo liên kết chia sẻ công khai',
      titleEn: 'Create public share link',
      descVi: 'Tạo mã chia sẻ tệp công khai. Có thể đặt mật khẩu hoặc ngày hết hạn.',
      descEn: 'Generates public share link with optional password and expiry date.',
      category: 'shares',
      authRequired: true,
      authType: 'bearer',
      params: [
        { name: 'id', type: 'Path (String)', required: true, descVi: 'ID file cần chia sẻ', descEn: 'File ID' },
        { name: 'isPublic', type: 'Boolean', required: true, descVi: 'Bật liên kết công khai', descEn: 'Enable public link' },
        { name: 'password', type: 'String', required: false, descVi: 'Mật khẩu bảo vệ (tuỳ chọn)', descEn: 'Optional password' }
      ],
      bodyExample: `{
  "isPublic": true,
  "password": "optional_password"
}`,
      responseExample: `{
  "shareToken": "shr_87a9b0c1",
  "shareUrl": "${baseUrl}/public/files/shr_87a9b0c1",
  "hasPassword": true
}`,
      errorExample: `{
  "code": "FILE_NOT_FOUND",
  "message": "File does not exist."
}`,
      curlSnippet: `curl -X POST "${baseUrl}/files/file_123/share" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"isPublic": true}'`,
      jsSnippet: `const res = await fetch('${baseUrl}/files/file_123/share', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ isPublic: true })
});`,
    },

    // 7. API KEYS
    {
      id: 'api-keys-list',
      method: 'GET',
      path: '/api-keys',
      titleVi: 'Lấy danh sách API Keys',
      titleEn: 'List user API keys',
      descVi: 'Xem danh sách các khóa API do người dùng đã tạo.',
      descEn: 'Retrieves all API keys created by user.',
      category: 'keys',
      authRequired: true,
      authType: 'bearer',
      responseExample: `[
  {
    "id": "key_123",
    "name": "CI Server Deploy",
    "keyPrefix": "9d_live_abc",
    "scopes": ["files:upload"],
    "createdAt": "2026-11-01T12:00:00.000Z"
  }
]`,
      errorExample: `{
  "code": "AUTH_REQUIRED",
  "message": "Bearer token required."
}`,
      curlSnippet: `curl -X GET "${baseUrl}/api-keys" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`,
      jsSnippet: `const res = await fetch('${baseUrl}/api-keys', {
  headers: { 'Authorization': 'Bearer ' + accessToken }
});
const keys = await res.json();`,
    },
    {
      id: 'api-keys-create',
      method: 'POST',
      path: '/api-keys',
      titleVi: 'Tạo API Key mới',
      titleEn: 'Create new API key',
      descVi: 'Tạo một khóa API mới mang quyền files:upload. Khóa bí mật chỉ hiển thị 1 lần duy nhất.',
      descEn: 'Generates a new API key with specified scopes. Secret is returned once.',
      category: 'keys',
      authRequired: true,
      authType: 'bearer',
      params: [
        { name: 'name', type: 'String', required: true, descVi: 'Tên định danh khóa', descEn: 'Name of the key' },
        { name: 'scopes', type: 'String[]', required: true, descVi: 'Mảng quyền hạn (vd: ["files:upload"])', descEn: 'Scopes array' }
      ],
      bodyExample: `{
  "name": "CI Server Deploy",
  "scopes": ["files:upload"]
}`,
      responseExample: `{
  "apiKey": {
    "id": "key_123",
    "name": "CI Server Deploy",
    "keyPrefix": "9d_live_abc"
  },
  "secret": "9d_live_abc1234567890abcdef"
}`,
      errorExample: `{
  "code": "INVALID_SCOPE",
  "message": "Scope not supported."
}`,
      curlSnippet: `curl -X POST "${baseUrl}/api-keys" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Backup Script", "scopes": ["files:upload"]}'`,
      jsSnippet: `const res = await fetch('${baseUrl}/api-keys', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'Backup Script', scopes: ['files:upload'] })
});
const { secret } = await res.json();`,
    },
  ], [baseUrl])

  // ScrollSpy with IntersectionObserver
  useEffect(() => {
    const rootElement = mainContentRef.current
    if (!rootElement) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        })
      },
      { root: rootElement, rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    )

    const sections = rootElement.querySelectorAll(".api-section")
    sections.forEach((sec) => observer.observe(sec))

    return () => observer.disconnect()
  }, [endpoints])

  const filteredEndpoints = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return endpoints
    return endpoints.filter((ep) => {
      return (
        ep.path.toLowerCase().includes(query) ||
        ep.titleVi.toLowerCase().includes(query) ||
        ep.titleEn.toLowerCase().includes(query) ||
        ep.method.toLowerCase().includes(query) ||
        ep.category.toLowerCase().includes(query)
      )
    })
  }, [endpoints, searchQuery])

  return (
    <div className="api-docs-page">
      <style>{`:root, .api-docs-page {
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --bg-page: #f8fafc;
      --bg-surface: #ffffff;
      --border-color: #e2e8f0;
      --border-subtle: #f1f5f9;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --text-light: #94a3b8;
      --sidebar-bg: #ffffff;
      --sidebar-width: 290px;
      --header-height: 56px;

      --code-bg: #0f172a;
      --code-header-bg: #1e293b;
      --code-border: #334155;
      --code-text: #e2e8f0;
      --code-req: #34d399;
      --code-res-200: #38bdf8;
      --code-res-400: #f87171;

      --color-get-bg: #ecfdf5;
      --color-get-text: #047857;
      --color-get-border: #a7f3d0;

      --color-post-bg: #eff6ff;
      --color-post-text: #1d4ed8;
      --color-post-border: #bfdbfe;

      --color-put-bg: #fffbeb;
      --color-put-text: #b45309;
      --color-put-border: #fde68a;

      --color-patch-bg: #faf5ff;
      --color-patch-text: #7e22ce;
      --color-patch-border: #e9d5ff;

      --color-delete-bg: #fef2f2;
      --color-delete-text: #b91c1c;
      --color-delete-border: #fecaca;
    }

    html.dark, html.dark .api-docs-page {
      --bg-page: #131314;
      --bg-surface: #1e1f20;
      --border-color: #2e3032;
      --border-subtle: #1e2022;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-light: #64748b;
      --sidebar-bg: #1e1f20;

      --color-get-bg: rgba(6, 78, 59, 0.4);
      --color-get-text: #34d399;
      --color-get-border: #065f46;

      --color-post-bg: rgba(30, 58, 138, 0.4);
      --color-post-text: #60a5fa;
      --color-post-border: #1e40af;

      --color-put-bg: rgba(120, 53, 15, 0.4);
      --color-put-text: #fbbf24;
      --color-put-border: #92400e;

      --color-patch-bg: rgba(88, 28, 135, 0.4);
      --color-patch-text: #c084fc;
      --color-patch-border: #6b21a8;

      --color-delete-bg: rgba(127, 29, 29, 0.4);
      --color-delete-text: #f87171;
      --color-delete-border: #991b1b;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-family);
      background-color: var(--bg-page);
      color: var(--text-main);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Top Navigation Header */
    header.top-nav {
      position: sticky;
      top: 0;
      height: var(--header-height);
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 50;
      flex-shrink: 0;
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--text-main);
    }

    .brand-title {
      font-size: 0.95rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .brand-badge {
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #0369a1;
      font-weight: 600;
      border: 1px solid #bae6fd;
    }
    html.dark .brand-badge {
      background: rgba(3, 105, 161, 0.2);
      color: #7dd3fc;
      border-color: #0284c7;
    }

    .mobile-menu-btn {
      display: none;
      background: none;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 5px 8px;
      cursor: pointer;
      color: var(--text-main);
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
    }

    .base-url-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--bg-page);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    .base-url-pill code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--text-main);
      font-weight: 600;
    }

    .copy-base-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px;
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }
    .copy-base-btn:hover {
      color: var(--text-main);
    }

    .nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 999px;
      background: var(--bg-page);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.75rem;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .nav-btn:hover {
      background: var(--border-color);
    }

    .nav-btn.btn-primary {
      background: #0b57d0;
      color: #ffffff;
      border-color: #0b57d0;
    }
    .nav-btn.btn-primary:hover {
      background: #0842a0;
    }

    .theme-toggle-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: 999px;
      padding: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-main);
      cursor: pointer;
      transition: background 0.15s;
    }
    .theme-toggle-btn:hover {
      background: var(--border-subtle);
    }

    /* 3-Column Layout */
    .app-layout {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    /* 1. LEFT SIDEBAR */
    aside.sidebar {
      width: var(--sidebar-width);
      height: 100%;
      overflow-y: auto;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      z-index: 30;
      transition: transform 0.2s ease;
    }

    .search-box {
      padding: 12px;
      border-bottom: 1px solid var(--border-color);
      position: relative;
    }

    .search-input {
      width: 100%;
      height: 32px;
      padding: 6px 10px 6px 30px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      font-size: 0.75rem;
      outline: none;
      background: var(--bg-page);
      color: var(--text-main);
      transition: border-color 0.15s ease;
    }
    .search-input:focus {
      border-color: #0b57d0;
      background: var(--bg-surface);
    }

    .search-icon {
      position: absolute;
      left: 20px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-light);
      pointer-events: none;
      display: flex;
      align-items: center;
    }

    .nav-tree {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .nav-group-title {
      font-size: 0.68rem;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: var(--text-light);
      padding: 4px 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 6px;
      text-decoration: none;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 500;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .nav-link:hover {
      background: var(--bg-page);
      color: var(--text-main);
    }
    .nav-link.active {
      background: #eff6ff;
      color: #0b57d0;
      font-weight: 600;
    }
    html.dark .nav-link.active {
      background: rgba(30, 58, 138, 0.35);
      color: #93c5fd;
    }

    .nav-link-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Badges for HTTP Methods */
    .badge {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border: 1px solid transparent;
      flex-shrink: 0;
    }
    .badge-get { background: var(--color-get-bg); color: var(--color-get-text); border-color: var(--color-get-border); }
    .badge-post { background: var(--color-post-bg); color: var(--color-post-text); border-color: var(--color-post-border); }
    .badge-put { background: var(--color-put-bg); color: var(--color-put-text); border-color: var(--color-put-border); }
    .badge-patch { background: var(--color-patch-bg); color: var(--color-patch-text); border-color: var(--color-patch-border); }
    .badge-delete { background: var(--color-delete-bg); color: var(--color-delete-text); border-color: var(--color-delete-border); }

    /* Main Content Area */
    main.content-area {
      flex: 1;
      height: 100%;
      overflow-y: auto;
      scroll-behavior: smooth;
    }

    .api-section {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      min-height: 480px;
    }

    /* 2. CENTER COLUMN: Documentation */
    .doc-column {
      flex: 1;
      padding: 36px 40px;
      background: var(--bg-surface);
      max-width: 760px;
    }

    .endpoint-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .endpoint-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-main);
    }

    .auth-pill {
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      font-weight: 500;
    }
    .auth-required {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    html.dark .auth-required {
      background: rgba(146, 64, 14, 0.25);
      color: #fcd34d;
      border-color: #b45309;
    }
    .auth-public {
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
    }
    html.dark .auth-public {
      background: rgba(6, 95, 70, 0.25);
      color: #6ee7b7;
      border-color: #047857;
    }

    .endpoint-title {
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 2px;
      letter-spacing: -0.01em;
    }

    .endpoint-subtitle {
      font-size: 0.85rem;
      color: var(--text-light);
      margin-bottom: 12px;
      font-weight: 500;
    }

    .endpoint-desc {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 4px;
      line-height: 1.6;
    }
    .endpoint-desc-en {
      font-size: 0.8rem;
      color: var(--text-light);
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .params-section {
      margin-top: 24px;
    }

    .section-title {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-light);
      margin-bottom: 10px;
    }

    /* Parameters Table */
    .param-table-wrapper {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .param-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
      text-align: left;
    }

    .param-table th {
      background: var(--bg-page);
      padding: 8px 12px;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      font-size: 0.7rem;
    }

    .param-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: top;
    }

    .param-table tr:last-child td {
      border-bottom: none;
    }

    .param-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      color: #0b57d0;
    }
    html.dark .param-name {
      color: #93c5fd;
    }

    .param-type {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--text-muted);
      font-size: 0.7rem;
    }

    .param-req {
      color: #ef4444;
      font-weight: 600;
      font-size: 0.7rem;
    }

    .param-opt {
      color: var(--text-light);
      font-size: 0.7rem;
    }

    .param-desc {
      color: var(--text-muted);
      line-height: 1.4;
    }
    .param-desc-en {
      font-size: 0.7rem;
      color: var(--text-light);
      margin-top: 2px;
    }

    /* 3. RIGHT COLUMN: Dark-themed Code Sandbox */
    .code-column {
      width: 490px;
      background: var(--code-bg);
      border-left: 1px solid var(--code-border);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex-shrink: 0;
    }

    .code-card {
      background: var(--code-header-bg);
      border: 1px solid var(--code-border);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }

    .code-card-header {
      background: var(--code-bg);
      border-bottom: 1px solid var(--code-border);
      padding: 6px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .code-tabs, .response-tabs {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .code-tab-btn {
      background: none;
      border: 1px solid transparent;
      color: var(--code-text);
      font-size: 0.7rem;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.7;
      transition: all 0.15s ease;
    }
    .code-tab-btn:hover {
      opacity: 1;
      color: #ffffff;
    }
    .code-tab-btn.active {
      opacity: 1;
      background: var(--code-header-bg);
      color: #ffffff;
    }

    .copy-btn {
      background: none;
      border: 1px solid var(--code-border);
      color: #94a3b8;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 0.7rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }
    .copy-btn:hover {
      color: #ffffff;
      border-color: #64748b;
    }

    .code-card-body {
      padding: 14px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.72rem;
      line-height: 1.6;
      white-space: pre;
    }
    .code-req { color: var(--code-req); }
    .code-res-200 { color: var(--code-res-200); }
    .code-res-400 { color: var(--code-res-400); }

    .status-badge {
      font-size: 0.7rem;
      font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .status-200 {
      color: #4ade80;
      background: rgba(74, 222, 128, 0.15);
      border: 1px solid rgba(74, 222, 128, 0.3);
    }
    .status-400 {
      color: #f87171;
      background: rgba(248, 113, 113, 0.15);
      border: 1px solid rgba(248, 113, 113, 0.3);
    }

    /* Mobile backdrop */
    .mobile-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 25;
    }

    /* Responsive */
    @media (max-width: 1200px) {
      .api-section {
        flex-direction: column;
      }
      .doc-column {
        max-width: 100%;
        padding: 28px 20px;
      }
      .code-column {
        width: 100%;
        border-left: none;
        border-top: 1px solid var(--code-border);
        padding: 20px;
      }
    }

    @media (max-width: 768px) {
      .mobile-menu-btn {
        display: block;
      }
      aside.sidebar {
        position: fixed;
        left: -100%;
        top: var(--header-height);
        height: calc(100vh - var(--header-height));
        width: 280px;
        box-shadow: 10px 0 25px rgba(0, 0, 0, 0.15);
      }
      aside.sidebar.open {
        left: 0;
      }
      .mobile-backdrop.open {
        display: block;
      }
      .base-url-pill {
        display: none;
      }
    }`}</style>

      {/* Top Navigation Header */}
      <header className="top-nav">
        <div className="nav-left">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <a href="/" className="brand">
            <BrandLogo className="h-7 w-7" />
            <span className="brand-title">HCDrive Developer Reference</span>
            <span className="brand-badge">REST v1.0</span>
          </a>
        </div>

        <div className="nav-actions">
          {/* Base URL pill with copy button */}
          <div className="base-url-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#f59e0b" }}>
              <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
            </svg>
            <span>Base: <code>{baseUrl}</code></span>
            <button
              type="button"
              className="copy-base-btn"
              onClick={() => copyText(baseUrl, "top-base")}
              title="Sao chép Base URL"
            >
              {copiedId === "top-base" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => navigate("/settings?tab=api")}
            className="nav-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
              <path d="m21 2-9.6 9.6" />
              <circle cx="7.5" cy="15.5" r="5.5" />
            </svg>
            <span>Khoá API</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/all-files")}
            className="nav-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#0b57d0" }}>
              <rect width="20" height="8" x="2" y="2" rx="2" />
              <rect width="20" height="8" x="2" y="14" rx="2" />
              <line x1="6" x2="6.01" y1="6" y2="6" />
              <line x1="6" x2="6.01" y1="18" y2="18" />
            </svg>
            <span>Mở Drive</span>
          </button>

          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => setIsDark(!isDark)}
            title="Chuyển chế độ sáng/tối"
          >
            {isDark ? (
              <svg className="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg className="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-backdrop open" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* 3-Column Layout */}
      <div className="app-layout">
        {/* 1. LEFT SIDEBAR */}
        <aside className={cn("sidebar", mobileMenuOpen && "open")}>
          <div className="search-box">
            <span className="search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              type="text"
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm endpoint..."
            />
          </div>

          <nav className="nav-tree">
            {categories.map((cat) => {
              const catEps = filteredEndpoints.filter((ep) => ep.category === cat.id)
              if (catEps.length === 0) return null
              return (
                <div key={cat.id} className="nav-group">
                  <div className="nav-group-title">
                    {cat.icon}
                    <span>{cat.labelVi}</span>
                  </div>
                  {catEps.map((ep) => (
                    <a
                      key={ep.id}
                      href={`#${ep.id}`}
                      onClick={() => {
                        setActiveSection(ep.id)
                        if (mobileMenuOpen) setMobileMenuOpen(false)
                      }}
                      className={cn("nav-link", activeSection === ep.id && "active")}
                    >
                      <span className={cn("badge", `badge-${ep.method.toLowerCase()}`)}>{ep.method}</span>
                      <span className="nav-link-title">{ep.titleVi}</span>
                    </a>
                  ))}
                </div>
              )
            })}
          </nav>
        </aside>

        {/* 2 & 3. MAIN CONTENT: CENTER (DOCS) & RIGHT (CODE SANDBOX) */}
        <main className="content-area" ref={mainContentRef}>
          {filteredEndpoints.length === 0 ? (
            <div style={{ padding: "64px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              Không tìm thấy endpoint nào phù hợp với từ khóa.
            </div>
          ) : (
            filteredEndpoints.map((ep) => {
              const snippetTab = activeSnippetTab[ep.id] || "curl"
              const responseTab = activeResponseTab[ep.id] || "200"

              return (
                <section key={ep.id} className="api-section" id={ep.id}>
                  {/* CENTER COLUMN: Documentation & Parameters */}
                  <div className="doc-column">
                    <div className="endpoint-header">
                      <span className={cn("badge", `badge-${ep.method.toLowerCase()}`)}>{ep.method}</span>
                      <span className="endpoint-path">{ep.path}</span>
                      {ep.authRequired ? (
                        <span className="auth-pill auth-required">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          {ep.authType === "apiKey" ? "API Key" : "Bearer Auth"}
                        </span>
                      ) : (
                        <span className="auth-pill auth-public">Public</span>
                      )}
                    </div>

                    <h2 className="endpoint-title">{ep.titleVi}</h2>
                    <div className="endpoint-subtitle">{ep.titleEn}</div>
                    <p className="endpoint-desc">{ep.descVi}</p>
                    <p className="endpoint-desc-en">{ep.descEn}</p>

                    {ep.params && ep.params.length > 0 && (
                      <div className="params-section">
                        <div className="section-title">
                          <span>Tham số yêu cầu (Request Parameters)</span>
                        </div>
                        <div className="param-table-wrapper">
                          <table className="param-table">
                            <thead>
                              <tr>
                                <th>Tham số (Field)</th>
                                <th>Kiểu (Type)</th>
                                <th>Bắt buộc (Required)</th>
                                <th>Mô tả (Description)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ep.params.map((p) => (
                                <tr key={p.name}>
                                  <td><span className="param-name">{p.name}</span></td>
                                  <td><span className="param-type">{p.type}</span></td>
                                  <td>{p.required ? <span className="param-req">Bắt buộc</span> : <span className="param-opt">Tuỳ chọn</span>}</td>
                                  <td>
                                    <div className="param-desc">
                                      {p.descVi}
                                      <div className="param-desc-en">{p.descEn}</div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* RIGHT COLUMN: Dark-themed Code Sandbox & Response */}
                  <div className="code-column">
                    {/* Request Code Card */}
                    <div className="code-card">
                      <div className="code-card-header">
                        <div className="code-tabs">
                          <button
                            type="button"
                            onClick={() => setActiveSnippetTab((prev) => ({ ...prev, [ep.id]: "curl" }))}
                            className={cn("code-tab-btn", snippetTab === "curl" && "active")}
                          >
                            cURL
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveSnippetTab((prev) => ({ ...prev, [ep.id]: "js" }))}
                            className={cn("code-tab-btn", snippetTab === "js" && "active")}
                          >
                            JavaScript
                          </button>
                          {ep.pySnippet && (
                            <button
                              type="button"
                              onClick={() => setActiveSnippetTab((prev) => ({ ...prev, [ep.id]: "python" }))}
                              className={cn("code-tab-btn", snippetTab === "python" && "active")}
                            >
                              Python
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          className="copy-btn"
                          onClick={() => {
                            const code = snippetTab === "js" ? ep.jsSnippet : snippetTab === "python" ? ep.pySnippet : ep.curlSnippet
                            copyText(code || "", `${ep.id}-req`)
                          }}
                        >
                          {copiedId === `${ep.id}-req` ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                              <span style={{ color: "#4ade80" }}>Đã chép!</span>
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                              </svg>
                              <span>Sao chép</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="code-card-body code-req">
                        {snippetTab === "js" ? ep.jsSnippet : snippetTab === "python" ? ep.pySnippet : ep.curlSnippet}
                      </pre>
                    </div>

                    {/* Response Example Card */}
                    <div className="code-card">
                      <div className="code-card-header">
                        <div className="response-tabs">
                          <button
                            type="button"
                            onClick={() => setActiveResponseTab((prev) => ({ ...prev, [ep.id]: "200" }))}
                            className={cn("code-tab-btn", responseTab === "200" && "active")}
                          >
                            <span className="status-badge status-200">200 OK</span>
                          </button>
                          {ep.errorExample && (
                            <button
                              type="button"
                              onClick={() => setActiveResponseTab((prev) => ({ ...prev, [ep.id]: "400" }))}
                              className={cn("code-tab-btn", responseTab === "400" && "active")}
                            >
                              <span className="status-badge status-400">400 Error</span>
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          className="copy-btn"
                          onClick={() => {
                            const resCode = responseTab === "200" ? ep.responseExample : ep.errorExample
                            copyText(resCode || "", `${ep.id}-res`)
                          }}
                        >
                          {copiedId === `${ep.id}-res` ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                              <span style={{ color: "#4ade80" }}>Đã chép!</span>
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                              </svg>
                              <span>Sao chép</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className={cn("code-card-body", responseTab === "200" ? "code-res-200" : "code-res-400")}>
                        {responseTab === "200" ? ep.responseExample : ep.errorExample}
                      </pre>
                    </div>
                  </div>
                </section>
              )
            })
          )}
        </main>
      </div>
    </div>
  )
}
