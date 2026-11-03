// navigator.clipboard only exists on https:// and localhost. HCDrive is often opened over plain
// http on a LAN address (http://10.0.0.x:5173), where every "Copy link" button threw. This puts in
// a writeText that copies through a hidden textarea and execCommand('copy') instead.
function legacyWriteText(text: string) {
  return new Promise<void>((resolve, reject) => {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    const selection = document.getSelection()
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    area.select()
    area.setSelectionRange(0, text.length)
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(area)
    if (previous && selection) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
    if (ok) resolve()
    else reject(new Error('Clipboard is not available'))
  })
}

// TypeScript types navigator.clipboard as always present; on http it is undefined.
function nativeClipboard() {
  return (navigator as { clipboard?: Clipboard }).clipboard
}

export function installClipboardFallback() {
  if (typeof navigator === 'undefined' || nativeClipboard()) return
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: legacyWriteText },
    })
  } catch {
    // A browser that refuses the property keeps its own behaviour.
  }
}

/** Copies text, falling back to the textarea copy when the Clipboard API refuses (http, no focus). */
export async function copyText(text: string) {
  try {
    const clipboard = nativeClipboard()
    if (clipboard) {
      await clipboard.writeText(text)
      return
    }
  } catch {
    // fall through
  }
  await legacyWriteText(text)
}
