'use client'

// 刷新行情：历史日线落库 + 快照重建
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { refreshPrices } from '@/lib/actions'

export function RefreshPricesButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await refreshPrices()
          if (res.ok) setDone(true)
          router.refresh()
          setTimeout(() => setDone(false), 3000)
        })
      }
      className="h-11 shrink-0 whitespace-nowrap rounded-lg border border-line bg-transparent px-3 text-[14px] text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
      title="拉取最新行情历史并重建快照"
    >
      {pending ? '刷新中…' : done ? '✓ 已刷新' : '↻ 行情'}
    </button>
  )
}
