export type CashDirection = 'INFLOW' | 'OUTFLOW' | 'MILESTONE'
export type CashRecurrence = 'NONE' | 'MONTHLY' | 'YEARLY'

export interface CashPlanInput {
  id: string
  title: string
  direction: CashDirection
  amountCny: number
  dueDate: Date
  recurrence: CashRecurrence
  endDate: Date | null
  accountName: string | null
  note: string | null
}

export interface SettlementInput {
  id: string
  title: string
  amountCny: number
  dueDate: Date
}

export type InvestmentPlanDayStatus = 'RECORDED' | 'CONFIRMED_NO_BUY' | 'UNRECORDED_DUE' | 'UPCOMING'

export interface InvestmentPlanScheduleInput {
  id: string
  planId: string
  title: string
  amount: number
  amountCny: number
  currency: string
  dueDate: Date
  accountName: string | null
  assetNames: string[]
  status: InvestmentPlanDayStatus
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
  planId: string | null
  title: string
  direction: CashDirection
  amountCny: number
  amount: number
  currency: string
  date: Date
  source: 'PLAN' | 'SETTLEMENT' | 'INVESTMENT_PLAN' | 'TRADE'
  recurrence: CashRecurrence
  accountName: string | null
  note: string | null
  investmentPlanId: string | null
  planStatus: InvestmentPlanDayStatus | null
  tradeType: 'BUY' | 'SELL' | null
  relatedPlanName: string | null
  pending: boolean
}

export interface CashCalendarResult {
  month: string
  events: CashCalendarEvent[]
  inflow: number
  outflow: number
  net: number
  confirmedInflow: number
  plannedInvestment: number
  actualBuy: number
  actualSell: number
  tradeCount: number
  linkedBuyCount: number
  planNodeCount: number
  recordedPlanNodes: number
  duePlanNodes: number
  pendingPlanNodes: number
}

function monthParts(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new Error('月份格式必须为 YYYY-MM')
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) throw new Error('月份格式必须为 YYYY-MM')
  return { year, monthIndex }
}

function localDate(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(day, lastDay), 12, 0, 0, 0)
}

function inMonth(date: Date, year: number, monthIndex: number): boolean {
  return date.getFullYear() === year && date.getMonth() === monthIndex
}

function occurrenceInMonth(plan: CashPlanInput, year: number, monthIndex: number): Date | null {
  const start = plan.dueDate
  const candidate = plan.recurrence === 'NONE'
    ? start
    : plan.recurrence === 'MONTHLY'
      ? localDate(year, monthIndex, start.getDate())
      : localDate(year, monthIndex, start.getDate())
  if (plan.recurrence === 'NONE' && !inMonth(candidate, year, monthIndex)) return null
  if (plan.recurrence === 'YEARLY' && start.getMonth() !== monthIndex) return null
  if (candidate.getTime() < new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) return null
  if (plan.endDate && candidate.getTime() > plan.endDate.getTime()) return null
  return candidate
}

export function buildCashCalendar(
  month: string,
  plans: CashPlanInput[],
  settlements: SettlementInput[] = [],
  investmentSchedules: InvestmentPlanScheduleInput[] = [],
  trades: TradeInput[] = [],
): CashCalendarResult {
  const { year, monthIndex } = monthParts(month)
  const events: CashCalendarEvent[] = []

  for (const plan of plans) {
    const date = occurrenceInMonth(plan, year, monthIndex)
    if (!date) continue
    events.push({
      id: `${plan.id}:${year}-${monthIndex + 1}`,
      planId: plan.id,
      title: plan.title,
      direction: plan.direction,
      amountCny: plan.amountCny,
      amount: plan.amountCny,
      currency: 'CNY',
      date,
      source: 'PLAN',
      recurrence: plan.recurrence,
      accountName: plan.accountName,
      note: plan.note,
      investmentPlanId: null,
      planStatus: null,
      tradeType: null,
      relatedPlanName: null,
      pending: false,
    })
  }

  for (const settlement of settlements) {
    if (!inMonth(settlement.dueDate, year, monthIndex)) continue
    events.push({
      id: `settlement:${settlement.id}`,
      planId: null,
      title: settlement.title,
      direction: 'INFLOW',
      amountCny: settlement.amountCny,
      amount: settlement.amountCny,
      currency: 'CNY',
      date: settlement.dueDate,
      source: 'SETTLEMENT',
      recurrence: 'NONE',
      accountName: null,
      note: '由基金赎回结算日派生，到账后自动从日历移除',
      investmentPlanId: null,
      planStatus: null,
      tradeType: null,
      relatedPlanName: null,
      pending: false,
    })
  }

  for (const schedule of investmentSchedules) {
    if (!inMonth(schedule.dueDate, year, monthIndex)) continue
    events.push({
      id: `investment-plan:${schedule.id}`,
      planId: null,
      title: schedule.title,
      direction: 'OUTFLOW',
      amountCny: schedule.amountCny,
      amount: schedule.amount,
      currency: schedule.currency,
      date: schedule.dueDate,
      source: 'INVESTMENT_PLAN',
      recurrence: 'NONE',
      accountName: schedule.accountName,
      note: schedule.assetNames.join(' / '),
      investmentPlanId: schedule.planId,
      planStatus: schedule.status,
      tradeType: null,
      relatedPlanName: null,
      pending: false,
    })
  }

  for (const trade of trades) {
    if (!inMonth(trade.occurredAt, year, monthIndex)) continue
    events.push({
      id: `trade:${trade.id}`,
      planId: null,
      title: trade.title,
      direction: trade.type === 'BUY' ? 'OUTFLOW' : 'INFLOW',
      amountCny: trade.amountCny,
      amount: trade.amount,
      currency: trade.currency,
      date: trade.occurredAt,
      source: 'TRADE',
      recurrence: 'NONE',
      accountName: trade.accountName,
      note: null,
      investmentPlanId: null,
      planStatus: null,
      tradeType: trade.type,
      relatedPlanName: trade.relatedPlanName,
      pending: trade.pending,
    })
  }

  const sourceOrder = { TRADE: 0, INVESTMENT_PLAN: 1, SETTLEMENT: 2, PLAN: 3 } as const
  events.sort((a, b) => (
    new Date(a.date.getFullYear(), a.date.getMonth(), a.date.getDate()).getTime()
    - new Date(b.date.getFullYear(), b.date.getMonth(), b.date.getDate()).getTime()
    || sourceOrder[a.source] - sourceOrder[b.source]
    || a.title.localeCompare(b.title, 'zh-CN')
  ))
  // 保留原有口径：inflow/outflow 只回答计划层现金事项 + 在途到账，不把已在现金余额中的真实交易重复计算。
  const cashEvents = events.filter((event) => event.source === 'PLAN' || event.source === 'SETTLEMENT')
  const inflow = cashEvents.filter((event) => event.direction === 'INFLOW').reduce((sum, event) => sum + event.amountCny, 0)
  const outflow = cashEvents.filter((event) => event.direction === 'OUTFLOW').reduce((sum, event) => sum + event.amountCny, 0)
  const confirmedInflow = events.filter((event) => event.source === 'SETTLEMENT').reduce((sum, event) => sum + event.amountCny, 0)
  const plannedInvestment = events.filter((event) => event.source === 'INVESTMENT_PLAN').reduce((sum, event) => sum + event.amountCny, 0)
  const tradeEvents = events.filter((event) => event.source === 'TRADE')
  const actualBuy = tradeEvents.filter((event) => event.tradeType === 'BUY').reduce((sum, event) => sum + event.amountCny, 0)
  const actualSell = tradeEvents.filter((event) => event.tradeType === 'SELL').reduce((sum, event) => sum + event.amountCny, 0)
  const planEvents = events.filter((event) => event.source === 'INVESTMENT_PLAN')
  const duePlanNodes = planEvents.filter((event) => event.planStatus !== 'UPCOMING').length

  return {
    month,
    events,
    inflow,
    outflow,
    net: inflow - outflow,
    confirmedInflow,
    plannedInvestment,
    actualBuy,
    actualSell,
    tradeCount: tradeEvents.length,
    linkedBuyCount: tradeEvents.filter((event) => event.tradeType === 'BUY' && event.relatedPlanName).length,
    planNodeCount: planEvents.length,
    recordedPlanNodes: planEvents.filter((event) => event.planStatus === 'RECORDED').length,
    duePlanNodes,
    pendingPlanNodes: planEvents.filter((event) => event.planStatus === 'UNRECORDED_DUE').length,
  }
}
