'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { revokeInvestmentPlanNoBuyReview } from '@/lib/actions'

export function RevokeInvestmentPlanNoBuyButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function revoke() {
    setPending(true)
    setError(null)
    const result = await revokeInvestmentPlanNoBuyReview(id)
    setPending(false)
    if (result.ok) router.refresh()
    else setError(result.error)
  }

  return <span className="investment-plan-no-buy-control">
    <button type="button" disabled={pending} onClick={revoke}>{pending ? '撤销中…' : '撤销未买确认'}</button>
    {error && <span role="alert">{error}</span>}
  </span>
}
