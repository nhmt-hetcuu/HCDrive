import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Code2, Heart, HelpCircle, Keyboard, MessageSquare, Monitor, RotateCcw, Settings, SlidersHorizontal } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { HelpModal } from '@/components/drive/HelpModal'
import { DonateModal } from '@/components/drive/DonateModal'
import { useMenuPosition } from '@/hooks/useMenuPosition'
import { useSnackbar } from '@/context/SnackbarContext'
import { promptInstall } from '@/lib/pwa'

// The ? and gear buttons of the header open small menus, laid out like Google Drive's.

const PROJECT_URL = 'https://github.com/nhmt-hetcuu/HCDrive'

type MenuItem = { key: string; label: string; icon: ReactNode; onSelect: () => void } | 'divider'

function HeaderMenu({ anchor, items, onClose }: { anchor: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  // Anchored at the button's bottom-right corner; the hook flips/clamps it inside the window.
  const { menuRef, style } = useMenuPosition({ x: anchor.x, y: anchor.y, onClose })
  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default bg-transparent" aria-label="Close menu" onClick={onClose} />
      <div ref={menuRef} style={style} role="menu" className="min-w-60 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#1e1f20] py-2 shadow-xl text-slate-700 dark:text-slate-200">
        {items.map((item, index) =>
          item === 'divider' ? (
            <div key={`divider-${index}`} className="my-2 border-t border-slate-200 dark:border-slate-700" />
          ) : (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                onClose()
                item.onSelect()
              }}
              className="flex h-10 w-full items-center gap-3 px-4 text-left text-sm hover:bg-slate-100 dark:hover:bg-[#282a2c] cursor-pointer"
            >
              <span className="text-slate-500 dark:text-slate-400">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ),
        )}
      </div>
    </>
  )
}

function MenuButton({ label, icon, items }: { label: string; icon: ReactNode; items: MenuItem[] }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <Tooltip content={label}>
        <button
          type="button"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setAnchor(anchor ? null : { x: rect.right, y: rect.bottom + 6 })
          }}
          className={`flex h-10 w-10 items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-[#282a2c] transition cursor-pointer ${anchor ? 'ring-2 ring-[#0b57d0] dark:ring-[#a8c7fa]' : ''}`}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
        >
          {icon}
        </button>
      </Tooltip>
      {anchor ? <HeaderMenu anchor={anchor} items={items} onClose={() => setAnchor(null)} /> : null}
    </>
  )
}

export function HeaderMenus({ lang }: { lang: 'vi' | 'en' }) {
  const vi = lang === 'vi'
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const [help, setHelp] = useState<'all' | 'shortcuts' | null>(null)
  const [donateOpen, setDonateOpen] = useState(false)

  // Ctrl + / (Cmd + / on a Mac) shows the shortcuts, as in Google Drive.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault()
        setHelp('shortcuts')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function install() {
    const result = await promptInstall()
    if (result === 'installed') showSnackbar(vi ? 'HCDrive đang chạy như một ứng dụng trên máy này.' : 'HCDrive is already installed on this computer.')
    else if (result === 'insecure') showSnackbar(vi ? 'Trình duyệt chỉ cho cài khi HCDrive chạy qua https://. Tạm thời có thể dùng menu trình duyệt → "Thêm vào màn hình chính / Tạo lối tắt".' : 'Browsers allow installing only over https://. Meanwhile use the browser menu → "Create shortcut".')
    else if (result === 'unavailable') showSnackbar(vi ? 'Trình duyệt này chưa cho cài. Dùng Chrome/Edge: biểu tượng cài đặt ở thanh địa chỉ, hoặc menu → "Cài đặt HCDrive".' : 'This browser does not offer installing. In Chrome/Edge use the install icon in the address bar.')
  }

  const settingsItems: MenuItem[] = [
    { key: 'settings', label: vi ? 'Cài đặt' : 'Settings', icon: <SlidersHorizontal className="h-4 w-4" />, onSelect: () => navigate('/settings') },
    { key: 'restore', label: vi ? 'Khôi phục tệp đã xoá' : 'Restore deleted files', icon: <RotateCcw className="h-4 w-4" />, onSelect: () => navigate('/trash') },
    { key: 'install', label: vi ? 'Cài HCDrive lên máy tính' : 'Install HCDrive on this computer', icon: <Monitor className="h-4 w-4" />, onSelect: () => { install().catch(() => undefined) } },
    { key: 'shortcuts', label: vi ? 'Phím tắt' : 'Keyboard shortcuts', icon: <Keyboard className="h-4 w-4" />, onSelect: () => setHelp('shortcuts') },
  ]
  const helpItems: MenuItem[] = [
    { key: 'help', label: vi ? 'Trợ giúp' : 'Help', icon: <HelpCircle className="h-4 w-4" />, onSelect: () => setHelp('all') },
    { key: 'guide', label: vi ? 'Hướng dẫn sử dụng' : 'User guide', icon: <BookOpen className="h-4 w-4" />, onSelect: () => window.open(`${PROJECT_URL}#readme`, '_blank', 'noopener') },
    { key: 'apidocs', label: vi ? 'Tài liệu REST API' : 'REST API Docs', icon: <Code2 className="h-4 w-4 text-emerald-500" />, onSelect: () => navigate('/api-docs') },
    { key: 'donate', label: vi ? 'Ủng hộ tác giả (Donate)' : 'Donate / Support', icon: <Heart className="h-4 w-4 text-rose-500 fill-rose-500/20" />, onSelect: () => setDonateOpen(true) },
    'divider',
    { key: 'feedback', label: vi ? 'Gửi ý kiến phản hồi' : 'Send feedback', icon: <MessageSquare className="h-4 w-4" />, onSelect: () => window.open(`${PROJECT_URL}/issues/new`, '_blank', 'noopener') },
  ]

  return (
    <>
      <MenuButton label={vi ? 'Trợ giúp' : 'Help'} icon={<HelpCircle className="h-5 w-5" />} items={helpItems} />
      <MenuButton label={vi ? 'Cài đặt' : 'Settings'} icon={<Settings className="h-5 w-5" />} items={settingsItems} />
      <HelpModal open={help !== null} shortcutsOnly={help === 'shortcuts'} onClose={() => setHelp(null)} lang={lang} />
      <DonateModal open={donateOpen} onClose={() => setDonateOpen(false)} lang={lang} />
    </>
  )
}
