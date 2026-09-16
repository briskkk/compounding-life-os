// 交易流水表排序：URL 参数驱动（服务端排序），与持仓表的 holding-sort 同一模式。
//
// 只提供按日期的排序：流水金额是**原币**（多币种混排会让「金额排序」产生误导），
// 因此不提供金额排序，避免给出看似合理其实错误的顺序。
export type TxSort = 'date-desc' | 'date-asc' | 'navDate-desc' | 'navDate-asc'

export const DEFAULT_TX_SORT: TxSort = 'date-desc'

export const TX_SORT_OPTIONS: Array<{ value: TxSort; label: string }> = [
  { value: 'date-desc', label: '日期 ↓' },
  { value: 'date-asc', label: '日期 ↑' },
  { value: 'navDate-desc', label: '净值日 ↓' },
  { value: 'navDate-asc', label: '净值日 ↑' },
]

export function parseTxSort(value: string | undefined): TxSort {
  return value === 'date-asc' || value === 'navDate-desc' || value === 'navDate-asc' ? value : DEFAULT_TX_SORT
}

/** 表头 aria-sort：把当前排序映射成 ARIA 语义 */
export function txAriaSort(current: TxSort, target: 'date' | 'navDate'): 'ascending' | 'descending' | 'other' {
  if (target === 'date') {
    if (current === 'date-asc') return 'ascending'
    if (current === 'date-desc') return 'descending'
    return 'other'
  }
  if (current === 'navDate-asc') return 'ascending'
  if (current === 'navDate-desc') return 'descending'
  return 'other'
}
