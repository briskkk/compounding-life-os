import { describe, expect, it } from 'vitest'
import { foldLiability, totalLiabilities, type LiabilityEntryInput } from '@/lib/engine/liabilities'

const D = (s: string) => new Date(s)

const mortgage: LiabilityEntryInput[] = [
  { liabilityId: 'm1', type: 'DRAW', amount: 2_200_000, occurredAt: D('2025-01-20') },
  { liabilityId: 'm1', type: 'REPAY', amount: 9_800, occurredAt: D('2025-02-01') },
  { liabilityId: 'm1', type: 'REPAY', amount: 9_800, occurredAt: D('2025-03-01') },
]

describe('负债折叠', () => {
  it('DRAW 增、REPAY 减', () => {
    expect(foldLiability(mortgage)).toBe(2_200_000 - 19_600)
  })

  it('upTo 时点截断', () => {
    expect(foldLiability(mortgage, D('2025-01-31'))).toBe(2_200_000)
    expect(foldLiability(mortgage, D('2025-02-15'))).toBe(2_200_000 - 9_800)
  })

  it('ADJUST 覆盖为设定值（取时间序最后一条）', () => {
    const entries: LiabilityEntryInput[] = [
      { liabilityId: 'c1', type: 'DRAW', amount: 100_000, occurredAt: D('2025-01-01') },
      { liabilityId: 'c1', type: 'REPAY', amount: 30_000, occurredAt: D('2025-02-01') },
      { liabilityId: 'c1', type: 'ADJUST', amount: 65_000, occurredAt: D('2025-03-01') }, // 对账修正
      { liabilityId: 'c1', type: 'REPAY', amount: 5_000, occurredAt: D('2025-04-01') },
    ]
    expect(foldLiability(entries)).toBe(60_000)
  })

  it('REPAY 不会把余额扣成负数', () => {
    const entries: LiabilityEntryInput[] = [
      { liabilityId: 'x', type: 'DRAW', amount: 1000, occurredAt: D('2025-01-01') },
      { liabilityId: 'x', type: 'REPAY', amount: 5000, occurredAt: D('2025-02-01') },
    ]
    expect(foldLiability(entries)).toBe(0)
  })

  it('多笔负债合计', () => {
    const car: LiabilityEntryInput[] = [{ liabilityId: 'car', type: 'DRAW', amount: 150_000, occurredAt: D('2025-01-01') }]
    expect(totalLiabilities([...mortgage, ...car])).toBe(2_200_000 - 19_600 + 150_000)
  })
})
