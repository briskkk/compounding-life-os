import { describe, expect, it } from 'vitest'
import { computeWealthSeries } from '@/lib/snapshots'
import { priceAtFn } from '@/lib/market/persist'
import type { LedgerTx } from '@/lib/engine/ledger'
import type { AssetInfo } from '@/lib/engine/types'

const DAY = 86400000
const D = (s: string) => new Date(s)

describe('财富快照窗口', () => {
  it('长历史保留最近 1400 天，并带入窗口前累计净投入', () => {
    const assets: AssetInfo[] = [
      { id: 'cash', symbol: 'CASH-CNY', name: '现金', cls: 'CASH', manual: false, currency: 'CNY' },
    ]
    const txs: LedgerTx[] = [
      { accountId: 'a', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 10000, fee: 0, occurredAt: D('2020-01-01T00:00:00Z'), assetClass: 'CASH' },
      { accountId: 'a', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 5000, fee: 0, occurredAt: D('2025-12-31T00:00:00Z'), assetClass: 'CASH' },
    ]
    const to = D('2025-12-31T00:00:00Z')
    const points = computeWealthSeries(txs, assets, [], D('2020-01-01T00:00:00Z'), to, () => undefined)

    expect(points).toHaveLength(1400)
    expect(points[0].date.getTime()).toBe(to.getTime() - 1399 * DAY)
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
