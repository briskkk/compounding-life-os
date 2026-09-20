'use client'

// 持仓明细表列头排序：与看盘共用同一套列头按钮与 aria-sort 语义。
// 持仓页按 URL 参数在服务端排序，所以这里用 router.replace（保留分组/大类筛选、回到第一页）。
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SortHeader } from './sort-header'
import { DEFAULT_HOLDING_SORT, toggleHoldingSort, type HoldingSort, type HoldingSortKey } from '@/lib/engine/holding-sort'

export function PositionSortHeader({ label, sortKey, sort, className }: {
  label: string
  sortKey: HoldingSortKey
  sort: HoldingSort
  className?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(next: HoldingSort) {
    const params = new URLSearchParams(searchParams.toString())
    // 默认排序不写进 URL，保持链接干净（与看盘一致）
    if (next === DEFAULT_HOLDING_SORT) params.delete('sort')
    else params.set('sort', next)
    // 排序变化后回到第一页，避免停留在旧排序的第 N 页造成「看起来没变」
    params.delete('page')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <SortHeader
      label={label}
      sortKey={sortKey}
      sort={sort}
      className={className}
      onClick={() => update(toggleHoldingSort(sort, sortKey))}
    />
  )
}
