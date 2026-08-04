import { describe, expect, it } from 'vitest'
import { cholesky, CORR, portfolioReturnSampler, portfolioMoments, CLASSES } from '@/lib/engine/covariance'
import { projectGoal, projectStreamGoal } from '@/lib/engine/projection'

describe('协方差组合模拟', () => {
  it('Cholesky：L·Lᵀ 还原相关矩阵', () => {
    const L = cholesky(CORR)
    for (let i = 0; i < CORR.length; i++) {
      for (let j = 0; j < CORR.length; j++) {
        let s = 0
        for (let k = 0; k < CORR.length; k++) s += L[i][k] * L[j][k]
        expect(s).toBeCloseTo(CORR[i][j], 6)
      }
    }
  })

  it('采样器确定性：同 seed 同序列', () => {
    const a = portfolioReturnSampler({ STOCK: 0.6, GOLD: 0.4 }, 7)
    const b = portfolioReturnSampler({ STOCK: 0.6, GOLD: 0.4 }, 7)
    for (let i = 0; i < 50; i++) expect(a()).toBe(b())
  })

  it('高股权权重 → 更宽的分位带', () => {
    const equity = projectGoal({ current: 100, target: 200, months: 120, monthlyContribution: 0, annualReturn: 0.07, volatility: 0.2, seed: 5, portfolioWeights: { STOCK: 1 } })
    const cash = projectGoal({ current: 100, target: 200, months: 120, monthlyContribution: 0, annualReturn: 0.07, volatility: 0.2, seed: 5, portfolioWeights: { CASH: 1 } })
    const spread = (r: typeof equity) => r.points[120].p90 - r.points[120].p10
    expect(spread(equity)).toBeGreaterThan(spread(cash))
  })

  it('组合矩：纯现金波动≈0，混合组合介于成分之间', () => {
    expect(portfolioMoments({ CASH: 1 }).sigma).toBeCloseTo(0.002, 4)
    const mix = portfolioMoments({ STOCK: 0.5, GOLD: 0.5 })
    expect(mix.sigma).toBeLessThan(0.28)
    expect(mix.mu).toBeCloseTo(0.075, 3)
    expect(CLASSES.length).toBe(CORR.length)
    expect(CLASSES).not.toContain('HUAWEI_STOCK')
    expect(CLASSES).not.toContain('RSU')
  })
})

describe('支出流目标', () => {
  it('本金充足覆盖支出 → 成功率 1', () => {
    const r = projectStreamGoal({ current: 2000, monthlyContribution: 0, monthsAccum: 12, annualSpend: 100, spendYears: 5, annualReturn: 0.05, volatility: 0.01, seed: 1 })
    expect(r.successProb).toBe(1)
    expect(r.requiredMonthly).toBe(0)
  })

  it('本金不足 → 成功率下降，requiredMonthly 可补足（确定性路径不断供）', () => {
    // 零波动 → 所有路径相同，补足月缴后必然全程不断供
    const base = { current: 100, monthsAccum: 60, annualSpend: 50, spendYears: 5, annualReturn: 0.05, volatility: 0, seed: 2 }
    const poor = projectStreamGoal({ ...base, monthlyContribution: 0 })
    expect(poor.successProb).toBe(0)
    expect(poor.requiredMonthly).toBeGreaterThan(0)
    const fixed = projectStreamGoal({ ...base, monthlyContribution: poor.requiredMonthly })
    expect(fixed.successProb).toBe(1)
  })

  it('路径带覆盖积累期 + 支出期全月数', () => {
    const r = projectStreamGoal({ current: 500, monthlyContribution: 5, monthsAccum: 24, annualSpend: 120, spendYears: 3, annualReturn: 0.06, volatility: 0.15, seed: 9 })
    expect(r.points.length).toBe(24 + 36 + 1)
    expect(r.points[0].p50).toBe(500)
  })

  it('名义进度 = 当前 / 总支出', () => {
    const r = projectStreamGoal({ current: 90, monthlyContribution: 0, monthsAccum: 12, annualSpend: 30, spendYears: 6, annualReturn: 0.05, volatility: 0.1 })
    expect(r.fundedRatio).toBeCloseTo(0.5)
  })
})
