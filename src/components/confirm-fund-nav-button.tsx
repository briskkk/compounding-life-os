'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmFundOfficialNav } from '@/lib/actions'

export function ConfirmFundNavButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="ml-3 inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          setError(null)
          const result = await confirmFundOfficialNav(id)
          if (!result.ok) setError(result.error)
          router.refresh()
        })}
        className="text-[13px] text-accent transition-colors hover:text-ink disabled:opacity-50"
      >
        {pending ? '核对中…' : '确认净值'}
      </button>
      {error && <span className="max-w-52 whitespace-normal text-left text-[11px] text-up">{error}</span>}
    </span>
  )
}
