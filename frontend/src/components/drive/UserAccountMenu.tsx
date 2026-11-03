import { useEffect, useRef } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import type { AuthUser } from '@/lib/auth'

export interface UserAccountMenuProps {
  open: boolean
  onClose: () => void
  user: AuthUser | null
  profileImageUrl: string
  avatarError: boolean
  setAvatarError: (val: boolean) => void
  onLogout: () => void
  lang: 'vi' | 'en'
  onOpenProfile?: () => void
}

export function UserAccountMenu({
  open,
  onClose,
  user,
  profileImageUrl,
  avatarError,
  setAvatarError,
  onLogout,
  lang,
}: UserAccountMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const vi = lang === 'vi'

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase()

  return (
    <div
      ref={menuRef}
      className="absolute right-3 top-14 z-50 w-80 rounded-[28px] border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#1e1f20] p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-slate-800 dark:text-slate-100"
    >
      <div className="flex flex-col items-center text-center pb-4 border-b border-slate-100 dark:border-slate-800">
        <p className="text-xs font-medium text-slate-500 truncate max-w-[240px] mb-3">
          {user?.email}
        </p>

        {/* Big Avatar */}
        <div className="relative mb-3">
          {!profileImageUrl || avatarError ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-bold text-white shadow-sm border-2 border-white dark:border-[#1e1f20]">
              {initial}
            </div>
          ) : (
            <img
              src={profileImageUrl}
              alt="Avatar"
              className="h-16 w-16 rounded-full border-2 border-white dark:border-[#1e1f20] object-cover shadow-sm"
              onError={() => setAvatarError(true)}
            />
          )}
          {user?.isAdmin ? (
            <span
              title={vi ? 'Quản trị viên' : 'Administrator'}
              className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow"
            >
              <ShieldCheck className="h-3 w-3" />
            </span>
          ) : null}
        </div>

        <h3 className="text-base font-normal text-slate-900 dark:text-slate-100 truncate max-w-[240px]">
          {vi ? `Xin chào, ${user?.name || 'bạn'}!` : `Hi, ${user?.name || 'there'}!`}
        </h3>
      </div>

      <div className="pt-3 flex justify-center">
        <button
          type="button"
          onClick={() => {
            onClose()
            onLogout()
          }}
          className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          <LogOut className="h-4 w-4" />
          <span>{vi ? 'Đăng xuất' : 'Sign out'}</span>
        </button>
      </div>
    </div>
  )
}
