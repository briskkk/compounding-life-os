// 组合当日行情汇总：统一终端首页与看盘页的市值、昨收基准和盈亏口径
export interface DailyValuationItem {
  currentValueCny: number
  previousValueCny: number | null
}

export interface DailyPortfolioSummary {
  valueCny: number
  baselineCny: number
  pnlCny: number
  pnlPct: number | null
}

/**
 * 静态资产只计入当前市值与昨收基准；行情资产缺少昨收时按零当日盈亏处理。
 */
export function summarizeDailyPortfolio(
  items: DailyValuationItem[],
  staticValueCny: number,
): DailyPortfolioSummary {
  const valueCny = staticValueCny + items.reduce((sum, item) => sum + item.currentValueCny, 0)
  const pnlCny = items.reduce(
    (sum, item) => sum + (item.previousValueCny == null ? 0 : item.currentValueCny - item.previousValueCny),
    0,
  )
  const baselineCny = valueCny - pnlCny
  return {
    valueCny,
    baselineCny,
    pnlCny,
    pnlPct: baselineCny > 0 ? pnlCny / baselineCny : null,
  }
}
