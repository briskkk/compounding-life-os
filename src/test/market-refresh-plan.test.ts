import { describe, expect, it } from 'vitest'
import type { AssetInfo } from '@/lib/engine/types'
import type { LedgerTx } from '@/lib/engine/ledger'
import { activeAssetIdsFromLedger, buildMarketRefreshPlan, refreshSlotOf } from '@/lib/market/refresh-plan'

const assets: AssetInfo[] = [
  { id: 'cn', symbol: '510300', name: '沪深300ETF', cls: 'ETF', manual: false, currency: 'CNY' },
  { id: 'us', symbol: 'USQQQ', name: '纳指ETF', cls: 'ETF', manual: false, currency: 'USD' },
  { id: 'fund', symbol: '110022', name: '境内基金', cls: 'FUND', manual: false, currency: 'CNY' },
  { id: 'qdii', symbol: '040046', name: '海外成长QDII', cls: 'FUND', manual: false, currency: 'CNY' },
  { id: 'closed', symbol: '159915', name: '已清仓ETF', cls: 'ETF', manual: false, currency: 'CNY' },
  { id: 'manual', symbol: 'HUAWEI-ESOP', name: '内部持股', cls: 'HUAWEI_STOCK', manual: true, currency: 'CNY' },
]

function tx(assetId: string, type: LedgerTx['type'], quantity: number, voidedAt: Date | null = null): LedgerTx {
  return {
    accountId: 'account',
    assetId,
    type,
    quantity,
    price: 1,
    amount: quantity,
    fee: 0,
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    assetClass: assets.find((asset) => asset.id === assetId)?.cls ?? 'ETF',
    voidedAt,
  }
}

describe('行情刷新计划', () => {
  it('由账本重放识别当前持仓，不把已清仓或已冲正流水纳入', () => {
    const active = activeAssetIdsFromLedger([
      tx('cn', 'BUY', 10),
      tx('closed', 'BUY', 8),
      tx('closed', 'SELL', 8),
      tx('us', 'BUY', 5, new Date('2026-01-02T00:00:00Z')),
    ])
    expect([...active]).toEqual(['cn'])
  })

  it('日常人工刷新只覆盖当前持仓并附带境内基准', () => {
    const plan = buildMarketRefreshPlan(assets, new Set(['cn', 'us', 'fund', 'qdii']), 'manual')
    expect(plan.fundSymbols).toEqual(['110022', '040046'])
    expect(plan.marketSymbols).toEqual(['510300', 'USQQQ', 'sh000300', 'sh000001', 'sz399006', 'sh000688'])
    expect(plan.marketSymbols).not.toContain('159915')
    expect(plan.hasForeignCurrency).toBe(true)
  })

  it('三个自动时段分别刷新境外场内、境内场内和基金净值', () => {
    const active = new Set(['cn', 'us', 'fund', 'qdii'])
    expect(buildMarketRefreshPlan(assets, active, 'us-close').marketSymbols).toEqual(['USQQQ'])
    expect(buildMarketRefreshPlan(assets, active, 'cn-close').marketSymbols)
      .toEqual(['510300', 'sh000300', 'sh000001', 'sz399006', 'sh000688'])
    expect(buildMarketRefreshPlan(assets, active, 'fund-nav').fundSymbols).toEqual(['110022', '040046'])
  })

  it('完整维护覆盖已清仓历史资产，但仍排除手动估值资产', () => {
    const plan = buildMarketRefreshPlan(assets, new Set(), 'full')
    expect(plan.marketSymbols).toContain('159915')
    expect(plan.marketSymbols).not.toContain('HUAWEI-ESOP')
    expect(plan.assets).toHaveLength(5)
  })

  it('未知定时槽回落到显式默认值', () => {
    expect(refreshSlotOf('unknown', 'full')).toBe('full')
    expect(refreshSlotOf('fund-nav')).toBe('fund-nav')
  })
})
