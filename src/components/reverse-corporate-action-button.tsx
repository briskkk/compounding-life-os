'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reverseCorporateAction } from '@/lib/actions'

export function ReverseCorporateActionButton({ id }: { id: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  if (!confirming) return <button type="button" onClick={() => setConfirming(true)} className="text-[13px] text-ink-faint hover:text-up">冲正事件</button>
  return <span className="flex items-center justify-end gap-2"><button type="button" disabled={pending} onClick={() => startTransition(async () => { await reverseCorporateAction(id); router.refresh() })} className="text-[13px] font-medium text-up">{pending ? '处理中…' : '确认冲正'}</button><button type="button" onClick={() => setConfirming(false)} className="text-[13px] text-ink-faint">取消</button></span>
}
