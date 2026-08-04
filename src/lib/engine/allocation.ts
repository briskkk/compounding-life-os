// 目标配置偏离：当前六类资产权重 vs 目标权重，输出再平衡金额方向
import type { AssetClass } from './types'

export const ALLOCATION_CLASSES: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE']

/** 偏离带：|drift| 超过此值触发再平衡提醒 */
export const DRIFT_BAND = 0.05

export interface AllocationSlice {
  cls: AssetClass
  current: number
  target: number
  drift: number
  amountCny: number
}

/**
 * byClass 为各类市值（元），target 为权重（合计 1）；
 * drift = current − target（正 = 超配）；amountCny 正 = 需买入、负 = 需卖出。
 * 总市值非正时返回空数组。结果按 |drift| 降序。
 */
export function allocationDrift(byClass: Record<AssetClass, number>, target: Record<string, number>): AllocationSlice[] {
  const total = ALLOCATION_CLASSES.reduce((sum, cls) => sum + (byClass[cls] ?? 0), 0)
  if (total <= 0) return []
  return ALLOCATION_CLASSES.map((cls) => {
    const current = (byClass[cls] ?? 0) / total
    const t = target[cls] ?? 0
    const drift = current - t
    return { cls, current, target: t, drift, amountCny: -drift * total }
  }).sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
}
