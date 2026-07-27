import { describe, expect, it } from 'vitest'
import { buildCalibration, calibratedConfidencePct, errorDecay, summarizeCalibration } from '@/lib/engine/fund-calibrate'

describe('估值校准', () => {
  const estimates = [
    { date: '2026-07-21', estReturn: 0.012 },
    { date: '2026-07-22', estReturn: 0.008 },
    { date: '2026-07-23', estReturn: -0.004 },
    { date: '2026-07-24', estReturn: 0.006 }, // 官方无当日数据，应被跳过
  ]
  const officials = [
    { date: '2026-07-21', officialReturn: 0.01 },
    { date: '2026-07-22', officialReturn: 0.01 },
    { date: '2026-07-23', officialReturn: -0.002 },
  ]

  it('按日期连接并计算误差，缺官方数据的日期跳过', () => {
    const points = buildCalibration(estimates, officials)
    expect(points).toHaveLength(3)
    expect(points[0].error).toBeCloseTo(0.002, 9)
    expect(points[1].error).toBeCloseTo(-0.002, 9)
    expect(points[2].error).toBeCloseTo(-0.002, 9)
  })

  it('MAE 与偏差统计', () => {
    const s = summarizeCalibration(buildCalibration(estimates, officials))
    expect(s.days).toBe(3)
    expect(s.mae).toBeCloseTo(0.002, 9)
    expect(s.bias).toBeCloseTo((0.002 - 0.002 - 0.002) / 3, 9)
    expect(s.maePct).toBeCloseTo(0.2, 3)
  })

  it('空输入返回零值', () => {
    const s = summarizeCalibration([])
    expect(s.days).toBe(0)
    expect(s.mae).toBe(0)
  })

  it('误差衰减：MAE 越大衰减越狠，MAE=0 不衰减', () => {
    expect(errorDecay(0)).toBe(1)
    expect(errorDecay(0.005)).toBeCloseTo(0.7788, 3)
    expect(errorDecay(0.01)).toBeCloseTo(0.6065, 3)
    expect(errorDecay(0.1)).toBeLessThan(0.01)
    expect(errorDecay(0.005)).toBeGreaterThan(errorDecay(0.01))
  })

  it('校准置信度：天数不足退化覆盖率，充足时覆盖率×衰减且封顶 95', () => {
    // 3 天 < 5：不惩罚
    const young = calibratedConfidencePct(80, { days: 3, mae: 0.05, bias: 0, maePct: 5, biasPct: 0 })
    expect(young.calibrated).toBe(false)
    expect(young.confidencePct).toBe(80)
    // 10 天，MAE=0.5% → 80 × 0.7788 ≈ 62.3
    const mature = calibratedConfidencePct(80, { days: 10, mae: 0.005, bias: 0, maePct: 0.5, biasPct: 0 })
    expect(mature.calibrated).toBe(true)
    expect(mature.confidencePct).toBeCloseTo(62.3, 1)
    // 零误差 → 不衰减但仍封顶
    const perfect = calibratedConfidencePct(98, { days: 10, mae: 0, bias: 0, maePct: 0, biasPct: 0 })
    expect(perfect.confidencePct).toBe(95)
  })
})
