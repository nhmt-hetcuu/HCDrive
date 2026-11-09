import { useState, useMemo, useEffect, useRef, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { API_URL } from "@/lib/api"
import { cn } from "@/lib/utils"
import { BrandLogo } from "@/components/drive/BrandLogo"
import { apiCategories, buildEndpoints, type ApiCategory, type Endpoint } from "@/data/api-reference"

const svg = (children: ReactNode) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

const categoryIcons: Record<ApiCategory, ReactNode> = {
  auth: svg(<><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  uploads: svg(<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9m-4-4 4-4 4 4" />),
  files: svg(<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></>),
  folders: svg(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />),
  drive: svg(<><path d="M12 2 2 19h20Z" /><path d="M7.5 10.5h9" /></>),
  sharing: svg(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" /></>),
  storage: svg(<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></>),
  library: svg(<><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></>),
  keys: svg(<><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" /><path d="m21 2-9.6 9.6" /><circle cx="7.5" cy="15.5" r="5.5" /></>),
  admin: svg(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></>),
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 202: 'Accepted', 206: 'Partial Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests' }
const statusLabel = (code: number) => `${code} ${STATUS_TEXT[code] ?? ''}`.trim()

export function ApiDocsPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState("")
  const [activeSection, setActiveSection] = useState<string>("overview")
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

  const categories = apiCategories.map((category) => ({ ...category, icon: categoryIcons[category.id] }))

  const endpoints: Endpoint[] = useMemo(() => buildEndpoints(baseUrl), [baseUrl])

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
        ep.descVi.toLowerCase().includes(query) ||
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

    .overview-code {
      background: var(--code-bg);
      color: #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.8rem;
      margin: 0 0 20px;
      overflow-x: auto;
    }
    .overview-list {
      margin: 0 0 20px;
      padding-left: 18px;
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--text-main);
    }
    .overview-list li { margin-bottom: 6px; }
    .overview-section code, .endpoint-desc code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.78rem;
      background: var(--border-subtle);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 0 4px;
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
            <span className="brand-badge">REST · {endpoints.length} endpoint</span>
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
            {!searchQuery.trim() ? (
              <div className="nav-group">
                <a href="#overview" onClick={() => { setActiveSection("overview"); if (mobileMenuOpen) setMobileMenuOpen(false) }} className={cn("nav-link", activeSection === "overview" && "active")}>
                  <span className="nav-link-title">Tổng quan · xác thực · lỗi</span>
                </a>
              </div>
            ) : null}
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
          {!searchQuery.trim() ? <OverviewSection baseUrl={baseUrl} total={endpoints.length} /> : null}
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
                          {ep.authType === "apiKey" ? "API Key" : ep.authType === "admin" ? "Bearer · Admin" : "Bearer Auth"}
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
                            <span className="status-badge status-200">{statusLabel(ep.successStatus ?? 200)}</span>
                          </button>
                          {ep.errorExample && (
                            <button
                              type="button"
                              onClick={() => setActiveResponseTab((prev) => ({ ...prev, [ep.id]: "400" }))}
                              className={cn("code-tab-btn", responseTab === "400" && "active")}
                            >
                              <span className="status-badge status-400">{statusLabel(ep.errorStatus ?? 400)}</span>
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

function OverviewSection({ baseUrl, total }: { baseUrl: string; total: number }) {
  const rows: Array<[string, string, string]> = [
    ['200 / 201 / 202 / 206', 'Thành công / đã tạo / đã nhận (chạy nền) / một phần (Range)', 'Success / created / accepted (background) / partial (Range)'],
    ['400', 'Dữ liệu không hợp lệ (VALIDATION_ERROR kèm danh sách lỗi) hoặc sai nghiệp vụ', 'Invalid input (VALIDATION_ERROR with issues) or a rule broken'],
    ['401', 'Thiếu / hết hạn access token: gọi /auth/refresh rồi thử lại', 'Missing / expired access token: call /auth/refresh and retry'],
    ['403', 'Không có quyền (ví dụ route quản trị, tài khoản bị khoá)', 'Not allowed (admin route, disabled account)'],
    ['404', 'Không tồn tại — hoặc thuộc người khác (HCDrive không tiết lộ là có tồn tại)', 'Not found — or someone else\'s (existence is not revealed)'],
    ['409', 'Trùng lặp (email đã có, liên kết đã dùng…)', 'Conflict (email taken, already linked…)'],
    ['429', 'Quá nhiều request: chờ số giây trong header Retry-After', 'Too many requests: wait Retry-After seconds'],
    ['502', 'Google Drive / S3 trả lỗi (STORAGE_PROVIDER_ERROR)', 'Google Drive / S3 failed (STORAGE_PROVIDER_ERROR)'],
  ]
  return (
    <section className="api-section overview-section" id="overview">
      <div className="doc-column">
        <h2 className="endpoint-title">Tổng quan API HCDrive</h2>
        <div className="endpoint-subtitle">HCDrive REST API · {total} endpoint</div>
        <p className="endpoint-desc">
          Mọi endpoint nhận và trả JSON (trừ tải lên multipart và các luồng tệp). Đường dẫn trong tài liệu tính từ base URL bên dưới;
          khi chạy Docker một container, API có ở cả <code>/api/…</code> và ở gốc <code>/…</code>.
        </p>

        <div className="section-title"><span>Base URL</span></div>
        <pre className="overview-code">{baseUrl}</pre>

        <div className="section-title"><span>Xác thực</span></div>
        <ul className="overview-list">
          <li><b>Khoá API (API Key):</b> dạng <code>9d_live_…</code> (tạo ở Cài đặt → Khoá API). Sử dụng được cho cả <code>POST /v1/uploads</code> và các API tệp, thư mục, dung lượng qua header <code>Authorization: Bearer 9d_live_…</code> hoặc <code>X-API-Key: 9d_live_…</code> (không cần bước đăng nhập lấy access token).</li>
          <li><b>Access token (Bearer):</b> lấy từ <code>POST /auth/login</code>, gửi trong header <code>Authorization: Bearer &lt;accessToken&gt;</code>. Hết hạn thì đổi token mới bằng <code>POST /auth/refresh</code> với refresh token.</li>
          <li><b>Admin:</b> route <code>/system/*</code> cần access token của quản trị viên (<code>ADMIN_EMAILS</code> hoặc người đăng ký đầu tiên).</li>
          <li><b>Public:</b> link chia sẻ, ảnh thu nhỏ và URL đã ký (<code>/library/stream/…</code>, <code>/library/download/…</code>) không cần header — chính token trên URL là quyền truy cập, và nó hết hạn sau vài giờ.</li>
        </ul>

        <div className="section-title"><span>Quy ước dữ liệu</span></div>
        <ul className="overview-list">
          <li>ID là UUID v4. Nhiều route tệp cũng nhận ID tệp trên Google Drive.</li>
          <li>Kích thước tính bằng byte và luôn là <b>chuỗi</b> (<code>"sizeBytes": "1048576"</code>) vì có thể vượt giới hạn số của JavaScript.</li>
          <li>Thời gian theo ISO 8601 UTC, ví dụ <code>2026-11-03T08:30:00.000Z</code>.</li>
          <li>Lỗi luôn có dạng <code>{'{ "code": "FILE_NOT_FOUND", "message": "…" }'}</code>; dựa vào <code>code</code> để xử lý, <code>message</code> chỉ để hiển thị.</li>
          <li>Giới hạn tần suất: mặc định 2000 request / 15 phút cho mỗi người dùng (hoặc mỗi IP khi chưa đăng nhập); đăng nhập và đăng ký có giới hạn riêng chặt hơn.</li>
        </ul>

        <div className="section-title"><span>Mã trạng thái</span></div>
        <div className="param-table-wrapper">
          <table className="param-table">
            <thead><tr><th>HTTP</th><th>Ý nghĩa</th></tr></thead>
            <tbody>
              {rows.map(([code, vi, en]) => (
                <tr key={code}>
                  <td><span className="param-name">{code}</span></td>
                  <td><div className="param-desc">{vi}<div className="param-desc-en">{en}</div></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="code-column">
        <div className="code-card">
          <div className="code-card-header"><div className="code-tabs"><span className="code-tab-btn active">Bắt đầu nhanh</span></div></div>
          <pre className="code-card-body code-req">{`# Cách A: Dùng Khoá API (tạo ở Cài đặt → Khoá API)
curl "${baseUrl}/files?q=report" \\
  -H "Authorization: Bearer 9d_live_your_key"

# Tải tệp lên đơn giản bằng Khoá API
curl -X POST "${baseUrl}/v1/uploads" \\
  -H "Authorization: Bearer 9d_live_your_key" \\
  -F "file=@document.pdf"

# Cách B: Đăng nhập JWT (dành cho Web/App)
curl -X POST "${baseUrl}/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"a@example.com","password":"..."}'`}</pre>
        </div>
        <div className="code-card">
          <div className="code-card-header"><div className="code-tabs"><span className="code-tab-btn active">Dạng lỗi</span></div></div>
          <pre className="code-card-body code-res-400">{`HTTP/1.1 429 Too Many Requests
Retry-After: 42

{
  "code": "RATE_LIMITED",
  "message": "Quá nhiều yêu cầu. Thử lại sau 42 giây."
}`}</pre>
        </div>
      </div>
    </section>
  )
}
