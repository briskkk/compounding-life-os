const DAY = 86400000

/** 等距抽样并保留首尾点，仅用于展示曲线，不参与收益计算。 */
export function sampleSeries<T>(points: T[], cap: number): T[] {
  if (points.length <= cap) return points
  if (cap <= 1) return [points.at(-1)!]
  const lastIndex = points.length - 1
  const sampled: T[] = []
  for (let index = 0; index < cap; index++) {
    sampled.push(points[Math.round(index * lastIndex / (cap - 1))])
  }
  return sampled
}

/**
 * 总览财富曲线：近一年保留逐日精度，更早历史只保留趋势采样。
 * 返回值仅供图表显示，完整服务端序列仍用于归因和风险计算。
 */
export function compactRecentSeries<T extends { date: string }>(
  points: T[],
  options: { recentDays?: number; historicalCap?: number } = {},
): T[] {
  if (points.length < 2) return points
  const recentDays = options.recentDays ?? 370
  const historicalCap = options.historicalCap ?? 180
  const lastMs = new Date(`${points.at(-1)!.date}T00:00:00Z`).getTime()
  const cutoff = lastMs - recentDays * DAY
  const recentStart = points.findIndex((point) => (
    new Date(`${point.date}T00:00:00Z`).getTime() >= cutoff
  ))
  if (recentStart <= 0) return points
  return [
    ...sampleSeries(points.slice(0, recentStart), historicalCap),
    ...points.slice(recentStart),
  ]
}
