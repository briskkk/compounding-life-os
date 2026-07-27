'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { regenerateInsights } from '@/lib/actions'
import { btnGhostCls } from './fields'

export function RegenerateButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await regenerateInsights()
          router.refresh()
        })
      }
      className={btnGhostCls}
    >
      {pending ? '重算中…' : '重新生成'}
    </button>
  )
}
