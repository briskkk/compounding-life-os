import { describe, expect, it } from 'vitest'
import { currentGoalCapital, effectiveGoalMetric } from '@/lib/engine/goal-scope'

describe('目标资本口径', () => {
  it('退休目标始终使用家庭净资产，纳入员工持股等长期资产', () => {
    expect(effectiveGoalMetric('STREAM', 'INVESTABLE')).toBe('NET_WORTH')
    expect(currentGoalCapital('STREAM', 'INVESTABLE', {
      netWorth: 3_000_000,
      investable: 400_000,
    })).toEqual({ current: 3_000_000, metric: 'NET_WORTH', adjusted: true })
  })

  it('普通财富目标保留用户选择的口径', () => {
    expect(currentGoalCapital('LUMP_SUM', 'NET_WORTH', {
      netWorth: 3_000_000,
      investable: 400_000,
    })).toEqual({ current: 3_000_000, metric: 'NET_WORTH', adjusted: false })
  })
})
