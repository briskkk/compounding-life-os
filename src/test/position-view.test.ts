import { describe, expect, it } from 'vitest'
import { buildPositionItem, toOhlcBars, buildTradeMarks } from '@/lib/engine/position-view'
import type { ValuedPosition } from '@/lib/engine/valuation'
import type { AssetInfo } from '@/lib/engine/types'

const D = (s: string) => new Date(s)

function valuedPosition(overrides: Partial<ValuedPosition> = {}): ValuedPosition {
  const asset: AssetInfo = { id: 'a1', symbol: '600519', name: '贵州茅台', cls: 'STOCK', manual: false, currency: 'CNY' }
  return {
    accountId: 'acc',
    assetId: 'a1',
    quantity: 100,
    vestedQty: 0,
    availableQty: 1,
    unvestedQty: 0,
    costBasis: 150000,
    realizedPnl: 0,
    manualValue: null,
    lastValuationAt: null,
    asset,
    price: 1600,
    priceSource: 'MARKET',
    value: 160000,
    investable: 160000,
    costCny: 150000,
    realizedCny: 0,
    unrealized: 10000,
    unrealizedPct: 10000 / 150000,
    ...overrides,
  }
}

describe('buildPositionItem（持仓项装配）', () => {
  it('有报价时按 quantity × (price − prevClose) 计算当日盈亏', () => {
    const item = buildPositionItem(valuedPosition(), {
      priceCny: 1600,
      prevCloseCny: 1500,
      tradingDate: '2026-08-25',
      source: 'TENCENT',
    }, new Date('2026-08-25T02:00:00Z'))
    expect(item.dayPnl).toBe(10000)
    expect(item.dayPnlPct).toBeCloseTo(10000 / 150000)
    expect(item.avgCost).toBe(1500)
    expect(item.marketValue).toBe(160000)
    expect(item.source).toBe('TENCENT')
    expect(item.confidencePct).toBeNull()
  })

  it('缺昨收时当日盈亏为 0、百分比为 null，来源回落估值来源', () => {
    const item = buildPositionItem(valuedPosition(), undefined, new Date('2026-08-25T02:00:00Z'))
    expect(item.dayPnl).toBe(0)
    expect(item.dayPnlPct).toBeNull()
    expect(item.source).toBe('MARKET')
  })

  it('基金模型估值透传置信度', () => {
    const item = buildPositionItem(valuedPosition(), {
      priceCny: 1.234,
      prevCloseCny: 1.2,
      tradingDate: '2026-08-25',
      source: 'FUND-ENGINE',
      confidencePct: 55,
    }, new Date('2026-08-25T02:00:00Z'))
    expect(item.confidencePct).toBe(55)
  })

  it('不把上一交易日报价计入北京时间今日盈亏', () => {
    const item = buildPositionItem(valuedPosition(), {
      priceCny: 1600,
      prevCloseCny: 1500,
      tradingDate: '2026-08-24',
      source: 'TENCENT',
    }, new Date('2026-08-25T02:00:00Z'))

    expect(item.dayPnl).toBe(0)
    expect(item.dayPnlPct).toBeNull()
  })

  it('零数量时平均成本为 null', () => {
    const item = buildPositionItem(valuedPosition({ quantity: 0, costCny: 0 }), undefined, new Date('2026-08-25T02:00:00Z'))
    expect(item.avgCost).toBeNull()
  })
})

describe('toOhlcBars（K 线装配）', () => {
  it('保留完整 OHLC，缺失字段用 close 补齐', () => {
    expect(
      toOhlcBars([
        { date: D('2026-01-01'), close: 10, open: 9, high: 11, low: 8 },
        { date: D('2026-01-02'), close: 10.5 },
      ]),
    ).toEqual([
      { date: '2026-01-01', open: 9, high: 11, low: 8, close: 10 },
      { date: '2026-01-02', open: 10.5, high: 10.5, low: 10.5, close: 10.5 },
    ])
  })
})

describe('buildTradeMarks（买卖点映射）', () => {
  it('按日期升序并保留 null 数量/单价', () => {
    expect(
      buildTradeMarks([
        { occurredAt: D('2026-02-02'), type: 'SELL', price: 20, quantity: 5 },
        { occurredAt: D('2026-01-01'), type: 'BUY', price: 10, quantity: null },
      ]),
    ).toEqual([
      { date: '2026-01-01', type: 'BUY', price: 10, quantity: null },
      { date: '2026-02-02', type: 'SELL', price: 20, quantity: 5 },
    ])
  })
})
