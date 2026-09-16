'use client'

// 冲正按钮：二次确认后作废流水及其结算腿
// 冲正失败必须可见（原实现丢弃返回值，用户会重复点击）
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { reverseTransaction } from '@/lib/actions'

export function ReverseButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
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
      // 冲正后原记录会从日常视图消失，快照未更新的警告必须弹窗告知，否则会被随行一起丢掉
      if (res.warning) window.alert(`已冲正，但${res.warning}`)
      // 已知问题：router.refresh() 在客户端偶发不落地（详见审计报告 P0-11），
      // 这里保留框架推荐做法，不以整页跳转掩盖问题。
      router.refresh()
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
