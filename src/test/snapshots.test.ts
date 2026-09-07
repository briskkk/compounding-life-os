import { describe, expect, it } from 'vitest'
import { computeWealthSeries } from '@/lib/snapshots'
import { priceAtFn } from '@/lib/market/persist'
import type { LedgerTx } from '@/lib/engine/ledger'
import type { AssetInfo } from '@/lib/engine/types'

const DAY = 86400000
const D = (s: string) => new Date(s)

describe('财富快照窗口', () => {
  it('长历史从首笔流水完整保留，不再静默截断', () => {
    const assets: AssetInfo[] = [
      { id: 'cash', symbol: 'CASH-CNY', name: '现金', cls: 'CASH', manual: false, currency: 'CNY' },
    ]
    const txs: LedgerTx[] = [
      { accountId: 'a', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 10000, fee: 0, occurredAt: D('2020-01-01T00:00:00Z'), assetClass: 'CASH' },
      { accountId: 'a', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 5000, fee: 0, occurredAt: D('2025-12-31T00:00:00Z'), assetClass: 'CASH' },
    ]
    const to = D('2025-12-31T00:00:00Z')
    const points = computeWealthSeries(txs, assets, [], D('2020-01-01T00:00:00Z'), to, () => undefined)

    const expectedDays = Math.round((to.getTime() - D('2020-01-01T00:00:00Z').getTime()) / DAY) + 1
    expect(points).toHaveLength(expectedDays)
    expect(points[0].date.getTime()).toBe(D('2020-01-01T00:00:00Z').getTime())
    expect(points[0].contributions).toBe(10000)
    expect(points.at(-1)?.contributions).toBe(15000)
  })

  it('华为股票外部资金流不进入可投资组合累计净投入', () => {
    const assets: AssetInfo[] = [
      { id: 'cash', symbol: 'CASH-CNY', name: '现金', cls: 'CASH', manual: false, currency: 'CNY' },
      { id: 'huawei', symbol: 'HUAWEI-ESOP', name: '华为股票', cls: 'HUAWEI_STOCK', manual: true, currency: 'CNY' },
    ]
    const txs: LedgerTx[] = [
      { accountId: 'a', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 10000, fee: 0, occurredAt: D('2026-01-01T00:00:00Z'), assetClass: 'CASH' },
      { accountId: 'a', assetId: 'huawei', type: 'DEPOSIT', quantity: null, price: null, amount: 50000, fee: 0, occurredAt: D('2026-01-02T00:00:00Z'), assetClass: 'HUAWEI_STOCK' },
    ]

    const points = computeWealthSeries(txs, assets, [], D('2026-01-01T00:00:00Z'), D('2026-01-02T00:00:00Z'), () => undefined)

    expect(points.at(-1)?.contributions).toBe(10000)
  })

  it('份额未知的基金申购以在途资产保持财富守恒', () => {
    const assets: AssetInfo[] = [
      { id: 'fund', symbol: '000001', name: '测试基金', cls: 'FUND', manual: false, currency: 'CNY' },
      { id: 'cash', symbol: 'CASH-CNY', name: '现金', cls: 'CASH', manual: false, currency: 'CNY' },
    ]
    const txs: LedgerTx[] = [
      { id: 'cash-open', accountId: 'cash-account', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 2000, fee: 0, occurredAt: D('2026-01-01T00:00:00Z'), assetClass: 'CASH' },
      { id: 'pending-buy', accountId: 'fund-account', assetId: 'fund', type: 'BUY', quantity: null, price: null, amount: 1000, fee: 2, occurredAt: D('2026-01-02T00:00:00Z'), navDate: D('2026-01-02T00:00:00Z'), navSource: 'PENDING', assetClass: 'FUND' },
      { id: 'cash-leg', settleOfId: 'pending-buy', accountId: 'cash-account', assetId: 'cash', type: 'WITHDRAW', quantity: null, price: null, amount: 1002, fee: 0, occurredAt: D('2026-01-02T00:00:00Z'), assetClass: 'CASH', internal: true },
    ]

    const points = computeWealthSeries(txs, assets, [], D('2026-01-01T00:00:00Z'), D('2026-01-02T00:00:00Z'), () => undefined)

    expect(points.map((point) => point.investable)).toEqual([2000, 1998])
    expect(points.at(-1)?.contributions).toBe(2000)
  })

  it('可交易黄金无买入结算腿时记外部投入，卖出有结算腿时保持组合内守恒', () => {
    const assets: AssetInfo[] = [
      { id: 'gold', symbol: 'AU999', name: '可交易黄金', cls: 'GOLD', manual: true, currency: 'CNY' },
      { id: 'cash', symbol: 'CASH-CNY', name: '人民币现金', cls: 'CASH', manual: false, currency: 'CNY' },
    ]
    const txs: LedgerTx[] = [
      { id: 'gold-buy', accountId: 'gold-account', assetId: 'gold', type: 'BUY', quantity: 10, price: 100, amount: 1000, fee: 0, occurredAt: D('2026-08-01T00:00:00Z'), assetClass: 'GOLD' },
      { id: 'gold-sell', accountId: 'gold-account', assetId: 'gold', type: 'SELL', quantity: 2, price: 100, amount: 200, fee: 0, occurredAt: D('2026-08-02T00:00:00Z'), assetClass: 'GOLD' },
      { id: 'cash-leg', settleOfId: 'gold-sell', accountId: 'cash-account', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 200, fee: 0, occurredAt: D('2026-08-02T00:00:00Z'), assetClass: 'CASH', internal: true },
    ]

    const points = computeWealthSeries(
      txs,
      assets,
      [],
      D('2026-08-01T00:00:00Z'),
      D('2026-08-02T00:00:00Z'),
      () => undefined,
    )

    expect(points.map((point) => point.investable)).toEqual([1000, 1000])
    expect(points.map((point) => point.contributions)).toEqual([1000, 1000])
  })

  it('区分休市沿用价格与交易日新估值', () => {
    const assets: AssetInfo[] = [
      { id: 'etf', symbol: '510300', name: '沪深300ETF', cls: 'ETF', manual: false, currency: 'CNY' },
    ]
    const txs: LedgerTx[] = [
      { accountId: 'a', assetId: 'etf', type: 'BUY', quantity: 10, price: 10, amount: 100, fee: 0, occurredAt: D('2026-07-31T00:00:00Z'), assetClass: 'ETF' },
    ]
    const priceAt = (_symbol: string, date: Date) => date >= D('2026-08-03T00:00:00Z') ? 11 : 10
    const observationAt = (_symbol: string, date: Date) => ({
      close: priceAt(_symbol, date),
      valuationDate: date >= D('2026-08-03T00:00:00Z') ? '2026-08-03' : '2026-07-31',
      source: 'TEST',
    })

    const points = computeWealthSeries(
      txs,
      assets,
      [],
      D('2026-07-31T00:00:00Z'),
      D('2026-08-03T00:00:00Z'),
      priceAt,
      () => 1,
      observationAt,
    )

    expect(points.map((point) => point.valuationStatus)).toEqual(['SETTLED', 'CLOSED', 'CLOSED', 'SETTLED'])
    expect(points[1].valuationCoverage).toBe(0)
    expect(points[3].valuationCoverage).toBe(1)
  })

  it('部分标的净值滞后时记录覆盖率与待更新明细', () => {
    const assets: AssetInfo[] = [
      { id: 'cn', symbol: '510300', name: '国内ETF', cls: 'ETF', manual: false, currency: 'CNY' },
      { id: 'qdii', symbol: '040046', name: 'QDII基金', cls: 'FUND', manual: false, currency: 'CNY' },
    ]
    const txs: LedgerTx[] = assets.map((asset) => ({
      accountId: 'a',
      assetId: asset.id,
      type: 'BUY' as const,
      quantity: 10,
      price: 10,
      amount: 100,
      fee: 0,
      occurredAt: D('2026-08-04T00:00:00Z'),
      assetClass: asset.cls,
    }))
    const observationAt = (symbol: string) => ({
      close: 10,
      valuationDate: symbol === '510300' ? '2026-08-04' : '2026-08-03',
      source: 'TEST',
    })

    const [point] = computeWealthSeries(
      txs,
      assets,
      [],
      D('2026-08-04T00:00:00Z'),
      D('2026-08-04T00:00:00Z'),
      () => 10,
      () => 1,
      observationAt,
    )

    expect(point.valuationStatus).toBe('PARTIAL')
    expect(point.valuationCoverage).toBe(0.5)
    expect(JSON.parse(point.valuationDetails)).toEqual([
      expect.objectContaining({ symbol: '040046', valuationDate: '2026-08-03' }),
    ])
  })
})

describe('历史行情来源', () => {
  const saved = process.env.MARKET_PROVIDER
  const restore = () => {
    if (saved === undefined) delete process.env.MARKET_PROVIDER
    else process.env.MARKET_PROVIDER = saved
  }

  it('真实链（含默认未配置）下任何标的缺数据都不伪造：真实标的与非标资产一律缺省', () => {
    delete process.env.MARKET_PROVIDER
    try {
      const priceAt = priceAtFn(new Map())
      expect(priceAt('600519', D('2025-01-10T00:00:00Z'))).toBeUndefined()
      expect(priceAt('AU9999', D('2025-01-10T00:00:00Z'))).toBeUndefined()
    } finally {
      restore()
    }
  })

  it('显式模拟模式下，非标资产允许使用设计内模拟价', () => {
    process.env.MARKET_PROVIDER = 'simulated'
    try {
      const priceAt = priceAtFn(new Map())
      expect(priceAt('AU9999', D('2025-01-10T00:00:00Z'))).toBeGreaterThan(0)
      // 真实市场标的即使在模拟模式下也只给模拟源链自己的报价，与 priceAt 口径无关
      expect(priceAt('600519', D('2025-01-10T00:00:00Z'))).toBeUndefined()
    } finally {
      restore()
    }
  })
})
