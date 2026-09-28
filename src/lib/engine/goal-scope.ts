export type GoalMode = 'LUMP_SUM' | 'STREAM'
export type GoalMetric = 'NET_WORTH' | 'INVESTABLE'

/**
 * 普通财富目标保留用户选择；退休现金流目标按家庭净资产计算，
 * 纳入员工持股、房产等长期资产，并沿用净资产已扣除负债的口径。
 * 这里仅决定计算口径，不改写已保存目标，避免读取页面时发生隐式写入。
 */
export function effectiveGoalMetric(mode: GoalMode, storedMetric: GoalMetric): GoalMetric {
  return mode === 'STREAM' ? 'NET_WORTH' : storedMetric
}

export function currentGoalCapital(
  mode: GoalMode,
  storedMetric: GoalMetric,
  balances: { netWorth: number; investable: number },
): { current: number; metric: GoalMetric; adjusted: boolean } {
  const metric = effectiveGoalMetric(mode, storedMetric)
  return {
    current: metric === 'NET_WORTH' ? balances.netWorth : balances.investable,
    metric,
    adjusted: metric !== storedMetric,
  }
}
