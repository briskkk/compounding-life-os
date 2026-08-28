import { describe, expect, it } from 'vitest'
import { buildAllocationDrift } from '@/lib/engine/allocation-drift'

describe('目标配置偏离', () => {
  it('把在途资金归入现金，并按容忍带判断偏离', () => {
    const result = buildAllocationDrift(
      [{ cls: 'STOCK', amount: 600 }, { cls: 'CASH', amount: 100 }],
      [
        { cls: 'STOCK', targetWeight: 0.5, tolerance: 0.03 },
        { cls: 'FUND', targetWeight: 0, tolerance: 0.03 },
        { cls: 'ETF', targetWeight: 0, tolerance: 0.03 },
        { cls: 'CASH', targetWeight: 0.5, tolerance: 0.03 },
        { cls: 'GOLD', targetWeight: 0, tolerance: 0.03 },
      ],
      300,
    )

    expect(result.currentTotal).toBe(1000)
    expect(result.rows.find((row) => row.cls === 'CASH')?.currentWeight).toBe(0.4)
    expect(result.rows.find((row) => row.cls === 'STOCK')?.status).toBe('OVER')
    expect(result.outOfRangeCount).toBe(2)
  })

  it('未配置目标时不生成误导性的偏离告警', () => {
    const result = buildAllocationDrift([{ cls: 'ETF', amount: 100 }], [])
    expect(result.configured).toBe(false)
    expect(result.outOfRangeCount).toBe(0)
    expect(result.largestDrift).toBeNull()
  })
})
