'use client'

import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState, useTransition } from 'react'
import { rebuildDerivedSnapshots, refreshPrices } from '@/lib/actions'
import { useConfirm } from '@/components/confirm-dialog'

type Operation = 'quotes' | 'snapshots'

export function HealthRepairActions() {
  const navigateAfterWrite = useNavigateAfterWrite()
  const confirm = useConfirm()
  const [pending, startTransition] = useTransition()
  const [active, setActive] = useState<Operation | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function start(operation: Operation) {
    const ok = await confirm(operation === 'quotes'
      ? {
          title: '完整补齐行情历史？',
          description: '会向行情源逐个标的补齐历史，并全量重建派生快照。',
          impacts: ['耗时通常在数十秒到数分钟，期间不要重复点击', '补齐会改写历史估值证据，历史复盘结论可能变化', '不改变任何账本流水'],
          confirmLabel: '开始补齐',
        }
      : {
          title: '重建派生快照？',
          description: '按当前账本与行情重算每日派生快照。',
          impacts: ['耗时与账本天数成正比，通常数秒到数十秒', '快照是派生数据，可安全重建；流水不受影响', '重建期间其它页面可能读到旧快照'],
          confirmLabel: '开始重建',
        })
    if (!ok) return
    run(operation)
  }

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
    navigateAfterWrite({ message: '行情与派生快照维护已完成' })
  })

  return (
    <div className="health-repair-actions">
      <button type="button" disabled={pending} onClick={() => { void start('quotes') }}>
        {active === 'quotes' ? '完整补齐中…' : '完整补齐行情历史'}
      </button>
      <button type="button" disabled={pending} onClick={() => { void start('snapshots') }}>
        {active === 'snapshots' ? '重建中…' : '重建派生快照'}
      </button>
      {message && <span>{message}</span>}
    </div>
  )
}
