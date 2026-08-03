'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { HoldingSort } from '@/lib/engine/holding-sort'
import { cx } from '@/lib/format'

const SORT_OPTIONS: { value: HoldingSort; label: string }[] = [
  { value: 'value-desc', label: '市值 ↓' },
  { value: 'value-asc', label: '市值 ↑' },
  { value: 'dayPnl-desc', label: '当日盈亏 ↓' },
  { value: 'dayPnl-asc', label: '当日盈亏 ↑' },
  { value: 'name-asc', label: '名称 A–Z' },
]

export function HoldingSortSelect({
  value,
  ariaLabel,
  navigate = false,
  onChange,
  className,
}: {
  value: HoldingSort
  ariaLabel: string
  navigate?: boolean
  onChange?: (value: HoldingSort) => void
  className?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  function updateSort(next: HoldingSort) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', next)
    const href = `${pathname}?${params.toString()}`

    window.localStorage.setItem('portfolio:asset-sort', next)
    if (navigate) {
      router.replace(href, { scroll: false })
      onChange?.(next)
      return
    }
    onChange?.(next)
    window.history.replaceState(window.history.state, '', href)
  }

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => updateSort(event.target.value as HoldingSort)}
      className={cx('table-sort-select', className)}
    >
      {SORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
