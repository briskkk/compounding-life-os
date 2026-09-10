'use client'

// 日常人工兜底：仅刷新当前持仓与基准，完整修复在数据健康中心执行。
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { refreshCurrentPrices } from '@/lib/actions'

export function RefreshPricesButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ tone: 'ok' | 'warning' | 'error'; text: string } | null>(null)
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await refreshCurrentPrices()
          if (res.ok) {
            setResult(res.warning
              ? { tone: 'warning', text: res.warning }
              : {
                  tone: 'ok',
                  text: `已更新 ${res.data?.symbols ?? 0} 个标的 · ${((res.data?.timings.totalMs ?? 0) / 1000).toFixed(1)} 秒`,
                })
          } else {
            setResult({ tone: 'error', text: res.error })
          }
          router.refresh()
          setTimeout(() => setResult(null), 6000)
        })
      }
      className={`h-11 shrink-0 whitespace-nowrap rounded-lg border bg-transparent px-3 text-[14px] transition-colors disabled:opacity-40 ${
        result?.tone === 'warning'
          ? 'border-amber/50 text-amber'
          : result?.tone === 'error'
            ? 'border-up/50 text-up'
            : result?.tone === 'ok'
              ? 'border-down/40 text-down'
              : 'border-line text-ink-dim hover:border-accent hover:text-accent'
      }`}
      title={result?.text ?? '自动刷新之外的人工兜底：更新当前持仓、基准与受影响快照'}
    >
      {pending ? '刷新中…' : result?.tone === 'warning' ? '⚠ 部分失败' : result?.tone === 'error' ? '× 刷新失败' : result?.tone === 'ok' ? '✓ 已刷新' : '↻ 当前持仓'}
    </button>
  )
}
