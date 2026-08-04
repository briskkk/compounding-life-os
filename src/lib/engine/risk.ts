// 组合风险指标：最大回撤 / 年化波动率 / 夏普比率
// 输入为 TWR 曲线（period-performance 的 curve），与历史收益同口径、同区间。

export interface RiskCurvePoint {
  date: string // YYYY-MM-DD
  pct: number // 区间累计收益率（相对期初基准）
  dailyPct: number | null // 当日收益率；期初基准点为 null
}

export interface RiskMetrics {
  maxDrawdown: number | null // 负值，如 -0.182；曲线单调上行时为 0
  volatility: number | null // 年化波动率（日收益样本标准差 × √252）
  sharpe: number | null // （年化收益 − 无风险利率）/ 年化波动率
}

const TRADING_DAYS = 252

/** 无风险利率假设：约等于国内货币基金/短债年化，用于夏普比率 */
export const RISK_FREE_ANNUAL = 0.02

export function riskMetrics(curve: RiskCurvePoint[], riskFreeAnnual: number = RISK_FREE_ANNUAL): RiskMetrics {
  const empty: RiskMetrics = { maxDrawdown: null, volatility: null, sharpe: null }
  if (curve.length < 2) return empty

  // 最大回撤：累计净值曲线（1 + pct）相对历史峰值的最大跌幅
  let peak = 1
  let maxDrawdown = 0
  for (const point of curve) {
    const level = 1 + point.pct
    if (level > peak) peak = level
    const drawdown = level / peak - 1
    if (drawdown < maxDrawdown) maxDrawdown = drawdown
  }

  // 年化波动率：有效日收益的样本标准差 × √252
  const dailyReturns = curve.map((point) => point.dailyPct).filter((r): r is number => r != null && Number.isFinite(r))
  if (dailyReturns.length < 2) return { maxDrawdown, volatility: null, sharpe: null }
  const mean = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
  const volatility = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS)

  // 夏普：区间累计收益按实际天数年化后减无风险利率，再除以年化波动率
  const totalReturn = curve[curve.length - 1].pct
  const days = (new Date(`${curve[curve.length - 1].date}T00:00:00Z`).getTime() - new Date(`${curve[0].date}T00:00:00Z`).getTime()) / 86400000
  let sharpe: number | null = null
  if (volatility > 0 && days > 0 && totalReturn > -1) {
    const annualizedReturn = Math.pow(1 + totalReturn, 365 / days) - 1
    sharpe = (annualizedReturn - riskFreeAnnual) / volatility
  }

  return { maxDrawdown, volatility, sharpe }
}
