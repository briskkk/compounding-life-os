'use client'

// 冲正按钮：二次确认后作废流水及其结算腿
// 冲正失败必须可见（原实现丢弃返回值，用户会重复点击）
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useConfirm } from '@/components/confirm-dialog'
import { useState } from 'react'
import { reverseTransaction } from '@/lib/actions'

export function ReverseButton({ id, label }: { id: string; label: string }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const confirm = useConfirm()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmReverse() {
    if (pending) return
    const ok = await confirm({
      title: '冲正这笔流水？',
      description: label,
      impacts: [
        '原流水标记为已作废（保留 REVERSAL 记录，账本不删行）',
        '该流水派生的联动结算腿一并作废',
        '持仓、快照与本月复盘按冲正后的账本重算',
      ],
      confirmLabel: '确认冲正',
      tone: 'danger',
    })
    if (!ok) return
    setPending(true)
    setError(null)
    try {
      const res = await reverseTransaction(id)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // 冲正后原记录从日常视图消失，必须由写入后的真实导航保证（P0-11）；
      // 快照未重建等未完成部分以警告语气展示，不再用阻塞式弹窗。
      navigateAfterWrite(res.warning
        ? { message: `已冲正；${res.warning}`, tone: 'warn' }
        : { message: '已冲正，并生成 REVERSAL 记录', tone: 'ok' })
    } finally {
      setPending(false)
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        title={label}
        disabled={pending}
        onClick={() => {
          setError(null)
          void confirmReverse()
        }}
        className="text-[13px] text-ink-faint transition-colors hover:text-danger disabled:opacity-40"
      >
        {pending ? '处理中…' : '冲正'}
      </button>
      {error && <span role="alert" className="max-w-[220px] text-right text-[12px] text-danger">{error}</span>}
    </span>
  )
}
