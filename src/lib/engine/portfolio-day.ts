// 组合日（portfolio day）：某只资产的「今日盈亏」到底以哪一天为“今日”。
//
// 起因：此前所有资产都用**北京日期**判定 `tradingDate === today`。跨市场组合里这会系统性
// 冤枉海外持仓——美股的一个交易日在北京时间凌晨才结束，北京白天拿到的美股报价其
// `tradingDate` 是**上一个美股交易日**（如北京 09-16 10:00 → 美股 09-15），字符串不相等，
// 于是海外资产永远显示「—」，与真实涨跌无关。
//
// 规则：按该资产**计价市场的时区**取当天日期。
// - 美股（USD）：America/New_York —— 北京白天天然落在美股前一交易日 ✔
// - 港股（HKD）：Asia/Hong_Kong（与北京同日）✔
// - A 股 / 场外基金 / 黄金（CNY）：Asia/Shanghai ✔
// 周末或休市时，报价的 tradingDate 是上一个交易日 → 与市场当日不等 → 不计入当日盈亏（正确）。
import { dateKeyAt, exchangeTimeZone } from './watch-market'
import { parseSymbol } from '@/lib/market/symbols'

export interface PortfolioDayInput {
  symbol?: string
  currency?: string | null
  cls?: string | null
}

/** 该资产所在市场的时区 */
export function portfolioDayZone(input: PortfolioDayInput): string {
  if (input.currency) return exchangeTimeZone(input.currency, input.cls ?? '')
  const symbol = input.symbol ?? ''
  // 无币种信息时退回按代码前缀判断（US… / HK…）
  if (/^US/i.test(symbol)) return 'America/New_York'
  if (/^HK/i.test(symbol)) return 'Asia/Hong_Kong'
  try {
    const market = parseSymbol(symbol).market
    if (market === 'US') return 'America/New_York'
    if (market === 'HK') return 'Asia/Hong_Kong'
  } catch {
    /* 非法代码按本土处理 */
  }
  return 'Asia/Shanghai'
}

/** 该资产「今日」对应的交易日键（YYYY-MM-DD） */
export function portfolioDayKey(input: PortfolioDayInput, now: Date = new Date()): string {
  return dateKeyAt(now, portfolioDayZone(input))
}
