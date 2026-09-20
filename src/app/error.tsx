'use client'

// 路由级错误边界：账本重放或行情读取失败时兜底（不改动任何数据）
import { useEffect } from 'react'
import Link from 'next/link'

function safeMessage(message: string | undefined): string | null {
  if (!message) return null
  // 单行化后仍短、且含中文时才认为是可以给用户看的业务提示（堆栈/JSON 转储一律不展示）
  const text = message.replace(/\s+/g, ' ').trim()
  if (text.length === 0 || text.length >= 120) return null
  if (!/[\u4e00-\u9fff]/.test(text)) return null
  return text
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const detail = safeMessage(error.message)

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-10">
      <section
        className="w-full max-w-xl rounded-xl border border-line bg-panel p-8"
        role="alert"
        aria-labelledby="route-error-title"
      >
        <h1 id="route-error-title" className="mt-2 text-[20px] font-medium text-ink">
          这一页没能算出来
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          账本流水或行情报价读取失败，页面无法完成重放。数据没有被修改，刷新或重试即可，也可以先去数据健康页确认行情来源。
        </p>
        {detail && <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">{detail}</p>}
        {error.digest && (
          <p className="mt-4">
            <span className="text-[13px] text-ink-faint">参考代码 </span>
            <code className="num rounded bg-panel2 px-1.5 py-0.5 text-[13px] text-ink-dim">{error.digest}</code>
          </p>
        )}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-accent bg-accent px-5 text-[14px] font-medium text-bg transition-colors hover:bg-accent/90"
          >
            重试
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[14px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
          >
            返回总览
          </Link>
          <Link
            href="/health"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-[14px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
          >
            数据健康
          </Link>
        </div>
      </section>
    </div>
  )
}
