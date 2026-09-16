// 协方差组合模拟：按资产类别的期望/波动 + 相关矩阵，Cholesky 生成相关冲击
import { gaussian, mulberry32 } from './rng'
import type { AssetClass } from './types'

export interface ClassParam {
  mu: number // 年化期望收益
  sigma: number // 年化波动率
}

export const CLASS_PARAMS: Record<AssetClass, ClassParam> = {
  STOCK: { mu: 0.08, sigma: 0.28 },
  FUND: { mu: 0.06, sigma: 0.18 },
  ETF: { mu: 0.06, sigma: 0.17 },
  CASH: { mu: 0.015, sigma: 0.002 },
  GOLD: { mu: 0.07, sigma: 0.13 },
  REAL_ESTATE: { mu: 0.03, sigma: 0.06 },
  // 华为股票默认由手动估值进入净资产，不对非公开股价作收益假设。
  HUAWEI_STOCK: { mu: 0, sigma: 0.002 },
}

export const CLASSES: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE']

/** 类别相关矩阵（顺序同 CLASSES） */
export const CORR: number[][] = [
  // STOCK  FUND   ETF   CASH  GOLD   RE
  [1, 0.85, 0.88, 0, 0.1, 0.2],
  [0.85, 1, 0.9, 0, 0.12, 0.18],
  [0.88, 0.9, 1, 0, 0.1, 0.18],
  [0, 0, 0, 1, 0, 0],
  [0.1, 0.12, 0.1, 0, 1, 0.15],
  [0.2, 0.18, 0.18, 0, 0.15, 1],
]

/** Cholesky 分解：A = L·Lᵀ（返回下三角 L） */
export function cholesky(A: number[][]): number[][] {
  const n = A.length
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j]
    }
  }
  return L
}

export type ClassWeights = Partial<Record<AssetClass, number>>

// 相关矩阵恒为常量：Cholesky 只算一次，而不是每个 sim 重算（原先 1500 次/次投影）
const CHOLESKY_CORR = cholesky(CORR)

/**
 * 组合月收益采样器的**计划**：只依赖权重（与 seed 无关），因此每次投影构建一次、
 * 供全部 sim 复用（原先每个 sim 重跑一次 6×6 Cholesky）。
 *
 * 内层用扁平定长数组而不是对象数组：运算与顺序完全一致（同样的 `r += w·(μ + σ·e)`
 * 与同样的列升序累加），只是省掉属性查找与逐样本分配。
 */
const PLAN_CACHE = new Map<string, (seed: number) => () => number>()

function weightsKey(weights: ClassWeights): string {
  // 用字符串拼接而不是模板字面量，避免嵌套反引号
  return CLASSES.map((c) => c + ':' + (weights[c] ?? 0)).join('|')
}

export function portfolioSamplerFactory(weights: ClassWeights): (seed: number) => () => number {
  const key = weightsKey(weights)
  const cached = PLAN_CACHE.get(key)
  if (cached) return cached
  const built = buildPortfolioSamplerFactory(weights)
  if (PLAN_CACHE.size > 32) PLAN_CACHE.clear()
  PLAN_CACHE.set(key, built)
  return built
}

function buildPortfolioSamplerFactory(weights: ClassWeights): (seed: number) => () => number {
  const active = CLASSES.filter((c) => (weights[c] ?? 0) > 1e-9)
  const total = active.reduce((s, c) => s + (weights[c] ?? 0), 0)
  const termCount = active.length
  const termWeight = new Float64Array(termCount)
  const termMu = new Float64Array(termCount)
  const termSigma = new Float64Array(termCount)
  const termOffset = new Int32Array(termCount + 1)
  const colIndex: number[] = []
  const colCoef: number[] = []
  active.forEach((c, t) => {
    const i = CLASSES.indexOf(c)
    termOffset[t] = colIndex.length
    for (let k = 0; k <= i; k++) {
      const lik = CHOLESKY_CORR[i][k]
      if (lik !== 0) {
        colIndex.push(k)
        colCoef.push(lik)
      }
    }
    const p = CLASS_PARAMS[c]
    termWeight[t] = (weights[c] ?? 0) / (total || 1)
    termMu[t] = p.mu / 12
    termSigma[t] = p.sigma / Math.sqrt(12)
  })
  termOffset[termCount] = colIndex.length
  const cols = Int32Array.from(colIndex)
  const coefs = Float64Array.from(colCoef)
  const z = new Float64Array(CLASSES.length)
  const n = CLASSES.length

  return (seed: number) => {
    const rand = mulberry32(seed >>> 0)
    return () => {
      // 冲击顺序必须与 CLASSES 一致；数组复用只是省掉每次 6 个元素分配
      for (let i = 0; i < n; i++) z[i] = gaussian(rand)
      let r = 0
      for (let t = 0; t < termCount; t++) {
        let e = 0
        for (let j = termOffset[t]; j < termOffset[t + 1]; j++) e += coefs[j] * z[cols[j]]
        r += termWeight[t] * (termMu[t] + termSigma[t] * e)
      }
      return r
    }
  }
}

/**
 * 生成组合月收益采样器：r = Σ wᵢ·(μᵢ/12 + σᵢ/√12·eᵢ)，e = L·z 为相关标准冲击
 * 同一 seed 的采样器序列恒定（可复现）
 */
export function portfolioReturnSampler(weights: ClassWeights, seed: number): () => number {
  return portfolioSamplerFactory(weights)(seed)
}

/** 组合的期望年化与年化波动（用于展示） */
export function portfolioMoments(weights: ClassWeights): { mu: number; sigma: number } {
  const active = CLASSES.filter((c) => (weights[c] ?? 0) > 1e-9)
  const total = active.reduce((s, c) => s + (weights[c] ?? 0), 0)
  const w = new Map(active.map((c) => [c, (weights[c] ?? 0) / (total || 1)]))
  let mu = 0
  for (const [c, wc] of w) mu += wc * CLASS_PARAMS[c].mu
  let variance = 0
  for (const [ci, wi] of w) {
    for (const [cj, wj] of w) {
      const i = CLASSES.indexOf(ci)
      const j = CLASSES.indexOf(cj)
      variance += wi * wj * CLASS_PARAMS[ci].sigma * CLASS_PARAMS[cj].sigma * CORR[i][j]
    }
  }
  return { mu, sigma: Math.sqrt(Math.max(variance, 0)) }
}
