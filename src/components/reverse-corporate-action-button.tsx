'use client'

import { useState, useTransition } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { reverseCorporateAction } from '@/lib/actions'
import { useConfirm } from '@/components/confirm-dialog'

export function ReverseCorporateActionButton({ id }: { id: string }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const confirm = useConfirm()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  async function run() {
    const ok = await confirm({
      title: '整体冲正该次公司行动？',
      impacts: ['该事件派生的全部流水一并作废（保留冲正记录）', '持仓数量与成本按冲正后重算', '关联的拆分/分红核对结果同步失效'],
      confirmLabel: '整体冲正',
      tone: 'danger',
    })
    if (!ok) return
    setError(null)
    startTransition(async () => {
      const res = await reverseCorporateAction(id)
      if (!res.ok) {
        setError(res.error)
        return
      }
      navigateAfterWrite({ message: '公司行动已整体冲正' })
    })
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} onClick={() => { void run() }} className="text-[13px] text-ink-faint hover:text-danger disabled:opacity-40">
        {pending ? '处理中…' : '冲正事件'}
      </button>
      {error && <span role="alert" className="max-w-[240px] text-right text-[12px] text-danger">{error}</span>}
    </span>
  )
}
