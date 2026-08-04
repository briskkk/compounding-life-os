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

// ---------- 组合基准对比 ----------

export interface BenchmarkIndex {
  symbol: string // 行情代码（parseSymbol → INDEX 市场）
  label: string
}

/** 可选基准指数：沪深300 / 上证指数 / 创业板指 / 科创50 */
export const BENCHMARK_INDICES: BenchmarkIndex[] = [
  { symbol: 'sh000300', label: '沪深300' },
  { symbol: 'sh000001', label: '上证指数' },
  { symbol: 'sz399006', label: '创业板指' },
  { symbol: 'sh000688', label: '科创50' },
]

export const DEFAULT_BENCHMARK_SYMBOL = 'sh000300'

export interface BenchmarkPoint {
  date: string // YYYY-MM-DD
  close: number
}

/** 加载完成的一组基准序列（点数 ≥ 2 才会传入 UI） */
export interface LoadedBenchmark extends BenchmarkIndex {
  points: BenchmarkPoint[]
}

/**
 * 逐日基准累计收益率：基准净值为曲线首日（期初基准日）当天或之前最近的收盘价；
 * 非交易日沿用前一收盘价。基准日之前无任何收盘价时整列返回 null（调用方不展示基准）。
 */
export function alignBenchmark(curveDates: string[], points: BenchmarkPoint[]): (number | null)[] {
  if (curveDates.length === 0 || points.length === 0) return curveDates.map(() => null)
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))

  // 交易日表不一定覆盖每个曲线日期：游标式「任意日期 → 当天或之前最近收盘」（曲线日期升序）
  let cursor = 0
  let lastClose: number | null = null
  const lookup = (date: string): number | null => {
    while (cursor < sorted.length && sorted[cursor].date <= date) {
      lastClose = sorted[cursor].close
      cursor += 1
    }
    return lastClose
  }

  const base = lookup(curveDates[0])
  if (base == null || base <= 0) return curveDates.map(() => null)
  return curveDates.map((date) => {
    const close = lookup(date)
    return close == null ? null : close / base - 1
  })
}
