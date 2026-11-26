'use client'

// 根级错误边界：layout 自身抛错（如数据库不可用）时兜底，必须自带 html/body
import { useEffect, useState } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    console.error(error)
  }, [error])
  useEffect(() => {
    setIsDark(document.cookie.split(';').some((cookie) => cookie.trim() === 'portfolio-theme=dark'))
  }, [])

  // 根布局无法加载时，保留自足的配色和页面重试入口。
  const canvas = isDark ? '#121315' : '#fafafa'
  const panel = isDark ? '#1a1c1f' : '#ffffff'
  const ink = isDark ? '#f4f4f5' : '#18181b'
  const muted = isDark ? '#a1a1aa' : '#64646e'
  const line = isDark ? '#35383f' : '#e4e4e7'
  const onAccent = isDark ? '#18181b' : '#ffffff'

  return (
    <html lang="zh-CN" style={{ colorScheme: isDark ? 'dark' : 'light' }} suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2.5rem 1.5rem',
          background: canvas,
          color: ink,
          fontFamily: '"Inter Variable", "Noto Sans SC Variable", system-ui, sans-serif',
          fontSize: '16px',
          lineHeight: 1.6,
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <main
          role="alert"
          style={{
            width: '100%',
            maxWidth: '520px',
            padding: '2rem',
            border: `1px solid ${line}`,
            borderRadius: '6px',
            background: panel,
          }}
        >
          <h1 style={{ margin: '0.6rem 0 0', fontSize: '20px', fontWeight: 500 }}>
            应用暂时无法启动
          </h1>
          <p style={{ margin: '0.85rem 0 0', color: muted, fontSize: '14px', lineHeight: 1.7 }}>
            读取家庭数据失败，请检查数据库连接后重试。
          </p>
          {error.digest && (
            <p style={{ margin: '1rem 0 0', color: muted, fontSize: '13px' }}>
              参考代码{' '}
              <code
                style={{
                  padding: '0.15rem 0.4rem',
                  borderRadius: '6px',
                  background: canvas,
                  fontFamily: 'inherit',
                }}
              >
                {error.digest}
              </code>
            </p>
          )}
          <div style={{ marginTop: '1.75rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: '44px',
                padding: '0 1.25rem',
                border: `1px solid ${ink}`,
                borderRadius: '6px',
                background: ink,
                color: onAccent,
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: '44px',
                padding: '0 1rem',
                border: `1px solid ${line}`,
                borderRadius: '6px',
                color: ink,
                fontSize: '14px',
                textDecoration: 'none',
              }}
            >
              返回总览
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
