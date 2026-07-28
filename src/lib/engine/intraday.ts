// 组合当日收益曲线：多标的分钟线 → 组合市值/盈亏时间序列（纯函数）
export interface IntradayPoint {
  t: number
  price: number
}

export interface CurveHolding {
  symbol: string
  qty: number // 持仓数量（取最新账本重放结果）
  rateToCny: number // 原币 → 人民币汇率
  prevClose: number | null // 昨收（原币）；缺失时该标的不计入盈亏基线
}

export interface CurvePoint {
  t: number
  value: number // 组合市值（人民币）
  pnl: number // 相对昨收的当日盈亏（人民币）
}

/**
 * 合成组合当日曲线：
 * - 时间轴为各标的分钟点的并集（逐标的向前填补价格）
 * - 无分时数据的持仓以 constantValueCny 计入市值，其当日盈亏以 constantPnlCny 计入曲线
 * - pnl(t) = value(t) − baseline；常量项基线 = constantValueCny − constantPnlCny
 * - 昨收缺失时以该标的首个分钟价为基线，避免把全部市值误判为当日盈利
 */
export function buildPortfolioCurve(
  holdings: CurveHolding[],
  series: Map<string, IntradayPoint[]>,
  constantValueCny: number,
  constantPnlCny = 0,
): CurvePoint[] {
  const withSeries = holdings.filter((h) => (series.get(h.symbol)?.length ?? 0) > 0)
  if (withSeries.length === 0) return []

  // 并集时间轴
  const times = new Set<number>()
  for (const h of withSeries) for (const p of series.get(h.symbol)!) times.add(p.t)
  const timeline = [...times].sort((a, b) => a - b)

  // 每标的游标
  const cursors = new Map<string, { idx: number; last: number | null }>()
  for (const h of withSeries) cursors.set(h.symbol, { idx: 0, last: null })

  const baseline =
    constantValueCny -
    constantPnlCny +
    withSeries.reduce((s, h) => {
      const referencePrice = h.prevClose ?? series.get(h.symbol)?.[0]?.price
      return s + (referencePrice != null ? h.qty * referencePrice * h.rateToCny : 0)
    }, 0)

  const out: CurvePoint[] = []
  for (const t of timeline) {
    let value = constantValueCny
    for (const h of withSeries) {
      const points = series.get(h.symbol)!
      const cur = cursors.get(h.symbol)!
      while (cur.idx < points.length && points[cur.idx].t <= t) {
        cur.last = points[cur.idx].price
        cur.idx++
      }
      const price = cur.last ?? h.prevClose
      if (price != null) value += h.qty * price * h.rateToCny
    }
    out.push({
      t,
      value: Math.round(value * 100) / 100,
      pnl: Math.round((value - baseline) * 100) / 100,
    })
  }
  return out
}
