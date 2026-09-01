'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmFundSettlement } from '@/lib/actions'

export function ConfirmFundSettlementButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="health-inline-action">
      <button type="button" disabled={pending} onClick={() => startTransition(async () => {
        setError(null)
        const result = await confirmFundSettlement(id)
        if (!result.ok) setError(result.error)
        router.refresh()
      })}>
        {pending ? '确认中…' : '确认到账'}
      </button>
      {error && <small>{error}</small>}
    </span>
  )
}
