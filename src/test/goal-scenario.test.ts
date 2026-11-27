import { describe, expect, it } from 'vitest'
import { goalScenarioPreviewSchema } from '@/lib/schemas'
import { projectFireGoal } from '@/lib/engine/projection'
import { describeZodError } from '@/lib/validation-message'

const input = {
  monthlyContribution: 25000,
  delayMonths: 6,
  base: {
    current: 1000000,
    fireNumberToday: 3000000,
    monthsToRetirement: 12,
    withdrawalRate: 0.04,
    inflationRate: 0.02,
    retirementYears: 0,
    annualReturn: 0.05,
    volatility: 0.1,
    seed: 42,
    portfolioWeights: { STOCK: 600000, CASH: 400000 },
  },
}

describe('目标试算与页面共用投影输入', () => {
  it('接受按持仓金额装配的相对权重，校验前后引擎结果一致', () => {
    const parsed = goalScenarioPreviewSchema.parse(input)
    const originalProjection = projectFireGoal({ ...input.base, monthlyContribution: input.monthlyContribution, monthsToRetirement: 18 })
    const previewProjection = projectFireGoal({ ...parsed.base, monthlyContribution: parsed.monthlyContribution, monthsToRetirement: parsed.base.monthsToRetirement + parsed.delayMonths })
    expect(previewProjection).toEqual(originalProjection)
  })

  it.each([-1, Infinity, NaN])('拒绝无效组合权重 %s，提示包含资产类别', (weight) => {
    const result = goalScenarioPreviewSchema.safeParse({ ...input, base: { ...input.base, portfolioWeights: { STOCK: weight } } })
    expect(result.success).toBe(false)
    if (!result.success) expect(describeZodError(result.error).text).toContain('股票组合权重')
  })

  it('期限与月投入超界时给出具体字段与范围', () => {
    const result = goalScenarioPreviewSchema.safeParse({ ...input, monthlyContribution: -500, delayMonths: 42 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(describeZodError(result.error).text).toContain('每月投入不能小于 0')
      expect(describeZodError(result.error).text).toContain('目标延期月数不能大于 36')
    }
  })
})
