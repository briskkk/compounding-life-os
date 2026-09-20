// 组合当日行情汇总：统一终端首页与看盘页的市值、昨收基准和盈亏口径
import { livePreviousClose, liveQuoteAttribution, type PortfolioDayInput } from './portfolio-day'

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

export interface DailyQuoteBasis {
  /** 现价（与 quantity 同币种） */
  price: number
  /** 昨收（与 quantity 同币种）；缺失则不参与当日盈亏 */
  prevClose: number | null
  /** 该报价对应的**交易所交易日**（YYYY-MM-DD），归属偏移由 portfolio-day 计算 */
  tradingDate?: string | null
}

/**
 * 行情资产的当日估值与昨收基准的唯一判定（总览 / 看盘 / 收益日历 / 持仓 / 账户共用）。
 *
 * 此前总览走服务端一次取数、看盘在客户端用分时序列回退，`prevClose` 优先级不同
 * （分时昨收 > 报价昨收 > 服务端旧值 > 分时首点），导致同一时刻两条路径算出两套
 * 「今日涨跌」（实测可差到组合总市值的 −4.9%）。规则收敛为：
 * 1. 现价恒取报价；无报价时按给定回退市值计值，且**不参与**当日盈亏；
 * 2. 昨收必须与现价来自同一报价，且该报价的**北京归属日**属于当前实时口径
 *    （北京今天；美股另含北京晚间正在进行、归属明天的那一场，见 ADR-027）；
 * 3. 不再回退到分时序列或服务端旧值——回退会让「今日涨跌」代表不同的资产集合。
 */
export function dailyQuoteValuation(input: {
  quantity: number
  quote: DailyQuoteBasis | null | undefined
  fallbackValueCny: number
  /** 所属资产（代码 / 币种 / 类别）决定北京归属偏移 */
  asset: PortfolioDayInput
  /** 判定时点；缺省为当前时间 */
  now?: Date
  /** 报价为原币时传入当日汇率；报价已是人民币口径时省略 */
  rateToCny?: number
}): { currentValueCny: number; previousValueCny: number | null; included: boolean } {
  const rate = input.rateToCny ?? 1
  const quote = input.quote
  if (!quote || !Number.isFinite(quote.price)) {
    return { currentValueCny: input.fallbackValueCny, previousValueCny: null, included: false }
  }
  const currentValueCny = input.quantity * quote.price * rate
  const previousClose = livePreviousClose({
    asset: input.asset,
    exchangeTradingDate: quote.tradingDate ?? null,
    prevClose: quote.prevClose,
    now: input.now,
  })
  return {
    currentValueCny,
    previousValueCny: previousClose == null ? null : input.quantity * previousClose * rate,
    included: liveQuoteAttribution({
      asset: input.asset,
      exchangeTradingDate: quote.tradingDate ?? null,
      now: input.now,
    }).included,
  }
}
