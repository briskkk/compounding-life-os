import { describe, expect, it } from 'vitest'
import { parseHoldingSort, sortHoldings } from '@/lib/engine/holding-sort'

const rows = [
  { name: 'A', valueCny: 100, dayPnlCny: -3 },
  { name: 'B', valueCny: 300, dayPnlCny: 8 },
  { name: 'C', valueCny: 200, dayPnlCny: null },
]

describe('持仓排序', () => {
  it('支持市值升降序', () => {
    expect(sortHoldings(rows, 'value-desc').map((row) => row.name)).toEqual(['B', 'C', 'A'])
    expect(sortHoldings(rows, 'value-asc').map((row) => row.name)).toEqual(['A', 'C', 'B'])
  })

  it('按当日盈亏排序时将缺失值放在末尾', () => {
    expect(sortHoldings(rows, 'dayPnl-desc').map((row) => row.name)).toEqual(['B', 'A', 'C'])
    expect(sortHoldings(rows, 'dayPnl-asc').map((row) => row.name)).toEqual(['A', 'B', 'C'])
  })

  it('未知排序值回落到市值降序', () => {
    expect(parseHoldingSort('unexpected')).toBe('value-desc')
  })
})
