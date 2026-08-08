import { describe, expect, it } from 'vitest'
import { performanceBetween, performancePresetRange, periodPerformance } from '@/lib/engine/period-performance'

describe('阶段收益', () => {
  it('上海时区月初使用上月最后一日，而不是再向前错一天', () => {
    const series = [
      { date: '2026-07-30', netWorth: 323796, contributions: 357544 },
      { date: '2026-07-31', netWorth: 325506, contributions: 357544 },
      { date: '2026-08-03', netWorth: 324800, contributions: 357544 },
    ]
    const augustStartInShanghai = new Date('2026-07-31T16:00:00Z')
    const result = periodPerformance(series, augustStartInShanghai, '本月')

    expect(result.basisDate).toBe('2026-07-31')
    expect(result.amount).toBe(-706)
  })

  it('扣除周期内净投入', () => {
    const result = periodPerformance([
      { date: '2026-07-31', netWorth: 100, contributions: 80 },
      { date: '2026-08-03', netWorth: 130, contributions: 100 },
    ], new Date('2026-07-31T16:00:00Z'), '本月')

    expect(result.amount).toBe(10)
    expect(result.pct).toBeCloseTo(0.1)
  })

  it('任意结束日期只计算区间内收益，并按每日资金流链式计算 TWR', () => {
    const result = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 110, contributions: 100 },
      { date: '2026-08-02', netWorth: 220, contributions: 200 },
      { date: '2026-08-03', netWorth: 1000, contributions: 200 },
    ], '2026-08-01', '2026-08-02', '自定义')

    expect(result.basisDate).toBe('2026-07-31')
    expect(result.endDate).toBe('2026-08-02')
    expect(result.amount).toBe(20)
    expect(result.netFlow).toBe(100)
    expect(result.pct).toBeCloseTo(0.2)
    expect(result.curve.map((point) => point.amount)).toEqual([0, 10, 20])
    expect(result.curve.map((point) => point.dailyAmount)).toEqual([null, 10, 10])
    expect(result.curve[1].dailyPct).toBeCloseTo(0.1)
    expect(result.curve[2].dailyPct).toBeCloseTo(10 / 110)
    expect(result.curve.at(-1)?.pct).toBeCloseTo(0.2)
  })

  it('自然周期支持本周、本月、今年和滚动时间段', () => {
    const now = new Date('2026-08-05T04:00:00Z')

    expect(performancePresetRange('THIS_WEEK', now).startDate).toBe('2026-08-03')
    expect(performancePresetRange('THIS_MONTH', now).startDate).toBe('2026-08-01')
    expect(performancePresetRange('THIS_YEAR', now).startDate).toBe('2026-01-01')
    expect(performancePresetRange('LAST_7_DAYS', now).startDate).toBe('2026-07-30')
    expect(performancePresetRange('LAST_30_DAYS', now).startDate).toBe('2026-07-07')
    expect(performancePresetRange('LAST_YEAR', now).startDate).toBe('2025-08-05')
    expect(performancePresetRange('ALL', now, '2024-01-02').startDate).toBe('2024-01-02')
  })

  it('无快照的日期范围不沿用范围外旧数据', () => {
    const result = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
    ], '2026-08-01', '2026-08-02')

    expect(result.endDate).toBeNull()
    expect(result.amount).toBeNull()
  })

  it('休市快照保留余额但不产生零收益观察，下一交易日承接累计收益', () => {
    const series = [
      { date: '2026-07-31', netWorth: 100, contributions: 100, valuationStatus: 'SETTLED' as const },
      { date: '2026-08-01', netWorth: 100, contributions: 100, valuationStatus: 'CLOSED' as const },
      { date: '2026-08-02', netWorth: 100, contributions: 100, valuationStatus: 'CLOSED' as const },
      { date: '2026-08-03', netWorth: 110, contributions: 100, valuationStatus: 'SETTLED' as const },
    ]

    const weekend = performanceBetween(series, '2026-08-01', '2026-08-02')
    expect(weekend.amount).toBeNull()
    expect(weekend.pct).toBeNull()
    expect(weekend.curve.slice(1).map((point) => point.dailyAmount)).toEqual([null, null])

    const throughMonday = performanceBetween(series, '2026-08-01', '2026-08-03')
    expect(throughMonday.amount).toBe(10)
    expect(throughMonday.pct).toBeCloseTo(0.1)
    expect(throughMonday.curve.map((point) => point.dailyPct)).toEqual([null, null, null, 0.1])
  })

  it('部分估值仍给出临时收益并保留覆盖率', () => {
    const result = performanceBetween([
      { date: '2026-08-03', netWorth: 100, contributions: 100, valuationStatus: 'SETTLED' as const, valuationCoverage: 1 },
      { date: '2026-08-04', netWorth: 105, contributions: 100, valuationStatus: 'PARTIAL' as const, valuationCoverage: 0.75 },
    ], '2026-08-04', '2026-08-04')

    expect(result.amount).toBe(5)
    expect(result.curve.at(-1)?.valuationStatus).toBe('PARTIAL')
    expect(result.curve.at(-1)?.valuationCoverage).toBe(0.75)
  })
})

describe('资金加权收益率（Modified Dietz）', () => {
  it('无外部资金流时与时间加权收益率一致', () => {
    const result = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 110, contributions: 100 },
      { date: '2026-08-02', netWorth: 99, contributions: 100 },
      { date: '2026-08-03', netWorth: 108.9, contributions: 100 },
    ], '2026-08-01', '2026-08-03')

    expect(result.curve.map((point) => point.mwrPct)).toEqual(result.curve.map((point) => point.pct))
    expect(result.curve.at(-1)?.mwrPct).toBeCloseTo(0.089)
  })

  it('区间中途一笔入金按日中点加权，与手工 Dietz 计算一致', () => {
    const result = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 110, contributions: 100 },
      { date: '2026-08-02', netWorth: 220, contributions: 200 },
    ], '2026-08-01', '2026-08-02')

    // 08-01: r = 10 / 100 = 0.1
    // 08-02: r = (220 − 110 − 100) / (110 + 100 × 0.5) = 10 / 160 = 0.0625
    expect(result.curve[1].mwrPct).toBeCloseTo(0.1)
    expect(result.curve[2].mwrPct).toBeCloseTo(1.1 * 1.0625 - 1)
    // TWR 不受资金流时间影响：1.1 × (1 + 10/110) − 1 = 0.2
    expect(result.curve[2].pct).toBeCloseTo(0.2)
    expect(result.curve[2].mwrPct).toBeLessThan(result.curve[2].pct)
  })

  it('同样的收益，入金越早资金加权收益率越低（权重效应方向）', () => {
    // 期初入金：100 + 100 入金 → 赚 10
    const early = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 200, contributions: 200 },
      { date: '2026-08-02', netWorth: 210, contributions: 200 },
    ], '2026-08-01', '2026-08-02')
    // 期末入金：100 → 赚 10 → +100 入金
    const late = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 110, contributions: 100 },
      { date: '2026-08-02', netWorth: 210, contributions: 200 },
    ], '2026-08-01', '2026-08-02')

    expect(early.amount).toBe(10)
    expect(late.amount).toBe(10)
    // early: r1 = 0 / 150 = 0, r2 = 10 / 200 = 0.05 → 0.05
    expect(early.curve.at(-1)?.mwrPct).toBeCloseTo(0.05)
    // late: r1 = 10 / 100 = 0.1, r2 = 0 / 160 = 0 → 0.1
    expect(late.curve.at(-1)?.mwrPct).toBeCloseTo(0.1)
    expect(early.curve.at(-1)!.mwrPct).toBeLessThan(late.curve.at(-1)!.mwrPct)
  })

  it('分母非正当日跳过资金加权计算并沿用前值，不影响时间加权', () => {
    const result = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 90, contributions: -900 },
    ], '2026-08-01', '2026-08-01')

    // 分母 = 100 + (−1000) × 0.5 = −400 ≤ 0 → 当日 Dietz 跳过
    expect(result.curve.at(-1)?.mwrPct).toBe(0)
    // TWR 仍按 V_{d-1} 计算：(90 − 100 + 1000) / 100 = 9.9
    expect(result.curve.at(-1)?.dailyPct).toBeCloseTo(9.9)
    expect(result.curve.at(-1)?.pct).toBeCloseTo(9.9)
  })

  it('休市与仅资金流日记为空并沿用前值，下一观察日承接', () => {
    const result = performanceBetween([
      { date: '2026-07-31', netWorth: 100, contributions: 100, valuationStatus: 'SETTLED' as const },
      { date: '2026-08-01', netWorth: 150, contributions: 150, valuationStatus: 'FLOW_ONLY' as const },
      { date: '2026-08-02', netWorth: 165, contributions: 150, valuationStatus: 'SETTLED' as const },
    ], '2026-08-01', '2026-08-02')

    expect(result.curve[1].dailyPct).toBeNull()
    expect(result.curve[1].mwrPct).toBe(0)
    // 仅资金流日的入金已并入余额：r = (165 − 150 − 0) / 150 = 0.1
    expect(result.curve[2].mwrPct).toBeCloseTo(0.1)
  })
})
