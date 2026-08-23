import { describe, expect, it } from 'vitest'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import type { ValuedPosition } from '@/lib/engine/valuation'
import type { AssetInfo } from '@/lib/engine/types'

function vp(accountId: string, overrides: Partial<ValuedPosition> = {}): ValuedPosition {
  const asset: AssetInfo = { id: 'A1', symbol: 'X', name: 'X', cls: 'STOCK', manual: false, currency: 'CNY' }
  return {
    accountId,
    assetId: 'A1',
    quantity: 100,
    vestedQty: 0,
    availableQty: 1,
    unvestedQty: 0,
    costBasis: 1000,
    realizedPnl: 0,
    manualValue: null,
    lastValuationAt: null,
    asset,
    price: 12,
    priceSource: 'MARKET',
    value: 1200,
    investable: 1200,
    costCny: 1000,
    realizedCny: 0,
    unrealized: 200,
    unrealizedPct: 0.2,
    ...overrides,
  }
}

describe('跨账户持仓合并', () => {
  it('同资产多账户求和，单价取资产级', () => {
    const merged = mergePositionsByAsset([vp('acc1'), vp('acc2', { quantity: 50, costBasis: 500, costCny: 500, value: 600, investable: 600, unrealized: 100 })])
    expect(merged).toHaveLength(1)
    const m = merged[0]
    expect(m.quantity).toBe(150)
    expect(m.costCny).toBe(1500)
    expect(m.value).toBe(1800)
    expect(m.unrealized).toBe(300)
    expect(m.unrealizedPct).toBeCloseTo(0.2, 6)
    expect(m.price).toBe(12)
  })

  it('不同资产不合并', () => {
    const a = vp('acc1')
    const b = { ...vp('acc1'), assetId: 'B1', asset: { ...vp('acc1').asset, id: 'B1' } }
    expect(mergePositionsByAsset([a, b])).toHaveLength(2)
  })

  it('现金合并且未实现盈亏恒为 0', () => {
    const cashA = vp('acc1', { asset: { id: 'C1', symbol: 'CASH-USD', name: '美元', cls: 'CASH', manual: false, currency: 'USD' }, assetId: 'C1', unrealized: -500, unrealizedPct: null })
    const cashB = { ...cashA, accountId: 'acc2' }
    const [m] = mergePositionsByAsset([cashA, cashB])
    expect(m.unrealized).toBe(0)
    expect(m.unrealizedPct).toBeNull()
  })

  it('手动估值求和、估值日取最新', () => {
    const a = vp('acc1', { manualValue: 100, lastValuationAt: new Date('2026-01-01') })
    const b = vp('acc2', { manualValue: 200, lastValuationAt: new Date('2026-06-01') })
    const [m] = mergePositionsByAsset([a, b])
    expect(m.manualValue).toBe(300)
    expect(m.lastValuationAt).toEqual(new Date('2026-06-01'))
  })
})
