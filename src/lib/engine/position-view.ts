// 持仓视图装配：positions 列表与资产详情共享的纯函数（人民币口径）
import type { AssetClass } from './types'
import type { ValuedPosition } from './valuation'
import { livePreviousClose } from './portfolio-day'
import { dailyPnlBaseline } from './daily-trades'

/** 持仓项所需的报价视图（引擎里 EngineQuote 结构兼容，无需跨层引用） */
export interface PositionQuoteView {
  priceCny: number
  prevCloseCny: number
  tradingDate?: string | null
  source: string
  confidencePct?: number
}

export interface PositionItem {
  assetId: string
  symbol: string
  name: string
  cls: AssetClass
  quantity: number
  /** 可用份额：排除确认中的申购（基金 T+1/T+2），其余资产等于 quantity */
  availableQty: number
  avgCost: number | null
  marketValue: number
  dayPnl: number
  dayPnlPct: number | null
  source: string
  confidencePct: number | null
  manual: boolean
}

/** 将估值持仓 + 报价装配为 API 持仓项；归属日不是北京当天、或缺昨收时当日盈亏为 0、百分比为 null */
export function buildPositionItem(
  position: ValuedPosition,
  quote: PositionQuoteView | undefined,
  now: Date = new Date(),
): PositionItem {
  const previousCloseCny = livePreviousClose({
    asset: { symbol: position.asset.symbol, currency: position.asset.currency, cls: position.asset.cls },
    exchangeTradingDate: quote?.tradingDate,
    prevClose: quote?.prevCloseCny,
    now,
  })
  const previousValueCny = previousCloseCny == null ? null : dailyPnlBaseline(position.quantity, previousCloseCny, position.dailyActivity)
  const dayPnl = previousValueCny == null ? 0 : position.value - previousValueCny
  return {
    assetId: position.assetId,
    symbol: position.asset.symbol,
    name: position.asset.name,
    cls: position.asset.cls,
    quantity: position.quantity,
    availableQty: position.availableQty,
    avgCost: position.quantity > 0 ? position.costCny / position.quantity : null,
    marketValue: position.value,
    dayPnl,
    dayPnlPct: previousValueCny != null && previousValueCny > 0 ? dayPnl / previousValueCny : null,
    source: quote?.source ?? position.priceSource,
    confidencePct: quote?.confidencePct ?? null,
    manual: position.asset.manual,
  }
}

/** Bar 输入（provider 的 Bar 结构兼容，仅声明使用字段） */
export interface BarLike {
  date: Date
  close: number
  open?: number
  high?: number
  low?: number
}

export interface OhlcBar {
  date: string
  open: number
  high: number
  low: number
  close: number
}

/** K 线装配：缺少 OHLC 时用 close 补齐（场外基金净值序列因此表现为平线） */
export function toOhlcBars(bars: BarLike[]): OhlcBar[] {
  return bars.map((b) => ({
    date: b.date.toISOString().slice(0, 10),
    open: b.open ?? b.close,
    high: b.high ?? b.close,
    low: b.low ?? b.close,
    close: b.close,
  }))
}

export interface TradeMarkInput {
  occurredAt: Date
  type: 'BUY' | 'SELL'
  price: number | null
  quantity: number | null
}

export interface TradeMark {
  date: string
  type: 'BUY' | 'SELL'
  price: number | null
  quantity: number | null
}

/** 买卖点：BUY/SELL 流水按日期升序映射为图表标记 */
export function buildTradeMarks(txs: TradeMarkInput[]): TradeMark[] {
  return [...txs]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((t) => ({
      date: t.occurredAt.toISOString().slice(0, 10),
      type: t.type,
      price: t.price,
      quantity: t.quantity,
    }))
}
