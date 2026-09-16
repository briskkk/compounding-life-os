'use client'

// 交易流水排序选择器：写入 URL 的 sort 参数（服务端排序），保留其它筛选与分页参数。
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { TX_SORT_OPTIONS, type TxSort } from '@/lib/engine/tx-sort'
import { cx } from '@/lib/format'

export function TxSortSelect({ value, className }: { value: TxSort; className?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(next: TxSort) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', next)
    // 排序变化后回到第一页，避免停留在旧排序的第 N 页造成「看起来没变」
    params.delete('page')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <select
      aria-label="流水排序"
      value={value}
      onChange={(event) => update(event.target.value as TxSort)}
      className={cx('table-sort-select', className)}
    >
      {TX_SORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
