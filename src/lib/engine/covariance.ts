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
  RSU: { mu: 0.1, sigma: 0.45 },
}

export const CLASSES: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE', 'RSU']

/** 类别相关矩阵（顺序同 CLASSES） */
export const CORR: number[][] = [
  // STOCK  FUND   ETF   CASH  GOLD   RE     RSU
  [1, 0.85, 0.88, 0, 0.1, 0.2, 0.6],
  [0.85, 1, 0.9, 0, 0.12, 0.18, 0.55],
  [0.88, 0.9, 1, 0, 0.1, 0.18, 0.55],
  [0, 0, 0, 1, 0, 0, 0],
  [0.1, 0.12, 0.1, 0, 1, 0.15, 0.08],
  [0.2, 0.18, 0.18, 0, 0.15, 1, 0.12],
  [0.6, 0.55, 0.55, 0, 0.08, 0.12, 1],
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

/**
 * 生成组合月收益采样器：r = Σ wᵢ·(μᵢ/12 + σᵢ/√12·eᵢ)，e = L·z 为相关标准冲击
 * 同一 seed 的采样器序列恒定（可复现）
 */
export function portfolioReturnSampler(weights: ClassWeights, seed: number): () => number {
  const L = cholesky(CORR)
  const active = CLASSES.filter((c) => (weights[c] ?? 0) > 1e-9)
  const total = active.reduce((s, c) => s + (weights[c] ?? 0), 0)
  const w = active.map((c) => ({ i: CLASSES.indexOf(c), w: (weights[c] ?? 0) / (total || 1), cls: c }))
  const rand = mulberry32(seed >>> 0)
  return () => {
    const z = CLASSES.map(() => gaussian(rand))
    let r = 0
    for (const { i, w: wi, cls } of w) {
      let e = 0
      for (let k = 0; k <= i; k++) e += L[i][k] * z[k]
      const p = CLASS_PARAMS[cls]
      r += wi * (p.mu / 12 + (p.sigma / Math.sqrt(12)) * e)
    }
    return r
  }
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
