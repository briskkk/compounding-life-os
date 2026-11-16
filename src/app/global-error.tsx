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
  const paper = isDark ? '#201d19' : '#fffef5'
  const panel = isDark ? '#29241f' : '#fffef5'
  const ink = isDark ? '#fbf0dc' : '#2c2c2c'
  const muted = isDark ? '#c7b8a1' : '#605b50'
  const line = isDark ? '#a89579' : '#2c2c2c'
  const marker = isDark ? '#e9bf55' : '#ffd93d'

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
          background: paper,
          color: ink,
          fontFamily: 'Nunito, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
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
            border: `2px dashed ${line}`,
            borderRadius: '2px',
            background: panel,
            boxShadow: `4px 4px 0 ${marker}`,
          }}
        >
          <h1 style={{ margin: '0.6rem 0 0', fontSize: '20px', fontWeight: 700 }}>
            应用暂时无法启动
          </h1>
          <p style={{ margin: '0.85rem 0 0', color: muted, fontSize: '14px', lineHeight: 1.7 }}>
            读取家庭空间或账本数据失败，界面没有加载完成。数据没有被修改；请确认数据库可访问后重试，或稍后再打开。
          </p>
          {error.digest && (
            <p style={{ margin: '1rem 0 0', color: muted, fontSize: '13px' }}>
              参考代码{' '}
              <code
                style={{
                  padding: '0.15rem 0.4rem',
                  borderRadius: '2px',
                  background: paper,
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
                border: '2px dashed #2c2c2c',
                borderRadius: '2px',
                background: marker,
                color: '#2c2c2c',
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
                border: `2px dashed ${line}`,
                borderRadius: '2px',
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
