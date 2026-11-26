// 基金申购/赎回的确认与到账推算（ADR-012）
// 纯函数、零依赖：Web 表单与移动端共用同一套确认口径。
// 交易日历采用已公布的中国市场休市安排；覆盖范围外明确回退周末规则。
import { isChinaFundTradingDay } from './china-trading-calendar'
import { dateKeyAt } from './watch-market'

/** QDII 指数型基金的估值驱动表（仅用于可代理估值的纳指产品）。 */
export const QDII_INDEX_MAP: Record<string, { index: string; name: string }> = {
  '021000': { index: 'USNDX', name: '纳斯达克100' },
  '040046': { index: 'USNDX', name: '纳斯达克100' },
  '014978': { index: 'USNDX', name: '纳斯达克100' },
  '021778': { index: 'USNDX', name: '纳斯达克100' },
}

/**
 * 已核验的 QDII 基金代码。与估值驱动表分离：并非每只 QDII 都能用 USNDX 代理估值，
 * 但交易确认规则仍必须按 QDII 处理。代码优先可避免资产简称遗漏“QDII”时误判。
 */
export const QDII_FUND_SYMBOLS = new Set([
  '012348', // 天弘恒生科技指数发起式（QDII）A
  '014978', // 华安纳斯达克100ETF联接（QDII）C
  '019671', // 广发港股创新药ETF联接（QDII）C
  '021000', // 南方纳斯达克100指数发起（QDII）I
  '021778', // 广发纳指100ETF联接（QDII）人民币F
  '040046', // 华安纳斯达克100ETF联接（QDII）A
  '539001', // 建信纳斯达克100指数（QDII）A人民币
])

/** QDII 识别：已核验代码注册表优先，名称显式标注 QDII 作为新基金兜底。 */
export function isQdiiFund(symbol: string, name?: string): boolean {
  const normalized = symbol.trim().toUpperCase()
  if (QDII_FUND_SYMBOLS.has(normalized)) return true
  return name != null && /QDII/i.test(name)
}

const DAY = 86400000

function dayStart(d: Date): Date {
  return new Date(`${dateKeyAt(d)}T00:00:00+08:00`)
}

export function isWeekend(d: Date): boolean {
  const day = new Date(`${dateKeyAt(d)}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/** 下一个中国基金通用开放日；基金特有境外暂停日仍以基金公司公告为准。 */
export function nextTradingDay(d: Date): Date {
  let x = dayStart(d)
  do {
    x = new Date(x.getTime() + DAY)
  } while (!isChinaFundTradingDay(x))
  return x
}

/** 15:00 收盘临界点：之后下单视为次一交易日订单 */
export function isBeforeCutoff(at: Date): boolean {
  return (at.getUTCHours() + 8) % 24 < 15
}

/**
 * 成交净值所属日：
 * - 当日 15:00 前下单 → 采用当日净值（navDate = 下单日，需为工作日）
 * - 15:00 后或非工作日 → 采用次一交易日净值
 * - QDII 的 T+2 是确认完成时间，不改变成交净值所属日
 */
export function fundNavDate(orderDate: Date, opts: { qdii: boolean; submittedAt?: Date }): Date {
  const submittedAt = opts.submittedAt ?? orderDate
  let nav = dayStart(orderDate)
  if (!isChinaFundTradingDay(nav) || !isBeforeCutoff(submittedAt)) nav = nextTradingDay(nav)
  return nav
}

/** 份额确认完成日：普通基金通常 T+1，QDII 通常 T+2；与成交净值所属日分开。 */
export function fundConfirmationDate(navDate: Date, opts: { qdii: boolean }): Date {
  let confirmation = dayStart(navDate)
  const tradingDays = opts.qdii ? 2 : 1
  for (let i = 0; i < tradingDays; i++) confirmation = nextTradingDay(confirmation)
  return confirmation
}

/**
 * 预计资金到账日（赎回在途）：
 * - 普通基金：确认日后 2 个工作日（份额确认 T+1、划款再到 T+2~T+4，取常用值）
 * - QDII：确认日后 7 个自然日（海外结算 T+7~T+10，取常用值）
 */
export function fundSettlementDate(navDate: Date, opts: { qdii: boolean }): Date {
  if (opts.qdii) return new Date(dayStart(navDate).getTime() + 7 * DAY)
  let d = navDate
  for (let i = 0; i < 2; i++) d = nextTradingDay(d)
  return d
}

/** 按金额申购的预计份额（基金份额按两位小数确认） */
export function estimateShares(amount: number, nav: number): number {
  if (nav <= 0) return 0
  return Math.round((amount / nav) * 100) / 100
}
