import { describe, expect, it } from 'vitest'
import { alignBenchmark } from '@/lib/engine/benchmark'

describe('alignBenchmark', () => {
  it('空输入返回全 null', () => {
    expect(alignBenchmark([], [{ date: '2026-01-01', close: 4000 }])).toEqual([])
    expect(alignBenchmark(['2026-01-01'], [])).toEqual([null])
  })

  it('曲线首日之前无收盘价：整列 null', () => {
    const points = [{ date: '2026-02-01', close: 4000 }]
    expect(alignBenchmark(['2026-01-01', '2026-01-02'], points)).toEqual([null, null])
  })

  it('按首日收盘为基准计算逐日累计收益率', () => {
    const points = [
      { date: '2026-01-01', close: 4000 },
      { date: '2026-01-02', close: 4200 },
      { date: '2026-01-03', close: 3800 },
    ]
    const result = alignBenchmark(['2026-01-01', '2026-01-02', '2026-01-03'], points)
    expect(result[0]).toBe(0)
    expect(result[1]).toBeCloseTo(0.05, 12)
    expect(result[2]).toBeCloseTo(-0.05, 12)
  })

  it('非交易日沿用前一收盘；首日之前最近收盘作基准净值', () => {
    const points = [
      { date: '2025-12-31', close: 3900 }, // 期初基准日之前最近收盘
      { date: '2026-01-02', close: 4000 },
      // 2026-01-03 / 04 无交易（周末）
      { date: '2026-01-05', close: 4400 },
    ]
    const result = alignBenchmark(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05'], points)
    expect(result[0]).toBe(0) // 3900 → 基准
    expect(result[1]).toBeCloseTo(4000 / 3900 - 1, 12)
    expect(result[2]).toBeCloseTo(4000 / 3900 - 1, 12) // 01-04 沿用 01-02 收盘
    expect(result[3]).toBeCloseTo(4400 / 3900 - 1, 12)
  })

  it('基准收盘价非正时整列 null', () => {
    const points = [{ date: '2026-01-01', close: 0 }]
    expect(alignBenchmark(['2026-01-01'], points)).toEqual([null])
  })
})
