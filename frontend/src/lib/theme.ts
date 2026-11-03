export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'hcdrive:theme'

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('9drive:theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    // Storage can be blocked; fall back to system
  }
  return 'system'
}

export function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

// The class lives on <html> so login, register and public share pages follow the same theme as the dashboard.
export function applyTheme(theme: Theme) {
  const effective = getEffectiveTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', effective === 'dark')
  root.classList.toggle('light', effective === 'light')
}

export function saveTheme(theme: Theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Ignore: the theme still applies for this visit.
  }
}

// Listen for system preference changes when in 'system' mode
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getInitialTheme() === 'system') {
      applyTheme('system')
    }
  })
}
