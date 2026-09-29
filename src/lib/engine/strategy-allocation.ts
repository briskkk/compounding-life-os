export const UNASSIGNED_STRATEGY = '未分组'

export function strategyName(value: string | null | undefined): string {
  return value?.trim() || UNASSIGNED_STRATEGY
}

export interface StrategyTargetInput {
  name: string
  targetWeight: number
  tolerance: number
}

export interface StrategyDriftRow extends StrategyTargetInput {
  currentAmount: number
  currentWeight: number
  driftWeight: number
  status: 'IN_RANGE' | 'OVER' | 'UNDER'
}

/** 互斥组合分组的当前权重与用户目标；标签的多归属不能用于 100% 权重目标。 */
export function buildStrategyDrift(
  current: { name: string; amount: number }[],
  targets: StrategyTargetInput[],
): { currentTotal: number; targetTotal: number; configured: boolean; rows: StrategyDriftRow[]; outOfRangeCount: number } {
  const amounts = new Map<string, number>()
  for (const item of current) {
    const name = strategyName(item.name)
    amounts.set(name, (amounts.get(name) ?? 0) + Math.max(0, item.amount))
  }
  const targetByName = new Map(targets.map((target) => [target.name, target]))
  const names = [...new Set([...amounts.keys(), ...targetByName.keys()])]
  const currentTotal = [...amounts.values()].reduce((sum, amount) => sum + amount, 0)
  const rows = names.map((name): StrategyDriftRow => {
    const currentAmount = amounts.get(name) ?? 0
    const currentWeight = currentTotal > 0 ? currentAmount / currentTotal : 0
    const target = targetByName.get(name) ?? { name, targetWeight: 0, tolerance: 0.03 }
    const driftWeight = currentWeight - target.targetWeight
    return {
      ...target,
      currentAmount,
      currentWeight,
      driftWeight,
      status: Math.abs(driftWeight) <= target.tolerance ? 'IN_RANGE' : driftWeight > 0 ? 'OVER' : 'UNDER',
    }
  }).sort((a, b) => b.currentAmount - a.currentAmount || a.name.localeCompare(b.name))
  return {
    currentTotal,
    targetTotal: targets.reduce((sum, target) => sum + target.targetWeight, 0),
    configured: targets.length > 0,
    rows,
    outOfRangeCount: targets.length > 0 ? rows.filter((row) => row.status !== 'IN_RANGE').length : 0,
  }
}
