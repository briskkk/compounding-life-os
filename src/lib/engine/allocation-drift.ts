import type { AssetClass } from './types'

export const ALLOCATION_TARGET_CLASSES: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD']

export interface AllocationCurrentInput {
  cls: AssetClass
  amount: number
}

export interface AllocationTargetInput {
  cls: AssetClass
  targetWeight: number
  tolerance: number
}

export type AllocationDriftStatus = 'IN_RANGE' | 'OVER' | 'UNDER'

export interface AllocationDriftRow extends AllocationTargetInput {
  currentAmount: number
  currentWeight: number
  driftWeight: number
  driftAmount: number
  status: AllocationDriftStatus
}

export interface AllocationDriftResult {
  configured: boolean
  currentTotal: number
  targetTotal: number
  rows: AllocationDriftRow[]
  outOfRangeCount: number
  largestDrift: AllocationDriftRow | null
}

/**
 * 目标配置是观察基准，不是交易指令。未配置目标时不把当前配置误判为偏离。
 * 在途资金按现金计入当前配置，保持与可投资口径一致。
 */
export function buildAllocationDrift(
  current: AllocationCurrentInput[],
  targets: AllocationTargetInput[],
  inTransit = 0,
): AllocationDriftResult {
  const currentByClass = new Map<AssetClass, number>()
  for (const item of current) {
    currentByClass.set(item.cls, (currentByClass.get(item.cls) ?? 0) + Math.max(0, item.amount))
  }
  if (inTransit > 0) {
    currentByClass.set('CASH', (currentByClass.get('CASH') ?? 0) + inTransit)
  }

  const currentTotal = ALLOCATION_TARGET_CLASSES.reduce((sum, cls) => sum + (currentByClass.get(cls) ?? 0), 0)
  const targetByClass = new Map(targets.map((target) => [target.cls, target]))
  const configured = targets.length > 0
  const rows = ALLOCATION_TARGET_CLASSES.map((cls) => {
    const target = targetByClass.get(cls) ?? { cls, targetWeight: 0, tolerance: 0.03 }
    const currentAmount = currentByClass.get(cls) ?? 0
    const currentWeight = currentTotal > 0 ? currentAmount / currentTotal : 0
    const driftWeight = currentWeight - target.targetWeight
    const status: AllocationDriftStatus = Math.abs(driftWeight) <= target.tolerance
      ? 'IN_RANGE'
      : driftWeight > 0 ? 'OVER' : 'UNDER'
    return {
      ...target,
      currentAmount,
      currentWeight,
      driftWeight,
      driftAmount: driftWeight * currentTotal,
      status,
    }
  })
  const outOfRange = configured ? rows.filter((row) => row.status !== 'IN_RANGE') : []

  return {
    configured,
    currentTotal,
    targetTotal: targets.reduce((sum, target) => sum + target.targetWeight, 0),
    rows,
    outOfRangeCount: outOfRange.length,
    largestDrift: outOfRange.sort((a, b) => Math.abs(b.driftWeight) - Math.abs(a.driftWeight))[0] ?? null,
  }
}
