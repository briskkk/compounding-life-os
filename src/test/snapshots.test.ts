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
})

describe('历史行情来源', () => {
  it('真实市场标的缺数据时不伪造，非标准资产仍可使用设计内模拟价', () => {
    const priceAt = priceAtFn(new Map())
    expect(priceAt('600519', D('2025-01-10T00:00:00Z'))).toBeUndefined()
    expect(priceAt('RSU-ACME', D('2025-01-10T00:00:00Z'))).toBeGreaterThan(0)
  })
})
