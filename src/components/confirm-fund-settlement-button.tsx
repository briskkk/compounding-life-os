'use client'

import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState, useTransition } from 'react'
import { confirmFundSettlement } from '@/lib/actions'

export function ConfirmFundSettlementButton({ id }: { id: string }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="health-inline-action">
      <button type="button" disabled={pending} onClick={() => startTransition(async () => {
        setError(null)
        const result = await confirmFundSettlement(id)
        if (!result.ok) {
          setError(result.error)
          return
        }
        navigateAfterWrite({ message: '已确认赎回到账，审计链已留痕' })
      })}>
        {pending ? '确认中…' : '确认到账'}
      </button>
      {error && <small>{error}</small>}
    </span>
  )
}
