import { describe, expect, it } from 'vitest'
import { groupByTag, parseTags, serializeTags, UNTAGGED } from '@/lib/engine/groups'
import type { ValuedPosition } from '@/lib/engine/valuation'
import type { AssetInfo } from '@/lib/engine/types'

function vp(assetId: string, overrides: Partial<ValuedPosition> = {}): ValuedPosition {
  const asset: AssetInfo = { id: assetId, symbol: assetId, name: assetId, cls: 'ETF', manual: false, currency: 'CNY' }
  return {
    accountId: 'a',
    assetId,
    quantity: 1,
    vestedQty: 0,
    unvestedQty: 0,
    costBasis: 100,
    realizedPnl: 0,
    manualValue: null,
    lastValuationAt: null,
    asset,
    price: 100,
    priceSource: 'MARKET',
    value: 100,
    investable: 100,
    costCny: 100,
    realizedCny: 0,
    unrealized: 0,
    unrealizedPct: 0,
    ...overrides,
  }
}

describe('自定义分组', () => {
  it('parseTags / serializeTags 规范化', () => {
    expect(parseTags(' 美元基金, 长期 ,,美元基金,')).toEqual(['美元基金', '长期'])
    expect(parseTags('')).toEqual([])
    expect(parseTags(null)).toEqual([])
    expect(serializeTags(['美元基金', '美元基金', ' 长期 '])).toBe('美元基金,长期')
  })

  it('按标签聚合盈亏；无标签归入未分组；多标签分别计入', () => {
    const valued = [
      vp('A', { value: 1000, costCny: 900, unrealized: 100 }),
      vp('B', { value: 500, costCny: 600, unrealized: -100 }),
      vp('C', { value: 200, costCny: 200, unrealized: 0 }),
    ]
    const tags = new Map([
      ['A', ['美元基金']],
      ['B', ['美元基金', '定投']],
      // C 无标签
    ])
    const groups = groupByTag(valued, tags)
    const usd = groups.find((g) => g.tag === '美元基金')!
    expect(usd.value).toBe(1500)
    expect(usd.costCny).toBe(1500)
    expect(usd.unrealized).toBe(0)
    expect(usd.count).toBe(2)
    const dip = groups.find((g) => g.tag === '定投')!
    expect(dip.value).toBe(500)
    const untagged = groups.find((g) => g.tag === UNTAGGED)!
    expect(untagged.value).toBe(200)
    expect(groups[0].value).toBeGreaterThanOrEqual(groups[groups.length - 1].value) // 按市值降序
  })

  it('unrealizedPct = 组内未实现 / 组内成本', () => {
    const valued = [vp('A', { value: 1100, costCny: 1000, unrealized: 100 })]
    const g = groupByTag(valued, new Map([['A', ['核心']]]))[0]
    expect(g.unrealizedPct).toBeCloseTo(0.1)
  })
})
