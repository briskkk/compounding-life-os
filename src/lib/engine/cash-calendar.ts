// 资金日历：只呈现账本里真实发生的资金活动。
//
// 口径（刻意收窄，避免把计划当成事实）：
// - 只收「实际买卖」与「赎回到账在途」两类事件；定投计划节点、手工资金计划都不进日历。
//   计划只存在于计划层，日历不替它们占格，也不会把未发生的事显示成金额。
// - 买入/卖出事件带原币金额与币种，人民币金额按调用方给的汇率折算，仅用于同屏比较。
// - 汇总只做金额合计：买入、卖出、待到账；不推导月末余额，也不与计划额做差。
export type CashDirection = 'INFLOW' | 'OUTFLOW' | 'MILESTONE'
export type CashRecurrence = 'NONE' | 'MONTHLY' | 'YEARLY'

export interface SettlementInput {
  id: string
  title: string
  amountCny: number
  dueDate: Date
}

export interface TradeInput {
  id: string
  title: string
  type: 'BUY' | 'SELL'
  amount: number
  amountCny: number
  currency: string
  occurredAt: Date
  accountName: string
  relatedPlanName: string | null
  pending: boolean
}

export interface CashCalendarEvent {
  id: string
  title: string
  direction: CashDirection
  amountCny: number
  amount: number
  currency: string
  date: Date
  source: 'SETTLEMENT' | 'TRADE'
  accountName: string | null
  /** 赎回在途到账的说明；实际买卖为 null。 */
  note: string | null
  /** 定投计划匹配结果：只作为「这笔实际买入对应哪个计划」的标注，不是计划事件。 */
  relatedPlanName: string | null
  pending: boolean
}

export interface CashCalendarResult {
  month: string
  events: CashCalendarEvent[]
  /** 本月实际买入合计（人民币）。 */
  actualBuy: number
  /** 本月实际卖出合计（人民币）。 */
  actualSell: number
  /** 本月赎回到账在途合计（人民币）。 */
  settlementInflow: number
  tradeCount: number
  buyCount: number
  sellCount: number
  /** 对应到定投计划的实际买入笔数。 */
  linkedBuyCount: number
  settlementCount: number
}

function monthParts(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new Error('月份格式必须为 YYYY-MM')
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) throw new Error('月份格式必须为 YYYY-MM')
  return { year, monthIndex }
}

function inMonth(date: Date, year: number, monthIndex: number): boolean {
  return date.getFullYear() === year && date.getMonth() === monthIndex
}

export function buildCashCalendar(
  month: string,
  settlements: SettlementInput[] = [],
  trades: TradeInput[] = [],
): CashCalendarResult {
  const { year, monthIndex } = monthParts(month)
  const events: CashCalendarEvent[] = []

  for (const settlement of settlements) {
    if (!inMonth(settlement.dueDate, year, monthIndex)) continue
    events.push({
      id: `settlement:${settlement.id}`,
      title: settlement.title,
      direction: 'INFLOW',
      amountCny: settlement.amountCny,
      amount: settlement.amountCny,
      currency: 'CNY',
      date: settlement.dueDate,
      source: 'SETTLEMENT',
      accountName: null,
      note: '由基金赎回结算日派生，到账后自动从日历移除',
      relatedPlanName: null,
      pending: false,
    })
  }

  for (const trade of trades) {
    if (!inMonth(trade.occurredAt, year, monthIndex)) continue
    events.push({
      id: `trade:${trade.id}`,
      title: trade.title,
      direction: trade.type === 'BUY' ? 'OUTFLOW' : 'INFLOW',
      amountCny: trade.amountCny,
      amount: trade.amount,
      currency: trade.currency,
      date: trade.occurredAt,
      source: 'TRADE',
      accountName: trade.accountName,
      note: null,
      relatedPlanName: trade.relatedPlanName,
      pending: trade.pending,
    })
  }

  // 同一天先列实际买卖，再列赎回到账；同源内按名称稳定排序
  const sourceOrder = { TRADE: 0, SETTLEMENT: 1 } as const
  events.sort((a, b) => (
    new Date(a.date.getFullYear(), a.date.getMonth(), a.date.getDate()).getTime()
    - new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate()).getTime()
    || sourceOrder[a.source] - sourceOrder[b.source]
    || a.title.localeCompare(b.title, 'zh-CN')
  ))

  const tradeEvents = events.filter((event) => event.source === 'TRADE')
  const buyEvents = tradeEvents.filter((event) => event.direction === 'OUTFLOW')
  const sellEvents = tradeEvents.filter((event) => event.direction === 'INFLOW')
  const settlementEvents = events.filter((event) => event.source === 'SETTLEMENT')

  return {
    month,
    events,
    actualBuy: buyEvents.reduce((sum, event) => sum + event.amountCny, 0),
    actualSell: sellEvents.reduce((sum, event) => sum + event.amountCny, 0),
    settlementInflow: settlementEvents.reduce((sum, event) => sum + event.amountCny, 0),
    tradeCount: tradeEvents.length,
    buyCount: buyEvents.length,
    sellCount: sellEvents.length,
    linkedBuyCount: buyEvents.filter((event) => event.relatedPlanName != null).length,
    settlementCount: settlementEvents.length,
  }
}
