import { describe, expect, it } from 'vitest'
import { buildStrategyDrift, UNASSIGNED_STRATEGY } from '@/lib/engine/strategy-allocation'
import { performanceScopes } from '@/lib/engine/performance-scope'
import { combineAssetPerformanceSeries } from '@/lib/engine/group-performance'
import { performanceBetween } from '@/lib/engine/period-performance'
import { strategyTargetsInputSchema } from '@/lib/schemas'
import type { AssetPerformancePoint } from '@/lib/engine/asset-performance'

function point(date: string, netWorth: number, contributions: number, status: AssetPerformancePoint['valuationStatus'] = 'SETTLED'): AssetPerformancePoint {
  return { date, netWorth, contributions, quantity: 1, nav: netWorth, valuationStatus: status, valuationCoverage: status === 'SETTLED' ? 1 : 0, latestValuationDate: date, valuationGaps: [] }
}

describe('自定义组合目标与分类收益', () => {
  it('互斥分组形成单一分母，未分组资产也计入目标偏离', () => {
    const drift = buildStrategyDrift([
      { name: 'A股宽基', amount: 400 },
      { name: 'A股卫星', amount: 200 },
      { name: '', amount: 400 },
    ], [
      { name: 'A股宽基', targetWeight: 0.5, tolerance: 0.03 },
      { name: 'A股卫星', targetWeight: 0.2, tolerance: 0.03 },
      { name: UNASSIGNED_STRATEGY, targetWeight: 0.3, tolerance: 0.03 },
    ])
    expect(drift.currentTotal).toBe(1000)
    expect(drift.rows.find((row) => row.name === 'A股宽基')?.currentWeight).toBe(0.4)
    expect(drift.rows.find((row) => row.name === UNASSIGNED_STRATEGY)?.currentWeight).toBe(0.4)
    expect(drift.outOfRangeCount).toBe(2)
  })

  it('目标必须唯一且合计 100%', () => {
    expect(strategyTargetsInputSchema.safeParse({ targets: [
      { name: 'A股宽基', targetWeight: 0.6, tolerance: 0.03 },
      { name: 'A股宽基', targetWeight: 0.4, tolerance: 0.03 },
    ] }).success).toBe(false)
    expect(strategyTargetsInputSchema.safeParse({ targets: [
      { name: 'A股宽基', targetWeight: 0.6, tolerance: 0.03 },
    ] }).success).toBe(false)
  })

  it('分类筛选覆盖大类、风格、市场、组合分组与交叉标签', () => {
    const asset = { cls: 'ETF' as const, style: 'BROAD_INDEX' as const, symbol: '159919', name: '沪深300ETF', currency: 'CNY', strategyGroup: 'A股宽基', tags: '核心,长期' }
    const scopes = performanceScopes([asset])
    for (const key of ['class:ETF', 'style:BROAD_INDEX', 'market:DOMESTIC', 'strategy:A股宽基', 'tag:核心']) {
      expect(scopes.find((scope) => scope.key === key)?.matches(asset)).toBe(true)
    }
  })

  it('组间增持算资金流，组合收益只保留市场变化', () => {
    const series = combineAssetPerformanceSeries([
      { cls: 'ETF', points: [point('2026-09-01', 100, 100), point('2026-09-02', 110, 100)] },
      { cls: 'ETF', points: [point('2026-09-01', 50, 50), point('2026-09-02', 80, 80)] },
    ])
    const performance = performanceBetween(series, '2026-09-02', '2026-09-02')
    expect(performance.netFlow).toBe(30)
    expect(performance.amount).toBe(10)
    expect(performance.pct).toBeCloseTo(10 / 150)
  })

  it('部分标的行情缺失时不把分组标成完整收益观察', () => {
    const series = combineAssetPerformanceSeries([
      { cls: 'ETF', points: [point('2026-09-01', 100, 100), point('2026-09-02', 110, 100)] },
      { cls: 'FUND', points: [point('2026-09-01', 50, 50), point('2026-09-02', 50, 50, 'NO_UPDATE')] },
    ])
    expect(series[1].valuationStatus).toBe('PARTIAL')
    expect(series[1].valuationCoverage).toBeCloseTo(110 / 160)
  })
})
