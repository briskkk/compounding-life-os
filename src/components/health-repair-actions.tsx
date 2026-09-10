'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { rebuildDerivedSnapshots, refreshPrices } from '@/lib/actions'

type Operation = 'quotes' | 'snapshots'

export function HealthRepairActions() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [active, setActive] = useState<Operation | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const run = (operation: Operation) => startTransition(async () => {
    setActive(operation)
    setMessage(null)
    if (operation === 'quotes') {
      const result = await refreshPrices()
      if (!result.ok) setMessage(result.error)
      else setMessage(result.warning ?? `已补齐 ${result.data?.symbols ?? 0} 个标的并全量重建快照 · ${((result.data?.timings.totalMs ?? 0) / 1000).toFixed(1)} 秒`)
    } else {
      const result = await rebuildDerivedSnapshots()
      if (!result.ok) setMessage(result.error)
      else setMessage(`已重建 ${result.data?.days ?? 0} 天派生快照`)
    }
    setActive(null)
    router.refresh()
  })

  return (
    <div className="health-repair-actions">
      <button type="button" disabled={pending} onClick={() => run('quotes')}>
        {active === 'quotes' ? '完整补齐中…' : '完整补齐行情历史'}
      </button>
      <button type="button" disabled={pending} onClick={() => run('snapshots')}>
        {active === 'snapshots' ? '重建中…' : '重建派生快照'}
      </button>
      {message && <span>{message}</span>}
    </div>
  )
}
