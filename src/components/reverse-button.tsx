'use client'

// 冲正按钮：二次确认后作废流水及其结算腿
// 冲正失败必须可见（原实现丢弃返回值，用户会重复点击）
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState } from 'react'
import { reverseTransaction } from '@/lib/actions'

export function ReverseButton({ id, label }: { id: string; label: string }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmReverse() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await reverseTransaction(id)
      if (!res.ok) {
        setError(res.error)
        setConfirming(false)
        return
      }
      setConfirming(false)
      // 冲正后原记录从日常视图消失，必须由写入后的真实导航保证（P0-11）；
      // 快照未重建等未完成部分以警告语气展示，不再用阻塞式弹窗。
      navigateAfterWrite(res.warning
        ? { message: `已冲正；${res.warning}`, tone: 'warn' }
        : { message: '已冲正，并生成 REVERSAL 记录', tone: 'ok' })
    } finally {
      setPending(false)
    }
  }

  if (!confirming) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          title={label}
          onClick={() => {
            setError(null)
            setConfirming(true)
          }}
          className="text-[13px] text-ink-faint transition-colors hover:text-danger"
        >
          冲正
        </button>
        {error && <span role="alert" className="max-w-[220px] text-right text-[12px] text-danger">{error}</span>}
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={pending}
          title="将作废该流水及其联动结算腿，并保留 REVERSAL 标记"
          onClick={confirmReverse}
          className="text-[13px] font-medium text-danger"
        >
          {pending ? '处理中…' : '确认冲正'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-[13px] text-ink-faint">
          取消
        </button>
      </span>
      <span className="max-w-[220px] text-right text-[12px] text-ink-faint">作废原流水与结算腿</span>
      {error && <span role="alert" className="max-w-[220px] text-right text-[12px] text-danger">{error}</span>}
    </span>
  )
}
