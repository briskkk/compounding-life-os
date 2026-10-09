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
  trades?: IntradayTrade[]
}

export interface IntradayTrade {
  t: number
  quantityDelta: number
  cashFlowCny: number // 成交价和账本费用派生，已经折成人民币
}

export interface CurvePoint {
  t: number
  value: number // 组合市值（人民币）
  pnl: number // 相对昨收的当日盈亏（人民币）
}

/** 单标的当日盈亏序列（人民币），与组合曲线共用同一条时间轴。 */
export interface IntradaySeriesPoint {
  t: number
  pnl: number | null // 该时刻没有该标的的分钟数据时为 null（前端按断开处理）
}

export interface IntradayCurves {
  curve: CurvePoint[]
  /** symbol → 该标的当日盈亏序列；只在传了 trackSymbols 时计算。 */
  series: Map<string, IntradaySeriesPoint[]>
}

/**
 * 合成组合当日曲线：
 * - 时间轴为各标的分钟点的并集（逐标的向前填补价格）
 * - 无分时数据的持仓以 constantValueCny 计入市值，其当日盈亏以 constantPnlCny 计入曲线
 * - 按交易时刻还原持仓；盈亏 = 当前持仓市值 − 昨仓昨收市值 + 已发生交易净现金流
 * - 静态资产保持当前值；曲线市值是持仓估算，不重建历史现金余额
 * - 昨收缺失时以该标的首个分钟价为基线，避免把全部市值误判为当日盈利
 */
export function buildPortfolioCurve(
  holdings: CurveHolding[],
  series: Map<string, IntradayPoint[]>,
  constantValueCny: number,
  constantPnlCny = 0,
): CurvePoint[] {
  return buildIntradayCurves(holdings, series, constantValueCny, constantPnlCny).curve
}

/**
 * 同 buildPortfolioCurve，但额外返回逐标的当日盈亏序列，供看盘表格「点行看该标的曲线」使用。
 * 盈亏口径与组合曲线完全一致（同一昨收基线、同一汇率、同一分钟点），
 * 因此选中标的后曲线末点与表格里的当日盈亏必然相等；分钟点缺失处为 null 而不是 0。
 */
export function buildIntradayCurves(
  holdings: CurveHolding[],
  series: Map<string, IntradayPoint[]>,
  constantValueCny: number,
  constantPnlCny = 0,
  trackSymbols: Set<string> = new Set(),
): IntradayCurves {
  const withSeries = holdings.filter((h) => (series.get(h.symbol)?.length ?? 0) > 0)
  if (withSeries.length === 0) return { curve: [], series: new Map() }

  // 并集时间轴
  const times = new Set<number>()
  for (const h of withSeries) for (const p of series.get(h.symbol)!) times.add(p.t)
  const timeline = [...times].sort((a, b) => a - b)

  // 每标的游标；同时记住该标的的基准价（昨收，缺失时取首个分钟价）
  const cursors = new Map<string, {
    idx: number; last: number | null; reference: number | null
    trades: IntradayTrade[]; tradeIdx: number; openingQty: number; qty: number; cashFlowCny: number
  }>()
  for (const h of withSeries) {
    const trades = [...(h.trades ?? [])].sort((a, b) => a.t - b.t)
    const openingQty = h.qty - trades.reduce((sum, trade) => sum + trade.quantityDelta, 0)
    cursors.set(h.symbol, {
      idx: 0,
      last: null,
      reference: h.prevClose ?? series.get(h.symbol)?.[0]?.price ?? null,
      trades, tradeIdx: 0, openingQty, qty: openingQty, cashFlowCny: 0,
    })
  }
  const tracked = new Map<string, IntradaySeriesPoint[]>()
  for (const h of withSeries) if (trackSymbols.has(h.symbol)) tracked.set(h.symbol, [])
  const out: CurvePoint[] = []
  for (const t of timeline) {
    let value = constantValueCny
    let pnl = constantPnlCny
    for (const h of withSeries) {
      const points = series.get(h.symbol)!
      const cur = cursors.get(h.symbol)!
      let hasMinute = false
      while (cur.idx < points.length && points[cur.idx].t <= t) {
        cur.last = points[cur.idx].price
        hasMinute = points[cur.idx].t === t
        cur.idx++
      }
      while (cur.tradeIdx < cur.trades.length && cur.trades[cur.tradeIdx].t <= t) {
        const trade = cur.trades[cur.tradeIdx++]
        cur.qty += trade.quantityDelta
        cur.cashFlowCny += trade.cashFlowCny
      }
      const price = cur.last ?? cur.reference
      const assetValue = price == null ? 0 : cur.qty * price * h.rateToCny
      const assetPnl = cur.reference == null ? 0
        : assetValue - cur.openingQty * cur.reference * h.rateToCny + cur.cashFlowCny
      value += assetValue
      pnl += assetPnl
      tracked.get(h.symbol)?.push({
        t, pnl: hasMinute && cur.reference != null ? Math.round(assetPnl * 100) / 100 : null,
      })
    }
    out.push({
      t,
      value: Math.round(value * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
    })
  }

  return { curve: out, series: tracked }
}
