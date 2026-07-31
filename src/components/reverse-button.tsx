'use client'

// 冲正按钮：二次确认后作废流水及其结算腿
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { reverseTransaction } from '@/lib/actions'

export function ReverseButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  if (!confirming) {
    return (
      <button
        type="button"
        title={label}
        onClick={() => setConfirming(true)}
        className="text-[13px] text-ink-faint transition-colors hover:text-up"
      >
        冲正
      </button>
    )
  }
  return (
    <span className="flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await reverseTransaction(id)
            router.refresh()
          })
        }
        className="text-[13px] font-medium text-up"
      >
        {pending ? '处理中…' : '确认冲正'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-[13px] text-ink-faint">
        取消
      </button>
    </span>
  )
}
