'use client'

// 日常人工兜底：仅刷新当前持仓与基准，完整修复在数据健康中心执行。
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState, useTransition } from 'react'
import { refreshCurrentPrices } from '@/lib/actions'
import { TerminalIcon } from '@/components/terminal-icon'

export function RefreshPricesButton() {
  const navigateAfterWrite = useNavigateAfterWrite()
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
            // 刷新后必须让报价、快照与当日盈亏真正落到界面上（P0-11）：走真实导航并带提示
            navigateAfterWrite(res.warning
              ? { message: `行情已刷新；${res.warning}`, tone: 'warn' }
              : { message: `已更新 ${res.data?.symbols ?? 0} 个标的 · ${((res.data?.timings.totalMs ?? 0) / 1000).toFixed(1)} 秒`, tone: 'ok' })
            return
          }
          setResult({ tone: 'error', text: res.error })
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
      <span className="inline-flex items-center gap-2">
        <TerminalIcon name="refresh" className={pending ? 'animate-spin' : undefined} width="15" height="15" />
        {pending ? '刷新中…' : result?.tone === 'warning' ? '部分失败' : result?.tone === 'error' ? '刷新失败' : result?.tone === 'ok' ? '已刷新' : '当前持仓'}
      </span>
    </button>
  )
}
