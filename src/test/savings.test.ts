import { describe, expect, it } from 'vitest'
import { buildSavingsOverview } from '@/lib/engine/savings'

describe('buildSavingsOverview', () => {
  it('aggregates weekly records when no monthly summary exists', () => {
    const overview = buildSavingsOverview(
      [
        { periodType: 'WEEK', periodStart: new Date('2026-07-06'), income: 18000, spending: 9000, savedAmount: 6000 },
        { periodType: 'WEEK', periodStart: new Date('2026-07-20'), income: 18000, spending: 15200, savedAmount: 2000 },
      ],
      new Date('2026-07-31'),
      1,
    )

    expect(overview.current).toMatchObject({
      income: 36000,
      spending: 24200,
      netSavings: 11800,
      savedAmount: 8000,
      unallocated: 3800,
      source: 'WEEK',
    })
    expect(overview.current.savingsRate).toBeCloseTo(11800 / 36000)
  })

  it('uses the monthly summary instead of double-counting weekly records', () => {
    const overview = buildSavingsOverview(
      [
        { periodType: 'WEEK', periodStart: new Date('2026-07-06'), income: 10000, spending: 5000, savedAmount: 3000 },
        { periodType: 'MONTH', periodStart: new Date('2026-07-01'), income: 36000, spending: 24000, savedAmount: 9000 },
      ],
      new Date('2026-07-31'),
      1,
    )

    expect(overview.current.income).toBe(36000)
    expect(overview.current.netSavings).toBe(12000)
    expect(overview.current.source).toBe('MONTH')
  })

  it('derives sustainable savings from the most recent three recorded months', () => {
    const overview = buildSavingsOverview(
      [
        { periodType: 'MONTH', periodStart: new Date('2026-04-01'), income: 30000, spending: 25000, savedAmount: 5000 },
        { periodType: 'MONTH', periodStart: new Date('2026-05-01'), income: 30000, spending: 22000, savedAmount: 8000 },
        { periodType: 'MONTH', periodStart: new Date('2026-06-01'), income: 30000, spending: 21000, savedAmount: 9000 },
        { periodType: 'MONTH', periodStart: new Date('2026-07-01'), income: 30000, spending: 20000, savedAmount: 10000 },
      ],
      new Date('2026-07-31'),
      4,
    )

    expect(overview.sustainableMonthlySavings).toBe(9000)
    expect(overview.averageRate).toBeCloseTo((5000 + 8000 + 9000 + 10000) / (30000 * 4))
  })
})

describe('负储蓄率（当月净流出）', () => {
  it('支出大于收入时储蓄率为负，且不被截断为 0', () => {
    const overview = buildSavingsOverview(
      [{ periodType: 'MONTH', periodStart: new Date('2026-08-01'), income: 20000, spending: 26000, savedAmount: 0 }],
      new Date('2026-08-31'),
      1,
    )
    // 图表此前把 Y 轴下限钉在 0，负值会被裁掉看不出「这个月在净流出」
    expect(overview.current.netSavings).toBe(-6000)
    expect(overview.current.savingsRate).toBeCloseTo(-0.3)
  })
})
