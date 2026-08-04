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
})
