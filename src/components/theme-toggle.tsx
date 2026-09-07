'use client'

import { useState } from 'react'

export function ThemeToggle({ initialTheme }: { initialTheme: 'light' | 'dark' }) {
  const [theme, setTheme] = useState(initialTheme)
  const label = theme === 'dark' ? '切换到浅色皮肤' : '切换到深色皮肤'

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    document.cookie = `portfolio-theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
    setTheme(next)
  }

  return (
    <button type="button" onClick={toggle} aria-label={label} title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-ink-dim hover:border-ink-faint hover:bg-panel2 hover:text-ink">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'dark' ? <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </> : <path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z" />}
      </svg>
    </button>
  )
}
