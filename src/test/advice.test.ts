import { describe, expect, it } from 'vitest'
import { assetAdvice } from '@/lib/engine/advice'
import type { ValuedPosition } from '@/lib/engine/valuation'
import type { AssetInfo } from '@/lib/engine/types'

function vp(overrides: Partial<Omit<ValuedPosition, 'asset'>> & { asset?: Partial<AssetInfo> } = {}): ValuedPosition {
  const { asset: a, ...rest } = overrides
  const asset: AssetInfo = { id: 'x', symbol: 'X', name: 'X', cls: 'STOCK', manual: false, currency: 'CNY', ...a }
  return {
    accountId: 'acc',
    assetId: asset.id,
    quantity: 100,
    vestedQty: 0,
    unvestedQty: 0,
    costBasis: 1000,
    realizedPnl: 0,
    manualValue: null,
    lastValuationAt: null,
    asset,
    price: 10,
    priceSource: 'MARKET',
    value: 1000,
    investable: 1000,
    costCny: 1000,
    realizedCny: 0,
    unrealized: 0,
    unrealizedPct: 0,
    ...rest,
  }
}

describe('单资产投资建议', () => {
  it('集中度超阈值 → 再平衡建议', () => {
    const out = assetAdvice(vp({ value: 3000 }), 10000, { concentrationCeiling: 0.25 })
    expect(out[0].severity).toBe('WARN')
    expect(out[0].text).toContain('集中度')
  })

  it('浮亏超 20% → 复核提示；浮盈超 50% → 止盈提示', () => {
    const loss = assetAdvice(vp({ value: 700, costCny: 1000, unrealized: -300, unrealizedPct: -0.3 }), 100000)
    expect(loss.some((a) => a.text.includes('−30.0%') || a.text.includes('-30.0%') || a.text.includes('浮亏'))).toBe(true)
    const gain = assetAdvice(vp({ value: 1600, costCny: 1000, unrealized: 600, unrealizedPct: 0.6 }), 100000)
    expect(gain.some((a) => a.text.includes('止盈'))).toBe(true)
  })

  it('RSU 未归属提示', () => {
    const out = assetAdvice(vp({ asset: { cls: 'RSU' }, unvestedQty: 500 }), 100000)
    expect(out.some((a) => a.text.includes('未归属'))).toBe(true)
  })

  it('手动估值超 90 天 → 更新提醒', () => {
    const old = new Date(Date.now() - 120 * 86400000)
    const out = assetAdvice(vp({ asset: { cls: 'REAL_ESTATE', manual: true }, lastValuationAt: old, priceSource: 'MANUAL' }), 100000)
    expect(out.some((a) => a.text.includes('90 天'))).toBe(true)
  })

  it('行情缺失（显示成本价）→ 检查代码规范提示', () => {
    const out = assetAdvice(vp({ priceSource: 'COST' }), 100000)
    expect(out.some((a) => a.text.includes('实时行情'))).toBe(true)
  })

  it('外币资产 → 汇率口径提示；一切正常 → 持有纪律', () => {
    const usd = assetAdvice(vp({ asset: { currency: 'USD' } }), 100000)
    expect(usd.some((a) => a.text.includes('USD'))).toBe(true)
    const ok = assetAdvice(vp(), 100000)
    expect(ok).toHaveLength(1)
    expect(ok[0].severity).toBe('INFO')
  })
})
