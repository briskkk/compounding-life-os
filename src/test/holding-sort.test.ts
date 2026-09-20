import { describe, expect, it } from 'vitest'
import {
  holdingAriaSort,
  holdingSortKey,
  holdingSortTitle,
  parseHoldingSort,
  sortHoldings,
  toggleHoldingSort,
} from '@/lib/engine/holding-sort'

const rows = [
  { name: 'A', valueCny: 100, dayPnlCny: -3, changePct: -0.01, unrealizedPnlCny: 20, weight: 0.1 },
  { name: 'B', valueCny: 300, dayPnlCny: 8, changePct: 0.02, unrealizedPnlCny: -50, weight: 0.3 },
  { name: 'C', valueCny: 200, dayPnlCny: null, changePct: null, unrealizedPnlCny: null, weight: 0.2 },
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

  it('支持涨跌幅升降序，缺失值同样放在末尾', () => {
    expect(sortHoldings(rows, 'changePct-desc').map((row) => row.name)).toEqual(['B', 'A', 'C'])
    expect(sortHoldings(rows, 'changePct-asc').map((row) => row.name)).toEqual(['A', 'B', 'C'])
  })

  it('主键相等时按名称兜底，避免轮询改价时行序抖动', () => {
    const flat = [
      { name: '乙', valueCny: 500, dayPnlCny: 1, changePct: 0.01 },
      { name: '甲', valueCny: 500, dayPnlCny: 1, changePct: 0.01 },
    ]
    const first = sortHoldings(flat, 'value-desc').map((row) => row.name)
    const second = sortHoldings([...flat].reverse(), 'value-desc').map((row) => row.name)
    expect(first).toEqual(second)
    expect(sortHoldings(flat, 'dayPnl-desc').map((row) => row.name)).toEqual(
      sortHoldings([...flat].reverse(), 'dayPnl-desc').map((row) => row.name),
    )
  })

  it('支持未实现盈亏与权重排序（持仓页列头）', () => {
    // 未实现盈亏：B 亏 50、A 赚 20、C 无数据沉底
    expect(sortHoldings(rows, 'unrealizedPnl-desc').map((row) => row.name)).toEqual(['A', 'B', 'C'])
    expect(sortHoldings(rows, 'unrealizedPnl-asc').map((row) => row.name)).toEqual(['B', 'A', 'C'])
    // 权重与市值同序（同一分母）
    expect(sortHoldings(rows, 'weight-desc').map((row) => row.name)).toEqual(['B', 'C', 'A'])
    expect(sortHoldings(rows, 'weight-asc').map((row) => row.name)).toEqual(['A', 'C', 'B'])
  })

  it('未知排序值回落到市值降序', () => {
    expect(parseHoldingSort('unexpected')).toBe('value-desc')
    expect(parseHoldingSort(undefined)).toBe('value-desc')
  })

  it('接受新增的涨跌幅、未实现盈亏与名称排序参数', () => {
    expect(parseHoldingSort('changePct-desc')).toBe('changePct-desc')
    expect(parseHoldingSort('changePct-asc')).toBe('changePct-asc')
    expect(parseHoldingSort('unrealizedPnl-desc')).toBe('unrealizedPnl-desc')
    expect(parseHoldingSort('weight-asc')).toBe('weight-asc')
    expect(parseHoldingSort('name-asc')).toBe('name-asc')
  })
})

describe('列头排序交互', () => {
  it('点击同一列在升降序之间切换，点击其它列从降序开始', () => {
    expect(toggleHoldingSort('value-desc', 'value')).toBe('value-asc')
    expect(toggleHoldingSort('value-asc', 'value')).toBe('value-desc')
    expect(toggleHoldingSort('value-desc', 'dayPnl')).toBe('dayPnl-desc')
    expect(toggleHoldingSort('dayPnl-asc', 'changePct')).toBe('changePct-desc')
    expect(toggleHoldingSort('value-desc', 'name')).toBe('name-asc')
    expect(toggleHoldingSort('name-asc', 'name')).toBe('name-asc')
  })

  it('排序键映射与 aria-sort 只标注当前排序列', () => {
    expect(holdingSortKey('value-asc')).toBe('value')
    expect(holdingSortKey('changePct-desc')).toBe('changePct')
    expect(holdingSortKey('name-asc')).toBe('name')

    expect(holdingAriaSort('dayPnl-desc', 'dayPnl')).toBe('descending')
    expect(holdingAriaSort('dayPnl-asc', 'dayPnl')).toBe('ascending')
    expect(holdingAriaSort('dayPnl-asc', 'value')).toBe('none')
    expect(holdingAriaSort('value-desc', 'changePct')).toBe('none')
    expect(holdingAriaSort('name-asc', 'name')).toBe('ascending')
    expect(holdingAriaSort('value-desc', 'name')).toBe('none')
  })

  it('列头文案描述当前状态，并带单位', () => {
    // 当前排序列：说清现在的方向（点下去即切换）
    expect(holdingSortTitle('value-desc', 'value')).toBe('按市值（¥）降序排序')
    expect(holdingSortTitle('value-asc', 'value')).toBe('按市值（¥）升序排序')
    expect(holdingSortTitle('dayPnl-desc', 'dayPnl')).toBe('按当日盈亏（¥）降序排序')
    // 非当前排序列：只说依据
    expect(holdingSortTitle('value-desc', 'dayPnl')).toBe('按当日盈亏（¥）排序')
    expect(holdingSortTitle('value-desc', 'changePct')).toBe('按涨跌幅排序')
    // 名称列只有升序一档，不随状态变化；用「名称」而不是列头「资产」
    expect(holdingSortTitle('value-desc', 'name')).toBe('按名称排序')
    expect(holdingSortTitle('name-asc', 'name')).toBe('按名称排序')
  })
})
