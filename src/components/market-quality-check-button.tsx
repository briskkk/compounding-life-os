'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { runMarketQualityCheck } from '@/lib/actions'
import { cx } from '@/lib/format'

export function MarketQualityCheckButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setMessage(null)
    const result = await runMarketQualityCheck()
    setPending(false)
    if (result.ok) {
      const data = result.data!
      setMessage(`已检查 ${data.checked} 项 · ${data.divergent} 项价差需关注 · ${data.failed} 项全源失败`)
      router.refresh()
    } else {
      setMessage(result.error)
    }
  }

  return (
    <div className="flex items-center gap-4">
      {message && <span className="max-w-[360px] text-right text-[12px] leading-5 text-ink-faint">{message}</span>}
      <button type="button" onClick={run} disabled={pending} className={cx('min-h-11 rounded-lg border border-accent/50 px-5 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50')}>
        {pending ? '逐源核验中…' : '检查当前持仓'}
      </button>
    </div>
  )
}
