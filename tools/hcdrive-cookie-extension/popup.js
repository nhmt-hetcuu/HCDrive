// HCDrive - Google Drive Cookie Exporter
// Popup Controller (Manifest V3)

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const statusCard = document.getElementById('statusCard')
  const statusText = document.getElementById('statusText')
  const badgeContainer = document.getElementById('badgeContainer')
  const accountInfo = document.getElementById('accountInfo')
  const accountEmail = document.getElementById('accountEmail')
  const cookieStats = document.getElementById('cookieStats')
  const previewContainer = document.getElementById('previewContainer')
  const cookieTextarea = document.getElementById('cookieTextarea')
  const btnTogglePreview = document.getElementById('btnTogglePreview')
  const btnCopy = document.getElementById('btnCopy')
  const btnDownload = document.getElementById('btnDownload')
  const btnOpenHCDrive = document.getElementById('btnOpenHCDrive')
  const btnRefresh = document.getElementById('btnRefresh')
  const hcdriveUrlInput = document.getElementById('hcdriveUrlInput')
  const btnSaveUrl = document.getElementById('btnSaveUrl')
  const toast = document.getElementById('toast')

  let currentCookieString = ''
  let currentCookieMap = new Map()
  let isPreviewOpen = false
  let defaultHCDriveUrl = 'http://localhost:5173'

  // Load configured HCDrive URL
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['hcdrive_url'], (res) => {
      if (res && res.hcdrive_url) {
        defaultHCDriveUrl = res.hcdrive_url
        hcdriveUrlInput.value = res.hcdrive_url
      }
    })
  }

  // Save custom HCDrive URL
  btnSaveUrl.addEventListener('click', () => {
    let url = (hcdriveUrlInput.value || '').trim()
    if (!url) url = 'http://localhost:5173'
    if (url.endsWith('/')) url = url.slice(0, -1)
    defaultHCDriveUrl = url
    hcdriveUrlInput.value = url

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ hcdrive_url: url }, () => {
        showToast('Đã lưu cấu hình địa chỉ HCDrive!')
      })
    } else {
      showToast('Đã lưu cấu hình!')
    }
  })

  // Toggle preview textarea
  btnTogglePreview.addEventListener('click', () => {
    isPreviewOpen = !isPreviewOpen
    if (isPreviewOpen) {
      previewContainer.classList.remove('hidden')
      btnTogglePreview.textContent = 'Thu gọn'
    } else {
      previewContainer.classList.add('hidden')
      btnTogglePreview.textContent = 'Xem chi tiết'
    }
  })

  // Refresh handler
  btnRefresh.addEventListener('click', () => {
    btnRefresh.style.transform = 'rotate(360deg)'
    setTimeout(() => {
      btnRefresh.style.transform = 'none'
    }, 500)
    scanGoogleCookies()
  })

  // Copy Cookie handler
  btnCopy.addEventListener('click', async () => {
    if (!currentCookieString) return
    try {
      await navigator.clipboard.writeText(currentCookieString)
      showToast('Đã sao chép Cookie vào bộ nhớ tạm!')

      const originalHtml = btnCopy.innerHTML
      btnCopy.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>Đã sao chép!</span>
      `
      setTimeout(() => {
        btnCopy.innerHTML = originalHtml
      }, 2000)
    } catch (err) {
      // Fallback
      cookieTextarea.select()
      document.execCommand('copy')
      showToast('Đã sao chép Cookie!')
    }
  })

  // Download cookie file handler
  btnDownload.addEventListener('click', () => {
    if (!currentCookieString) return
    const blob = new Blob([currentCookieString], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `google-drive-cookie-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('Đã tải xuống file cookie!')
  })

  // Open HCDrive account page handler
  btnOpenHCDrive.addEventListener('click', () => {
    const targetUrl = `${defaultHCDriveUrl}/accounts`
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: targetUrl })
    } else {
      window.open(targetUrl, '_blank')
    }
  })

  // Show Toast
  function showToast(msg) {
    toast.textContent = msg
    toast.classList.remove('hidden')
    toast.style.opacity = '1'
    setTimeout(() => {
      toast.style.opacity = '0'
      setTimeout(() => {
        toast.classList.add('hidden')
      }, 300)
    }, 2500)
  }

  // Main Scan Function
  async function scanGoogleCookies() {
    setLoadingState()

    try {
      const cookieMap = new Map()

      // Fetch cookies from google.com, drive.google.com and accounts.google.com
      const sources = [
        { domain: 'google.com' },
        { domain: '.google.com' },
        { url: 'https://drive.google.com/' },
        { domain: 'drive.google.com' },
        { url: 'https://accounts.google.com/' },
      ]

      for (const src of sources) {
        try {
          const cookies = await getCookiesAsync(src)
          if (Array.isArray(cookies)) {
            for (const c of cookies) {
              if (c && c.name && c.value) {
                // If already exists, keep or overwrite if new is secure/specific
                cookieMap.set(c.name, c.value)
              }
            }
          }
        } catch (e) {
          console.warn('Lỗi quét cookie nguồn:', src, e)
        }
      }

      currentCookieMap = cookieMap

      // Priority session cookies
      const priorityOrder = [
        'SID',
        'HSID',
        'SSID',
        'APISID',
        'SAPISID',
        '__Secure-1PSID',
        '__Secure-3PSID',
        '__Secure-1PAPISID',
        '__Secure-3PAPISID',
        'OSID',
        '__Secure-OSID',
        'NID',
        'SEARCH_SAMESITE',
        '1P_JAR',
      ]

      const formattedPairs = []
      const addedKeys = new Set()

      // Add priority cookies first
      for (const key of priorityOrder) {
        if (cookieMap.has(key)) {
          formattedPairs.push(`${key}=${cookieMap.get(key)}`)
          addedKeys.add(key)
        }
      }

      // Add remaining cookies
      for (const [key, val] of cookieMap.entries()) {
        if (!addedKeys.has(key)) {
          formattedPairs.push(`${key}=${val}`)
        }
      }

      currentCookieString = formattedPairs.join('; ')
      cookieTextarea.value = currentCookieString

      // Detect status
      const hasSID = cookieMap.has('SID')
      const hasHSID = cookieMap.has('HSID')
      const hasSSID = cookieMap.has('SSID')
      const hasSAPISID = cookieMap.has('SAPISID')
      const hasOSID = cookieMap.has('OSID')

      // Render Badges
      renderBadges([
        { name: 'SID', has: hasSID },
        { name: 'HSID', has: hasHSID },
        { name: 'SSID', has: hasSSID },
        { name: 'SAPISID', has: hasSAPISID },
        { name: 'OSID', has: hasOSID },
      ])

      const isValidSession = hasSID && (hasHSID || hasSSID || hasSAPISID)

      if (isValidSession) {
        setSuccessState(cookieMap.size, currentCookieString.length)
      } else if (cookieMap.size > 0) {
        setWarningState(cookieMap.size)
      } else {
        setErrorState()
      }

      // Try detecting user email from current tab or Google cookies
      detectEmailFromTabs()
    } catch (err) {
      console.error('Lỗi khi quét cookies:', err)
      setErrorState(err.message)
    }
  }

  // Promise wrapper for chrome.cookies.getAll
  function getCookiesAsync(details) {
    return new Promise((resolve) => {
      if (!chrome.cookies || !chrome.cookies.getAll) {
        resolve([])
        return
      }
      chrome.cookies.getAll(details, (cookies) => {
        if (chrome.runtime.lastError) {
          resolve([])
        } else {
          resolve(cookies || [])
        }
      })
    })
  }

  // Set loading state
  function setLoadingState() {
    statusCard.className = 'status-card status-loading'
    statusText.textContent = 'Đang quét Cookie Google Drive...'
    badgeContainer.innerHTML = ''
    btnCopy.disabled = true
    btnDownload.disabled = true
  }

  // Set success state
  function setSuccessState(count, charCount) {
    statusCard.className = 'status-card status-success'
    statusText.textContent = `Đã tìm thấy phiên Google Drive hợp lệ (${count} cookies)`
    accountInfo.classList.remove('hidden')
    cookieStats.textContent = `${count} cookie (${charCount.toLocaleString()} ký tự)`
    btnCopy.disabled = false
    btnDownload.disabled = false
  }

  // Set warning state
  function setWarningState(count) {
    statusCard.className = 'status-card status-warning'
    statusText.textContent = `Tìm thấy ${count} cookies nhưng thiếu token phiên chính (SID/HSID)`
    accountInfo.classList.remove('hidden')
    cookieStats.textContent = `${count} cookie`
    btnCopy.disabled = false
    btnDownload.disabled = false
  }

  // Set error state
  function setErrorState(extraMsg) {
    statusCard.className = 'status-card status-error'
    statusText.textContent = extraMsg || 'Chưa tìm thấy phiên đăng nhập Google Drive'
    badgeContainer.innerHTML = `
      <span class="badge badge-missing">Chưa đăng nhập</span>
      <span style="font-size: 11px; color: #b91c1c; margin-top: 4px; display: block;">
        Hãy mở <b>drive.google.com</b> trên trình duyệt, đăng nhập rồi mở lại extension.
      </span>
    `
    accountInfo.classList.add('hidden')
    btnCopy.disabled = true
    btnDownload.disabled = true
  }

  // Render Cookie Badges
  function renderBadges(items) {
    badgeContainer.innerHTML = ''
    for (const item of items) {
      const span = document.createElement('span')
      span.className = `badge ${item.has ? 'badge-success' : 'badge-missing'}`
      span.textContent = `${item.has ? '✓' : '✗'} ${item.name}`
      badgeContainer.appendChild(span)
    }
  }

  // Detect email from active tab or page title
  function detectEmailFromTabs() {
    if (!chrome.tabs || !chrome.tabs.query) {
      accountEmail.textContent = 'Tự động nhận diện khi kết nối vào HCDrive'
      return
    }

    chrome.tabs.query({}, (tabs) => {
      let foundEmail = null

      if (Array.isArray(tabs)) {
        for (const tab of tabs) {
          const title = tab.title || ''
          const url = tab.url || ''

          if (url.includes('drive.google.com') || url.includes('accounts.google.com') || url.includes('mail.google.com')) {
            const matches = title.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
            if (matches && matches[0]) {
              const lower = matches[0].toLowerCase()
              if (!lower.endsWith('@google.com') && !lower.includes('support')) {
                foundEmail = matches[0]
                break
              }
            }
          }
        }
      }

      if (foundEmail) {
        accountEmail.textContent = foundEmail
      } else {
        accountEmail.textContent = 'Tự động phát hiện khi kết nối HCDrive'
      }
    })
  }

  // Initial Scan
  scanGoogleCookies()
})
