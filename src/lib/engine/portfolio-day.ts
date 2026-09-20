// 组合日与「北京归属日」：一场交易算进哪一天，以**北京时间**为准（ADR-027）。
//
// 起因：此前按交易所交易日归属。美股一场（美东 D 日 09:30–16:00）实际发生在
// 北京 D 日 21:30 至 D+1 日 04:00/05:00，按美东日期会把北京次日凌晨才落定的
// 收益记进北京 D 日那一格，跨市场组合的日历、快照与实时口径因此对不上。
//
// 规则：一场交易按「数据在北京时间哪一天落定」归属。
// - A 股 / 港股 / 场外基金官方净值：北京同日 → 偏移 0。
// - 美股（US… 代码）：纽约收盘落在北京次日凌晨 → 偏移 +1，美东 D 日计入北京 D+1。
// PriceBar 仍保存交易所交易日（行情事实不改），偏移只作用于组合估值、收益日历与实时口径。
import { dateKeyAt } from './watch-market'
import { parseSymbol } from '@/lib/market/symbols'

export interface PortfolioDayInput {
  symbol?: string
  currency?: string | null
  cls?: string | null
}

function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 该资产一场交易按北京时间归属的日期偏移天数（0 或 1）。 */
export function portfolioDayOffset(input: PortfolioDayInput): 0 | 1 {
  const symbol = input.symbol?.trim() ?? ''
  if (!symbol || input.cls === 'CASH' || input.cls === 'REAL_ESTATE') return 0
  try {
    if (parseSymbol(symbol).market === 'US') return 1
  } catch {
    /* 非法代码按本土处理 */
  }
  return /^US[A-Z]/i.test(symbol) ? 1 : 0
}

/** 交易所交易日键（YYYY-MM-DD）→ 该场交易归属的北京日期键。 */
export function attributionDateKey(
  input: PortfolioDayInput,
  exchangeTradingDate: string | null | undefined,
): string | null {
  if (!exchangeTradingDate || !/^\d{4}-\d{2}-\d{2}$/.test(exchangeTradingDate)) return null
  const offset = portfolioDayOffset(input)
  return offset === 0 ? exchangeTradingDate : shiftDateKey(exchangeTradingDate, offset)
}

/**
 * 实时「今日涨跌」允许的归属日期键：恒含北京今天。
 * 美股另含归属北京明天的那一场——北京晚间 21:30 起美股正在进行，
 * 但按归属只能算进明天，实时口径必须容纳它，否则看盘在北京晚间回到「—」。
 */
export function liveAttributionDates(input: PortfolioDayInput, now: Date = new Date()): string[] {
  const today = dateKeyAt(now)
  return portfolioDayOffset(input) === 1 ? [today, shiftDateKey(today, 1)] : [today]
}

/** 报价此刻是否计入实时「今日涨跌」，及其归属的北京日期键。 */
export function liveQuoteAttribution(input: {
  asset: PortfolioDayInput
  exchangeTradingDate: string | null | undefined
  now?: Date
}): { attributionDate: string | null; included: boolean } {
  const attributionDate = attributionDateKey(input.asset, input.exchangeTradingDate)
  if (!attributionDate) return { attributionDate: null, included: false }
  const allowed = liveAttributionDates(input.asset, input.now ?? new Date())
  return { attributionDate, included: allowed.includes(attributionDate) }
}

/** 实时「今日涨跌」的昨收基线：报价不属于当前口径或昨收无效时返回 null（不虚构基准）。 */
export function livePreviousClose(input: {
  asset: PortfolioDayInput
  exchangeTradingDate: string | null | undefined
  prevClose: number | null | undefined
  now?: Date
}): number | null {
  if (!liveQuoteAttribution(input).included) return null
  const prevClose = input.prevClose
  return prevClose != null && Number.isFinite(prevClose) ? prevClose : null
}
