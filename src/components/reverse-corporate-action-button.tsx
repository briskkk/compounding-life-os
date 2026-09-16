'use client'

import { useState, useTransition } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { reverseCorporateAction } from '@/lib/actions'

export function ReverseCorporateActionButton({ id }: { id: string }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  if (!confirming) return <button type="button" onClick={() => setConfirming(true)} className="text-[13px] text-ink-faint hover:text-up">冲正事件</button>
  return <span className="flex items-center justify-end gap-2"><button type="button" disabled={pending} onClick={() => startTransition(async () => { const res = await reverseCorporateAction(id); if (!res.ok) { window.alert(res.error); return } navigateAfterWrite({ message: '公司行动已整体冲正' }) })} className="text-[13px] font-medium text-up">{pending ? '处理中…' : '确认冲正'}</button><button type="button" onClick={() => setConfirming(false)} className="text-[13px] text-ink-faint">取消</button></span>
}
