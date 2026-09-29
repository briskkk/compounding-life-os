'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function PerformanceScopePicker({ options, value }: { options: { key: string; label: string }[]; value: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  return (
    <label className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-[13px] text-ink-dim">
      收益范围
      <select value={value} onChange={(event) => {
        const next = new URLSearchParams(search.toString())
        if (event.target.value === 'all') next.delete('scope')
        else next.set('scope', event.target.value)
        router.push(`${pathname}?${next.toString()}`)
      }} className="min-w-[180px] rounded border border-line bg-panel2 px-3 py-2 text-ink" aria-label="选择收益范围">
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <span className="text-ink-faint">按当前分类重算所选资产的历史收益；改动分组会追溯改变此视图。</span>
    </label>
  )
}
