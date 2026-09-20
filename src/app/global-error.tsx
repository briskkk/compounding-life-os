'use client'

// 根级错误边界：layout 自身抛错（如数据库不可用）时兜底，必须自带 html/body
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2.5rem 1.5rem',
          background: '#151719',
          color: '#f3f5f7',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
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
            border: '1px solid #292e33',
            borderRadius: '14px',
            background: '#1a1d1f',
          }}
        >
          <h1 style={{ margin: '0.6rem 0 0', color: '#f3f5f7', fontSize: '20px', fontWeight: 500 }}>
            应用暂时无法启动
          </h1>
          <p style={{ margin: '0.85rem 0 0', color: '#a9afb5', fontSize: '14px', lineHeight: 1.7 }}>
            读取家庭空间或账本数据失败，界面没有加载完成。数据没有被修改；请确认数据库可访问后重试，或稍后再打开。
          </p>
          {error.digest && (
            <p style={{ margin: '1rem 0 0', color: '#8d959d', fontSize: '13px' }}>
              参考代码{' '}
              <code
                style={{
                  padding: '0.15rem 0.4rem',
                  borderRadius: '4px',
                  background: '#202428',
                  color: '#a9afb5',
                  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
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
                border: '1px solid #79bfff',
                borderRadius: '8px',
                background: '#79bfff',
                color: '#151719',
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
                border: '1px solid #292e33',
                borderRadius: '8px',
                color: '#a9afb5',
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
