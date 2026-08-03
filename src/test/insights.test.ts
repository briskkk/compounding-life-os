import { describe, expect, it } from 'vitest'
import { generateInsights } from '@/lib/engine/insights'
import type { Metrics } from '@/lib/engine/metrics'
import type { ValuedPosition } from '@/lib/engine/valuation'

const metrics: Metrics = {
  netWorth: 100_000,
  investable: 100_000,
  realizedPnl: 0,
  unrealizedPnl: 0,
  cashRatio: 0.2,
  byClass: {
    STOCK: 80_000,
    FUND: 0,
    ETF: 0,
    CASH: 20_000,
    GOLD: 0,
    REAL_ESTATE: 0,
    RSU: 0,
  },
  liquidity: { cash: 20_000, market: 80_000, restricted: 0, illiquid: 0 },
  holdings: [{ symbol: 'TEST', name: '测试资产', cls: 'STOCK', value: 80_000, weight: 0.8 }],
  concentration: { symbol: 'TEST', name: '测试资产', cls: 'STOCK', value: 80_000, weight: 0.8 },
}

const valued: ValuedPosition[] = [{
  accountId: 'account',
  assetId: 'asset',
  quantity: 1,
  vestedQty: 0,
  unvestedQty: 0,
  costBasis: 80_000,
  realizedPnl: 0,
  manualValue: null,
  lastValuationAt: null,
  asset: { id: 'asset', symbol: 'TEST', name: '测试资产', cls: 'STOCK', manual: false, currency: 'CNY' },
  price: 80_000,
  priceSource: 'MARKET',
  value: 80_000,
  investable: 80_000,
  costCny: 80_000,
  realizedCny: 0,
  unrealized: 0,
  unrealizedPct: 0,
}]

describe('储蓄洞察', () => {
  it('平均储蓄率低于计划线时给出可执行提醒', () => {
    const insights = generateInsights({
      metrics,
      valued,
      goals: [],
      netWorth30dAgo: null,
      now: new Date('2026-08-03T00:00:00Z'),
      concentrationCeiling: 1,
      savings: {
        averageRate: 0.12,
        currentRate: 0.1,
        sustainableMonthlySavings: 2_000,
        recordedMonths: 3,
      },
    })

    const savingsInsight = insights.find((insight) => insight.kind === 'SAVINGS_RATE')
    expect(savingsInsight?.title).toContain('储蓄率')
    expect(savingsInsight?.body).toContain('12.0%')
    expect(savingsInsight?.body).toContain('¥2,000.00')
  })
})
