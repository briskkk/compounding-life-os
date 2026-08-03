import { describe, expect, it } from 'vitest'
import { periodPerformance } from '@/lib/engine/period-performance'

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
})
