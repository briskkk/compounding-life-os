// 基金盘中估值引擎（内部模型）：
//   估算涨幅 = Σ（重仓股权重 × 个股涨幅）+ 残差仓位 × 参考指数涨幅
//   置信度 = 已定价重仓权重 / 股票仓位（持仓为季度披露，存在滞后，仅供盘中参考）
export interface FundHolding {
  code: string
  name: string
  weightPct: number // 占基金净值 %
}

export interface Contribution {
  code: string
  name: string
  weightPct: number
  changePct: number | null
  contributionPct: number // 对估算涨幅的贡献（百分点）
}

export interface InternalEstimate {
  estimateReturnPct: number // 估算涨跌幅 %
  estimatedNav: number
  confidencePct: number // 0-100
  contributions: Contribution[]
  residualPct: number // 残差仓位 %
  coveredPct: number // 已定价重仓权重 %
}

export interface EstimateInput {
  holdings: FundHolding[]
  equityRatioPct: number // 股票仓位 %（最近季报）
  indexChangePct: number // 残差参考指数涨跌幅 %
  stockChanges: Map<string, number> // code → 涨跌幅 %
  prevNav: number
}

export function estimateFund(input: EstimateInput): InternalEstimate {
  const { holdings, equityRatioPct, indexChangePct, stockChanges, prevNav } = input
  const contributions: Contribution[] = []
  let stockPart = 0
  let covered = 0

  for (const h of holdings) {
    const change = stockChanges.get(h.code) ?? null
    const effective = change ?? indexChangePct // 无报价时以指数代理
    if (change != null) covered += h.weightPct
    const contributionPct = (h.weightPct * effective) / 100
    stockPart += contributionPct
    contributions.push({ code: h.code, name: h.name, weightPct: h.weightPct, changePct: change, contributionPct })
  }

  const totalHoldings = holdings.reduce((s, h) => s + h.weightPct, 0)
  const residualPct = Math.max(0, equityRatioPct - totalHoldings)
  const estimateReturnPct = stockPart + (residualPct * indexChangePct) / 100
  const confidencePct = equityRatioPct > 0 ? Math.min(95, (covered / equityRatioPct) * 100) : 0

  contributions.sort((a, b) => b.contributionPct - a.contributionPct)
  return {
    estimateReturnPct,
    estimatedNav: prevNav * (1 + estimateReturnPct / 100),
    confidencePct,
    contributions,
    residualPct,
    coveredPct: covered,
  }
}

// ---------- 联接基金（目标 ETF 驱动） ----------

/**
 * 联接基金估算：估算涨幅 = 目标ETF涨幅 × 目标仓位（现金残差按 0 变动保守处理）
 * 单一透明目标 → 高置信（封顶 95）
 */
export function estimateLinkedFund(input: {
  etfCode: string
  etfName: string
  etfChangePct: number | null
  weightPct: number // 目标ETF占净值 %（联接基金股票仓位近似）
  prevNav: number
}): InternalEstimate {
  const { etfCode, etfName, etfChangePct, weightPct, prevNav } = input
  const change = etfChangePct ?? 0
  const estimateReturnPct = (change * weightPct) / 100
  return {
    estimateReturnPct,
    estimatedNav: prevNav * (1 + estimateReturnPct / 100),
    confidencePct: Math.min(95, weightPct),
    contributions: [
      {
        code: etfCode,
        name: etfName,
        weightPct,
        changePct: etfChangePct,
        contributionPct: estimateReturnPct,
      },
    ],
    residualPct: Math.max(0, 100 - weightPct),
    coveredPct: weightPct,
  }
}

// ---------- 分钟级估值序列 ----------

export interface MinuteSeries {
  points: { t: number; price: number }[]
  prevClose: number | null
}

/**
 * 由重仓股与指数的分钟线合成基金估值分钟序列
 * （时间轴取指数分钟线；个股向前填补；无分钟数据的重仓股用其当日涨幅常数）
 */
export function estimateMinuteSeries(
  holdings: FundHolding[],
  equityRatioPct: number,
  prevNav: number,
  stockSeries: Map<string, MinuteSeries>,
  indexSeries: MinuteSeries,
  indexPrevClose: number,
): { t: number; price: number }[] {
  if (indexSeries.points.length === 0 || indexPrevClose <= 0) return []
  const cursors = new Map<string, { idx: number; last: number | null }>()
  for (const h of holdings) cursors.set(h.code, { idx: 0, last: null })

  const out: { t: number; price: number }[] = []
  for (const ip of indexSeries.points) {
    const indexChange = ip.price / indexPrevClose - 1
    let stockPart = 0
    for (const h of holdings) {
      const s = stockSeries.get(h.code)
      const cur = cursors.get(h.code)!
      if (s) {
        while (cur.idx < s.points.length && s.points[cur.idx].t <= ip.t) {
          cur.last = s.points[cur.idx].price
          cur.idx++
        }
      }
      const change = cur.last != null && s?.prevClose ? cur.last / s.prevClose - 1 : indexChange
      stockPart += h.weightPct * change
    }
    const totalHoldings = holdings.reduce((sum, h) => sum + h.weightPct, 0)
    const residual = Math.max(0, equityRatioPct - totalHoldings)
    const estReturn = (stockPart + residual * indexChange) / 100
    out.push({ t: ip.t, price: prevNav * (1 + estReturn) })
  }
  return out
}
