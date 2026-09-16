// 目标达成预测：蒙特卡洛路径 + 确定性中位路径 + 反解所需月缴
// 支持两种回报模型：单因子（正态）或组合协方差模型（portfolioReturnSampler）
// 支持两种目标：LUMP_SUM 一次性达标 / STREAM 支出流（积累 + 分年支出）
import { gaussian, mulberry32 } from './rng'
import { portfolioSamplerFactory, type ClassWeights } from './covariance'

/**
 * 蒙特卡洛默认路径数。
 *
 * 成本与抽样误差（本地生产构建实测，页面规模 147+600 个月、两情景）：
 *   sims=1500 → 冷算 213ms，概率抽样标准误 ±1.3pp（当前默认）
 *   sims=750  → 冷算  90ms，±1.8pp
 *   sims=500  → 冷算  59ms，±2.2pp
 *   sims=300  → 冷算  36ms，±2.9pp
 * 调低会改变页面上的概率与分位数（属产品决策）；调高只增加耗时。
 * 冷渲染还有约 200ms 来自进程内首次执行的 JIT 预热，与路径数无关。
 */
export const FIRE_SIMS_DEFAULT = 1500

const PERCENTILE_QS = [0.1, 0.5, 0.9] as const

/**
 * 结果记忆化：引擎是确定性的（seed 已含在输入里），同一组输入必然得到同一结果，
 * 因此可安全缓存。FIRE 页每次渲染要算「真实投入」与「可持续投入」两个情景，
 * 用户反复打开该页时命中缓存即瞬时返回。命中时返回**同一对象**，调用方只读。
 */
const RESULT_CACHE = new Map<string, unknown>()

function memoize<T>(kind: string, input: object, compute: () => T): T {
  const key = kind + '|' + JSON.stringify(input)
  const hit = RESULT_CACHE.get(key)
  if (hit !== undefined) return hit as T
  const value = compute()
  if (RESULT_CACHE.size > 256) RESULT_CACHE.clear()
  RESULT_CACHE.set(key, value)
  return value
}


/** 月数兜底：非有限值按 0 处理，避免 Array.from({length: NaN}) 造成空数组后崩溃 */
function safeMonths(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

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

export interface FireProjectionInput {
  current: number
  fireNumberToday: number
  monthsToRetirement: number
  monthlyContribution: number
  withdrawalRate: number
  inflationRate: number
  retirementYears: number
  annualReturn: number
  volatility: number
  seed?: number
  sims?: number
  portfolioWeights?: ClassWeights
}

export interface FireProjectionResult extends ProjectionResult {
  accumulationSuccessProb: number
  retirementSuccessProb: number
  fireNumberToday: number
  fireNumberAtRetirement: number
  annualPortfolioSpendToday: number
  coastFireNumber: number
  estimatedFireMonths: number | null
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** 就地 quickselect：把第 k 小的元素放到 values[k]（不需要整个数组有序） */
function selectKth(values: number[], k: number): number {
  let left = 0
  let right = values.length - 1
  while (left < right) {
    // 三点取中，避免有序输入退化
    const mid = (left + right) >> 1
    if (values[mid] < values[left]) { const t = values[mid]; values[mid] = values[left]; values[left] = t }
    if (values[right] < values[left]) { const t = values[right]; values[right] = values[left]; values[left] = t }
    if (values[right] < values[mid]) { const t = values[right]; values[right] = values[mid]; values[mid] = t }
    const pivot = values[mid]
    let i = left
    let j = right
    while (i <= j) {
      while (values[i] < pivot) i++
      while (values[j] > pivot) j--
      if (i <= j) {
        const t = values[i]; values[i] = values[j]; values[j] = t
        i++
        j--
      }
    }
    if (k <= j) right = j
    else if (k >= i) left = i
    else return values[k]
  }
  return values[k]
}

/**
 * 逐月分位：与「整段排序后取分位」数值一致，但只做 3 次 O(n) 选择而不是 O(n log n) 排序。
 * 出现非有限值时回退到排序路径，保持与旧实现完全相同的退化行为。
 */
function percentilesOf(values: number[], qs: readonly number[]): number[] {
  if (values.length === 0) return qs.map(() => 0)
  if (values.some((value) => !Number.isFinite(value))) {
    const sorted = [...values].sort((a, b) => a - b)
    return qs.map((q) => percentile(sorted, q))
  }
  const copy = [...values]
  const cache = new Map<number, number>()
  const at = (index: number) => {
    const hit = cache.get(index)
    if (hit !== undefined) return hit
    const selected = selectKth(copy, index)
    cache.set(index, selected)
    return selected
  }
  return qs.map((q) => {
    const idx = (values.length - 1) * q
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return at(lo)
    const a = at(lo)
    const b = at(hi)
    return a + (b - a) * (idx - lo)
  })
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
  const simSeedOf = (simIndex: number) => (input.seed ^ (simIndex * 2654435761)) >>> 0
  if (usePortfolio) {
    // 组合计划只与权重有关：构建一次，全部 sim 复用（原先每个 sim 重跑一次 Cholesky）
    const fromSeed = portfolioSamplerFactory(input.portfolioWeights!)
    return (simIndex: number): (() => number) => fromSeed(simSeedOf(simIndex))
  }
  const mr = input.annualReturn / 12
  const ms = input.volatility / Math.sqrt(12)
  return (simIndex: number): (() => number) => {
    const rand = mulberry32(simSeedOf(simIndex))
    return () => mr + ms * gaussian(rand)
  }
}

export function projectGoal(input: ProjectionInput): ProjectionResult {
  return memoize('goal', input, () => projectGoalUncached(input))
}

function projectGoalUncached(input: ProjectionInput): ProjectionResult {
  const { current, target, monthlyContribution: c, annualReturn: mu, seed = 42, sims = FIRE_SIMS_DEFAULT } = input
  const months = safeMonths(input.months)
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

  // 月份 0 只有一个期初值（旧实现为单元素数组），其余月份预分配 sims 个槽位
  const byMonth: number[][] = Array.from({ length: months + 1 }, (_, m) => (m === 0 ? [current] : new Array<number>(sims)))
  const finals: number[] = new Array<number>(sims)
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
      byMonth[m][s] = v
    }
    finals[s] = v
  }

  const points: ProjectionPoint[] = byMonth.map((vals, m) => {
    const [p10, p50, p90] = percentilesOf(vals, PERCENTILE_QS)
    return { month: m, p10, p50, p90 }
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
  return memoize('stream', input, () => projectStreamGoalUncached(input))
}

function projectStreamGoalUncached(input: StreamProjectionInput): ProjectionResult {
  const {
    current,
    monthlyContribution: c,
    monthsAccum,
    annualSpend,
    spendYears,
    annualReturn: mu,
    seed = 42,
    sims = FIRE_SIMS_DEFAULT,
  } = input
  const spendMonths = safeMonths(spendYears * 12)
  const accum = safeMonths(monthsAccum)
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

  // 月份 0 只有一个期初值（旧实现为单元素数组），其余月份预分配 sims 个槽位
  const byMonth: number[][] = Array.from({ length: months + 1 }, (_, m) => (m === 0 ? [current] : new Array<number>(sims)))
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
      byMonth[m][s] = v
    }
    if (solvent) success++
    finals[s] = v
  }

  const points: ProjectionPoint[] = byMonth.map((vals, m) => {
    const [p10, p50, p90] = percentilesOf(vals, PERCENTILE_QS)
    return { month: m, p10, p50, p90 }
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

/**
 * FIRE 计划同时验证两件事：
 * 1. 退休日资产是否达到按通胀换算后的 FIRE Number；
 * 2. 从真实积累路径出发，退休期间按通胀支取后是否始终不断供。
 *
 * fireNumberToday 与由它推导的年度组合支出均使用今日购买力口径。
 */
export function projectFireGoal(input: FireProjectionInput): FireProjectionResult {
  return projectFireScenarios(input, [input.monthlyContribution])[0]
}

/**
 * 同一组假设下的多个投入情景（例如「计划月投」与「可持续月投」）一次算完：
 * 高价的高斯抽样只在最内层抽一次，供全部情景共用，因此成本与只算一个情景接近。
 * 每个情景的数值与单独调用 projectFireGoal 完全一致（看到的是同一条冲击序列）。
 */
export function projectFireScenarios(input: FireProjectionInput, contributions: number[]): FireProjectionResult[] {
  return memoize('fire-scenarios', { input, contributions }, () => projectFireScenariosUncached(input, contributions))
}

function projectFireScenariosUncached(input: FireProjectionInput, contributions: number[]): FireProjectionResult[] {
  const {
    current,
    withdrawalRate,
    inflationRate,
    retirementYears,
    annualReturn,
    seed = 42,
    sims = FIRE_SIMS_DEFAULT,
  } = input
  const fireNumberToday = Math.max(0, input.fireNumberToday)
  const months = safeMonths(input.monthsToRetirement)
  const retirementMonths = safeMonths(retirementYears * 12)
  const monthlyInflation = Math.pow(1 + inflationRate, 1 / 12) - 1
  const monthlyReturn = Math.pow(1 + annualReturn, 1 / 12) - 1
  const inflationFactor = Math.pow(1 + monthlyInflation, months)
  const fireNumberAtRetirement = fireNumberToday * inflationFactor
  const annualPortfolioSpendToday = fireNumberToday * withdrawalRate
  const firstMonthlyDraw = annualPortfolioSpendToday * inflationFactor / 12
  const samplerOf = makeSampler({
    annualReturn,
    volatility: input.volatility,
    portfolioWeights: input.portfolioWeights,
    seed,
  })
  // 每期支取额只与月份有关：预先算好，避免在 sim × month 内层重复 Math.pow
  const draws = new Array<number>(retirementMonths)
  for (let m = 1; m <= retirementMonths; m++) draws[m - 1] = firstMonthlyDraw * Math.pow(1 + monthlyInflation, m - 1)

  // 确定性（零波动）路径反解所需月缴：与投入情景无关，多情景共用
  const deterministicAtRetirement = (monthly: number) => {
    let value = current
    for (let month = 0; month < months; month++) value = value * (1 + monthlyReturn) + monthly
    return value
  }
  let requiredMonthly = 0
  if (months === 0) {
    requiredMonthly = Math.max(0, fireNumberAtRetirement - current)
  } else if (deterministicAtRetirement(0) < fireNumberAtRetirement) {
    let lo = 0
    let hi = Math.max(fireNumberAtRetirement / months, 1) * 4 + 1000
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (deterministicAtRetirement(mid) >= fireNumberAtRetirement) hi = mid
      else lo = mid
    }
    requiredMonthly = hi
  }

  // 按给定投入估算达标月份（用于「还需多久」）：依赖投入额，因此每个情景各算一次
  const estimatedFireMonthsFor = (contribution: number): number | null => {
    let value = current
    for (let month = 0; month <= 1200; month++) {
      const target = fireNumberToday * Math.pow(1 + monthlyInflation, month)
      if (value >= target) return month
      value = value * (1 + monthlyReturn) + contribution
    }
    return null
  }

  const coastFireNumber = months === 0
    ? fireNumberToday
    : fireNumberAtRetirement / Math.pow(1 + monthlyReturn, months)

  // 多情景一次遍历：每个月的冲击只抽一次，供全部情景复用。
  // 这与「每个情景各自跑一遍」逐位一致——每个情景看到的都是同一条冲击序列的前缀。
  const scenarioCount = contributions.length
  const values = contributions.map(() => current)
  const accumSuccess = new Array<number>(scenarioCount).fill(0)
  const retireSuccess = new Array<number>(scenarioCount).fill(0)
  const byMonthAll: number[][][] = contributions.map(() =>
    Array.from({ length: months + 1 }, () => new Array<number>(sims)))

  for (let s = 0; s < sims; s++) {
    const sample = samplerOf(s)
    for (let k = 0; k < scenarioCount; k++) {
      values[k] = current
      byMonthAll[k][0][s] = current
    }
    for (let month = 1; month <= months; month++) {
      const shock = sample()
      for (let k = 0; k < scenarioCount; k++) {
        let v = values[k] * (1 + shock) + contributions[k]
        if (v < 0) v = 0
        values[k] = v
        byMonthAll[k][month][s] = v
      }
    }
    const solvent = contributions.map((_, k) => values[k] > 0 || firstMonthlyDraw === 0)
    for (let k = 0; k < scenarioCount; k++) {
      if (values[k] >= fireNumberAtRetirement) accumSuccess[k]++
    }
    for (let month = 1; month <= retirementMonths; month++) {
      const draw = draws[month - 1]
      const shock = sample()
      for (let k = 0; k < scenarioCount; k++) {
        let v = values[k] * (1 + shock) - draw
        if (v < 0) {
          solvent[k] = false
          v = 0
        }
        values[k] = v
      }
    }
    for (let k = 0; k < scenarioCount; k++) if (solvent[k]) retireSuccess[k]++
  }

  return contributions.map((contribution, k) => {
    const points: ProjectionPoint[] = byMonthAll[k].map((valuesOfMonth, month) => {
      const [p10, p50, p90] = percentilesOf(valuesOfMonth, PERCENTILE_QS)
      return { month, p10, p50, p90 }
    })
    return {
      points,
      successProb: retireSuccess[k] / sims,
      accumulationSuccessProb: accumSuccess[k] / sims,
      retirementSuccessProb: retireSuccess[k] / sims,
      requiredMonthly,
      projectedMedian: points[months]?.p50 ?? current,
      fundedRatio: fireNumberToday > 0 ? current / fireNumberToday : 1,
      fireNumberToday,
      fireNumberAtRetirement,
      annualPortfolioSpendToday,
      coastFireNumber,
      estimatedFireMonths: estimatedFireMonthsFor(contribution),
    }
  })
}

export function monthsBetween(from: Date, to: Date): number {
  const m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  return Math.max(0, m)
}
