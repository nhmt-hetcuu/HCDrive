import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { installClipboardFallback } from './lib/clipboard'
// Imported early so the browser's install prompt (fired once, at load) is kept for the menu.
import './lib/pwa'
import './style.css'

installClipboardFallback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
