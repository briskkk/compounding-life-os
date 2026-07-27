// 残差代理指数自动选择：用基金官方净值日涨幅与候选指数日涨幅做相关性回归，取最优拟合
export interface DailyReturn {
  date: string // YYYY-MM-DD
  ret: number // 日涨幅（小数）
}

/** 由收盘价序列计算日涨幅序列（相邻交易日） */
export function closesToReturns(closes: { date: Date; close: number }[]): DailyReturn[] {
  const sorted = [...closes].sort((a, b) => a.date.getTime() - b.date.getTime())
  const out: DailyReturn[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].close
    if (prev > 0) {
      out.push({
        date: sorted[i].date.toISOString().slice(0, 10),
        ret: sorted[i].close / prev - 1,
      })
    }
  }
  return out
}

/** 皮尔逊相关系数（不足 2 点返回 0） */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma
    const xb = b[i] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  const denom = Math.sqrt(da * db)
  return denom > 0 ? num / denom : 0
}

export interface IndexFit {
  code: string
  correlation: number
  points: number
}

/**
 * 最优拟合指数：按日期连接净值涨幅与指数涨幅，取相关性最高者
 * 拟合点数 < minPoints 视为样本不足 → null（调用方回落默认指数）
 */
export function bestFitIndex(
  navReturns: DailyReturn[],
  indexReturnsByCode: Map<string, DailyReturn[]>,
  minPoints = 20,
): IndexFit | null {
  let best: IndexFit | null = null
  for (const [code, indexReturns] of indexReturnsByCode) {
    const navMap = new Map(navReturns.map((r) => [r.date, r.ret]))
    const pairs: [number, number][] = []
    for (const r of indexReturns) {
      const nav = navMap.get(r.date)
      if (nav != null) pairs.push([nav, r.ret])
    }
    if (pairs.length < minPoints) continue
    const correlation = pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1]))
    if (!best || correlation > best.correlation) best = { code, correlation, points: pairs.length }
  }
  return best
}
