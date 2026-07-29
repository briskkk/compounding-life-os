export type HoldingSort = 'value-desc' | 'value-asc' | 'dayPnl-desc' | 'dayPnl-asc' | 'name-asc'

export interface SortableHolding {
  name: string
  valueCny: number
  dayPnlCny: number | null
}

export const DEFAULT_HOLDING_SORT: HoldingSort = 'value-desc'

export function parseHoldingSort(value: string | undefined): HoldingSort {
  return value === 'value-asc'
    || value === 'dayPnl-desc'
    || value === 'dayPnl-asc'
    || value === 'name-asc'
    ? value
    : DEFAULT_HOLDING_SORT
}

/** 无当日数据的资产始终排在有数据资产之后。 */
export function sortHoldings<T extends SortableHolding>(rows: T[], sort: HoldingSort): T[] {
  return [...rows].sort((a, b) => {
    if (sort.startsWith('dayPnl')) {
      if (a.dayPnlCny == null && b.dayPnlCny == null) return a.name.localeCompare(b.name, 'zh-CN')
      if (a.dayPnlCny == null) return 1
      if (b.dayPnlCny == null) return -1
      const delta = sort === 'dayPnl-asc' ? a.dayPnlCny - b.dayPnlCny : b.dayPnlCny - a.dayPnlCny
      return delta || b.valueCny - a.valueCny || a.name.localeCompare(b.name, 'zh-CN')
    }
    if (sort === 'name-asc') return a.name.localeCompare(b.name, 'zh-CN')
    const delta = sort === 'value-asc' ? a.valueCny - b.valueCny : b.valueCny - a.valueCny
    return delta || a.name.localeCompare(b.name, 'zh-CN')
  })
}
