import { cn } from '@/lib/utils'

// The HCDrive mark: an H whose crossbar runs into a C. Same drawing as public/favicon.svg and the PWA icons.
export function BrandLogo({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' | string }) {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
  }[size] || 'h-10 w-10'

  return (
    <svg viewBox="0 0 48 48" className={cn('shrink-0', sizeClasses, className)} role="img" aria-label="HCDrive logo">
      <rect width="48" height="48" rx="12" fill="#2563eb" />
      <rect x="9" y="15" width="4.5" height="18" rx="2.25" fill="#fff" />
      <rect x="17.5" y="15" width="4.5" height="18" rx="2.25" fill="#fff" />
      <path d="M37.3 18.7A7.5 7.5 0 1 0 37.3 29.3" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <rect x="9" y="21.75" width="23" height="4.5" rx="2.25" fill="#fff" />
      <circle cx="32" cy="24" r="2.6" fill="#93c5fd" />
    </svg>
  )
}
