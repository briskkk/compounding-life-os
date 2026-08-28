'use client'

// 刷新行情：历史日线落库 + 快照重建
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { refreshPrices } from '@/lib/actions'

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
          const res = await refreshPrices()
          if (res.ok) {
            setResult(res.warning
              ? { tone: 'warning', text: res.warning }
              : { tone: 'ok', text: '行情与快照已刷新' })
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
      title={result?.text ?? '拉取最新行情历史并重建快照'}
    >
      {pending ? '刷新中…' : result?.tone === 'warning' ? '⚠ 部分失败' : result?.tone === 'error' ? '× 刷新失败' : result?.tone === 'ok' ? '✓ 已刷新' : '↻ 行情'}
    </button>
  )
}
