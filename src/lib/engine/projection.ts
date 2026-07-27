// 目标达成预测：蒙特卡洛路径 + 确定性中位路径 + 反解所需月缴
// 支持两种回报模型：单因子（正态）或组合协方差模型（portfolioReturnSampler）
// 支持两种目标：LUMP_SUM 一次性达标 / STREAM 支出流（积累 + 分年支出）
import { gaussian, mulberry32 } from './rng'
import { portfolioReturnSampler, type ClassWeights } from './covariance'

export interface ProjectionInput {
  current: number
  target: number
  months: number
  monthlyContribution: number
  annualReturn: number // 期望年化收益，如 0.07（单因子模型使用）
  volatility: number // 年化波动率，如 0.15（单因子模型使用）
  seed?: number
  sims?: number
  portfolioWeights?: ClassWeights // 提供时改用组合协方差模型
}

export interface ProjectionPoint {
  month: number
  p10: number
  p50: number
  p90: number
}

export interface ProjectionResult {
  points: ProjectionPoint[]
  successProb: number // 到期达到目标（或支出流全程不断供）的模拟概率
  requiredMonthly: number // 中位路径下达标所需月缴
  projectedMedian: number // 到期中位值（STREAM：支出期末的中位余值）
  fundedRatio: number
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** 确定性（零波动）路径终值，用于反解月缴 */
function deterministicFinal(current: number, monthly: number, months: number, mr: number): number {
  let v = current
  for (let m = 0; m < months; m++) v = v * (1 + mr) + monthly
  return v
}

function makeSampler(input: { annualReturn: number; volatility: number; portfolioWeights?: ClassWeights; seed: number }) {
  const usePortfolio =
    input.portfolioWeights != null && Object.values(input.portfolioWeights).some((v) => (v ?? 0) > 0)
  return (simIndex: number): (() => number) => {
    const simSeed = (input.seed ^ (simIndex * 2654435761)) >>> 0
    if (usePortfolio) return portfolioReturnSampler(input.portfolioWeights!, simSeed)
    const rand = mulberry32(simSeed)
    const mr = input.annualReturn / 12
    const ms = input.volatility / Math.sqrt(12)
    return () => mr + ms * gaussian(rand)
  }
}

export function projectGoal(input: ProjectionInput): ProjectionResult {
  const { current, target, monthlyContribution: c, annualReturn: mu, seed = 42, sims = 1500 } = input
  const months = Math.max(0, Math.round(input.months))
  const mr = mu / 12

  if (months === 0) {
    const hit = current >= target
    return {
      points: [{ month: 0, p10: current, p50: current, p90: current }],
      successProb: hit ? 1 : 0,
      requiredMonthly: hit ? 0 : target - current,
      projectedMedian: current,
      fundedRatio: target > 0 ? current / target : 1,
    }
  }

  const byMonth: number[][] = Array.from({ length: months + 1 }, () => [])
  byMonth[0].push(current)
  const finals: number[] = []
  const samplerOf = makeSampler({
    annualReturn: input.annualReturn,
    volatility: input.volatility,
    portfolioWeights: input.portfolioWeights,
    seed,
  })

  for (let s = 0; s < sims; s++) {
    const sample = samplerOf(s)
    let v = current
    for (let m = 1; m <= months; m++) {
      v = v * (1 + sample()) + c
      if (v < 0) v = 0
      byMonth[m].push(v)
    }
    finals.push(v)
  }

  const points: ProjectionPoint[] = byMonth.map((vals, m) => {
    const sorted = [...vals].sort((a, b) => a - b)
    return { month: m, p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) }
  })

  const successProb = finals.filter((v) => v >= target).length / sims
  const projectedMedian = points[months].p50

  // 二分反解：中位路径恰好达标所需的月缴
  let requiredMonthly = 0
  if (deterministicFinal(current, 0, months, mr) < target) {
    let lo = 0
    let hi = Math.max(target / Math.max(months, 1), 1) * 4 + 1000
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (deterministicFinal(current, mid, months, mr) >= target) hi = mid
      else lo = mid
    }
    requiredMonthly = hi
  }

  return {
    points,
    successProb,
    requiredMonthly,
    projectedMedian,
    fundedRatio: target > 0 ? current / target : 1,
  }
}

// ---------- 支出流目标 ----------

export interface StreamProjectionInput {
  current: number
  monthlyContribution: number
  monthsAccum: number // 积累期月数（距 targetDate）
  annualSpend: number // 支出期每年支出
  spendYears: number // 支出年数
  annualReturn: number
  volatility: number
  seed?: number
  sims?: number
  portfolioWeights?: ClassWeights
}

/**
 * 支出流目标：积累期按月投入，支出期按月支取 annualSpend/12
 * 成功 = 全程任意月末余额 ≥ 0（不断供）
 */
export function projectStreamGoal(input: StreamProjectionInput): ProjectionResult {
  const {
    current,
    monthlyContribution: c,
    monthsAccum,
    annualSpend,
    spendYears,
    annualReturn: mu,
    seed = 42,
    sims = 1500,
  } = input
  const spendMonths = Math.max(0, Math.round(spendYears * 12))
  const accum = Math.max(0, Math.round(monthsAccum))
  const months = accum + spendMonths
  const monthlySpend = annualSpend / 12
  const mr = mu / 12
  const nominalTarget = annualSpend * spendYears

  if (months === 0) {
    const funded = current >= nominalTarget
    return {
      points: [{ month: 0, p10: current, p50: current, p90: current }],
      successProb: funded ? 1 : 0,
      requiredMonthly: funded ? 0 : nominalTarget - current,
      projectedMedian: current,
      fundedRatio: nominalTarget > 0 ? current / nominalTarget : 1,
    }
  }

  const byMonth: number[][] = Array.from({ length: months + 1 }, () => [])
  byMonth[0].push(current)
  const samplerOf = makeSampler({
    annualReturn: input.annualReturn,
    volatility: input.volatility,
    portfolioWeights: input.portfolioWeights,
    seed,
  })
  let success = 0
  const finals: number[] = []

  for (let s = 0; s < sims; s++) {
    const sample = samplerOf(s)
    let v = current
    let solvent = true
    for (let m = 1; m <= months; m++) {
      const flow = m <= accum ? c : -monthlySpend
      v = v * (1 + sample()) + flow
      if (v < 0) {
        solvent = false
        v = 0
      }
      byMonth[m].push(v)
    }
    if (solvent) success++
    finals.push(v)
  }

  const points: ProjectionPoint[] = byMonth.map((vals, m) => {
    const sorted = [...vals].sort((a, b) => a - b)
    return { month: m, p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9) }
  })

  // 反解月缴：确定性（零波动）路径在支出期末恰好归零
  const detFinal = (monthly: number) => {
    let v = current
    for (let m = 1; m <= months; m++) v = v * (1 + mr) + (m <= accum ? monthly : -monthlySpend)
    return v
  }
  let requiredMonthly = 0
  if (detFinal(0) < 0) {
    let lo = 0
    let hi = Math.max(nominalTarget / Math.max(accum, 1), 1) * 4 + 1000
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (detFinal(mid) >= 0) hi = mid
      else lo = mid
    }
    requiredMonthly = hi
  }

  return {
    points,
    successProb: success / sims,
    requiredMonthly,
    projectedMedian: points[months].p50,
    fundedRatio: nominalTarget > 0 ? current / nominalTarget : 1,
  }
}

export function monthsBetween(from: Date, to: Date): number {
  const m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  return Math.max(0, m)
}
