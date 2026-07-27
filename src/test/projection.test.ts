import { describe, expect, it } from 'vitest'
import { monthsBetween, projectGoal } from '@/lib/engine/projection'

describe('目标达成预测', () => {
  it('当前已达标且低波动 → 概率 1，无需追加', () => {
    const r = projectGoal({ current: 120, target: 100, months: 12, monthlyContribution: 0, annualReturn: 0.07, volatility: 0.001 })
    expect(r.successProb).toBe(1)
    expect(r.requiredMonthly).toBe(0)
  })

  it('零期限未达标 → 概率 0', () => {
    const r = projectGoal({ current: 50, target: 100, months: 0, monthlyContribution: 0, annualReturn: 0.07, volatility: 0.15 })
    expect(r.successProb).toBe(0)
    expect(r.requiredMonthly).toBe(50)
  })

  it('确定性可复制：同 seed 同结果', () => {
    const a = projectGoal({ current: 100, target: 300, months: 60, monthlyContribution: 2, annualReturn: 0.07, volatility: 0.2, seed: 99 })
    const b = projectGoal({ current: 100, target: 300, months: 60, monthlyContribution: 2, annualReturn: 0.07, volatility: 0.2, seed: 99 })
    expect(a.successProb).toBe(b.successProb)
    expect(a.projectedMedian).toBe(b.projectedMedian)
  })

  it('分位带单调：p10 ≤ p50 ≤ p90', () => {
    const r = projectGoal({ current: 100, target: 500, months: 120, monthlyContribution: 1, annualReturn: 0.08, volatility: 0.2, seed: 7 })
    for (const p of r.points) {
      expect(p.p10).toBeLessThanOrEqual(p.p50)
      expect(p.p50).toBeLessThanOrEqual(p.p90)
    }
  })

  it('按 requiredMonthly 缴付可使确定性路径达标', () => {
    const input = { current: 100, target: 1000, months: 120, annualReturn: 0.06, volatility: 0.15, seed: 3 }
    const r = projectGoal({ ...input, monthlyContribution: 0 })
    expect(r.requiredMonthly).toBeGreaterThan(0)
    const ok = projectGoal({ ...input, monthlyContribution: r.requiredMonthly, volatility: 0.0001 })
    expect(ok.projectedMedian).toBeGreaterThanOrEqual(input.target * 0.999)
  })

  it('投入越多，达成概率越高', () => {
    const base = { current: 100, target: 400, months: 60, annualReturn: 0.06, volatility: 0.2, seed: 11 }
    const low = projectGoal({ ...base, monthlyContribution: 0 })
    const high = projectGoal({ ...base, monthlyContribution: 5 })
    expect(high.successProb).toBeGreaterThanOrEqual(low.successProb)
  })

  it('monthsBetween 计算', () => {
    expect(monthsBetween(new Date('2026-01-15'), new Date('2027-01-14'))).toBe(12)
    expect(monthsBetween(new Date('2027-01-15'), new Date('2026-01-14'))).toBe(0)
  })
})
