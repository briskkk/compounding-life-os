'use client'

// 表格列头排序按钮：看盘实时估值表与持仓明细共用。
// 排序控件必须长在它真正作用的列上，并且如实标注 aria-sort——
// 两页此前都把排序下拉塞进「资产」列头、把 aria-sort 写死成 other（审计 P1-14）。
import { cx } from '@/lib/format'
import { holdingAriaSort, holdingSortTitle, type HoldingSort, type HoldingSortKey } from '@/lib/engine/holding-sort'

/** 列头用的 aria-sort：按列取值，未参与排序的列是 none。 */
export function sortAria(sort: HoldingSort, key: HoldingSortKey): 'ascending' | 'descending' | 'none' {
  return holdingAriaSort(sort, key)
}

/**
 * 列头排序按钮：可见文字是无障碍名的一部分（「市值（¥) ↕」→「按市值（¥）排序」），
 * 因此列头 <th> 与按钮拿到同一个名字，测试与读屏都能用一个名字定位。
 */
export function SortHeader({ label, sortKey, sort, className, onClick }: {
  label: string
  sortKey: HoldingSortKey
  sort: HoldingSort
  className?: string
  onClick: () => void
}) {
  const active = holdingAriaSort(sort, sortKey) !== 'none'
  const descending = holdingAriaSort(sort, sortKey) === 'descending'
  const arrow = !active ? '↕' : descending ? '↓' : '↑'
  const title = holdingSortTitle(sort, sortKey)
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cx('table-sort-header', className, active && 'is-active')}
    >
      {label}
      <span aria-hidden="true" className="text-[12px]">{arrow}</span>
    </button>
  )
}
