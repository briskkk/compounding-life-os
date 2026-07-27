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
      className="rounded border border-line bg-panel2 px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-40"
      title="拉取最新行情历史并重建快照"
    >
      {pending ? '刷新中…' : done ? '✓ 已刷新' : '↻ 行情'}
    </button>
  )
}
