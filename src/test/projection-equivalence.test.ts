// 投影引擎等价性基线：性能优化（Cholesky/权重计划外提、样本数组复用、quickselect 取分位）
// 必须**逐字段保持数值不变**。基线由优化前的实现生成并冻结在 fixtures 里。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { projectFireGoal, projectFireScenarios, projectGoal, projectStreamGoal } from '@/lib/engine/projection'

interface FixtureCase {
  fn: string
  input: Record<string, unknown>
  output: unknown
}

const fixture = JSON.parse(readFileSync('src/test/fixtures/projection-baseline.json', 'utf8')) as { cases: FixtureCase[] }

/** 递归比较：数值按相对误差 ≤1e-12（等价于最后几位一致），结构必须完全一致 */
function compare(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number') {
    expect(typeof actual, `${path} 类型`).toBe('number')
    const a = actual as number
    if (Number.isNaN(expected)) {
      expect(Number.isNaN(a), `${path} 应为 NaN`).toBe(true)
      return
    }
    const tolerance = Math.max(Math.abs(expected), 1) * 1e-12
    expect(Math.abs(a - expected), `${path}: ${a} vs ${expected}`).toBeLessThanOrEqual(tolerance)
    return
  }
  if (expected === null || typeof expected !== 'object') {
    expect(actual, path).toBe(expected)
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path} 应为数组`).toBe(true)
    const list = actual as unknown[]
    expect(list.length, `${path} 长度`).toBe(expected.length)
    expected.forEach((item, index) => compare(list[index], item, `${path}[${index}]`))
    return
  }
  const actualRecord = actual as Record<string, unknown>
  for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
    compare(actualRecord?.[key], value, `${path}.${key}`)
  }
}

function run(name: string, input: Record<string, unknown>): unknown {
  if (name.startsWith('projectGoal')) return projectGoal(input as never)
  if (name.startsWith('projectStreamGoal')) return projectStreamGoal(input as never)
  if (name.startsWith('projectFireGoal')) return projectFireGoal(input as never)
  throw new Error(`未知函数 ${name}`)
}

describe('投影引擎：优化前后数值等价', () => {
  it.each(fixture.cases.map((item) => [item.fn, item] as const))('%s', (fn, item) => {
    compare(run(fn, item.input), item.output)
  })

  it('大样本（sims=1500、132+480 个月）与基线一致', () => {
    const input = {
      current: 2_198_216,
      fireNumberToday: 6_000_000,
      monthsToRetirement: 132,
      withdrawalRate: 0.04,
      inflationRate: 0.025,
      retirementYears: 40,
      monthlyContribution: 20_000,
      annualReturn: 0.07,
      volatility: 0.15,
      seed: 1234,
      sims: 1500,
      portfolioWeights: { STOCK: 0.3, FUND: 0.2, ETF: 0.15, CASH: 0.2, GOLD: 0.1, REAL_ESTATE: 0.05 },
    }
    const result = projectFireGoal(input)
    expect(result.projectedMedian).toBeGreaterThan(0)
    // 与冻结的基线哈希一致（由优化前实现生成）
    expect({
      accumulationSuccessProb: result.accumulationSuccessProb,
      retirementSuccessProb: result.retirementSuccessProb,
      successProb: result.successProb,
      requiredMonthly: Math.round(result.requiredMonthly * 100) / 100,
      projectedMedian: Math.round(result.projectedMedian * 100) / 100,
      fireNumberAtRetirement: Math.round(result.fireNumberAtRetirement * 100) / 100,
      estimatedFireMonths: result.estimatedFireMonths,
      lastPoint: result.points.at(-1),
    }).toEqual({
      accumulationSuccessProb: 0.4053333333333333,
      retirementSuccessProb: 0.35133333333333333,
      successProb: 0.35133333333333333,
      requiredMonthly: 16609.55,
      projectedMedian: 7280646.38,
      fireNumberAtRetirement: 7872519.95,
      estimatedFireMonths: 119,
      lastPoint: { month: 132, p10: 4616936.411370714, p50: 7280646.378888206, p90: 11842166.23376412 },
    })
  })

  it('非法月数（NaN）不再让页面崩：按 0 个月处理', () => {
    const goal = projectGoal({ current: 100, target: 200, months: Number.NaN, monthlyContribution: 10, annualReturn: 0.07, volatility: 0.15 })
    expect(goal.points).toHaveLength(1)
    expect(goal.successProb).toBe(0)
    // 积累期 NaN 视为 0，支出期照常按 spendYears 计算（13 个点），全程不得抛错
    const stream = projectStreamGoal({
      current: 100,
      monthlyContribution: 10,
      monthsAccum: Number.NaN,
      annualSpend: 1200,
      spendYears: 1,
      annualReturn: 0.07,
      volatility: 0.15,
    })
    expect(stream.points).toHaveLength(13)
    expect(stream.points.every((point) => Number.isFinite(point.p50))).toBe(true)
  })
})

describe('多情景共用一条冲击序列', () => {
  const base = {
    current: 2_198_216,
    fireNumberToday: 6_000_000,
    monthsToRetirement: 132,
    withdrawalRate: 0.04,
    inflationRate: 0.025,
    retirementYears: 40,
    monthlyContribution: 20_000,
    annualReturn: 0.07,
    volatility: 0.15,
    seed: 1234,
    sims: 600,
    portfolioWeights: { STOCK: 0.3, FUND: 0.2, ETF: 0.15, CASH: 0.2, GOLD: 0.1, REAL_ESTATE: 0.05 },
  }

  it('一次算两个情景与分别调用逐字段一致', () => {
    const [planned, sustainable] = projectFireScenarios(base, [20_000, 15_000])
    compare(planned, projectFireGoal({ ...base, monthlyContribution: 20_000 }))
    compare(sustainable, projectFireGoal({ ...base, monthlyContribution: 15_000 }))
  })

  it('情景顺序不影响各自结果', () => {
    const [first, second] = projectFireScenarios(base, [15_000, 20_000])
    compare(first, projectFireGoal({ ...base, monthlyContribution: 15_000 }))
    compare(second, projectFireGoal({ ...base, monthlyContribution: 20_000 }))
  })
})
