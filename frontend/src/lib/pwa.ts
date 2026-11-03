// Chrome and Edge offer to install a PWA through a `beforeinstallprompt` event that has to be kept
// for later: the "Install HCDrive on this computer" menu item replays it. The event only fires on
// https:// (or localhost) once the app is installable and not installed yet.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferredPrompt: InstallPromptEvent | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
  })
}

export function isInstalledApp() {
  return typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
}

/** 'prompted' when the browser's install dialog was shown, otherwise why it could not be. */
export async function promptInstall(): Promise<'prompted' | 'installed' | 'insecure' | 'unavailable'> {
  if (isInstalledApp()) return 'installed'
  if (deferredPrompt) {
    const event = deferredPrompt
    deferredPrompt = null
    await event.prompt()
    await event.userChoice.catch(() => undefined)
    return 'prompted'
  }
  return window.isSecureContext ? 'unavailable' : 'insecure'
}
