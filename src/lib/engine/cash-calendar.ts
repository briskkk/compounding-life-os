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

export interface CashCalendarEvent {
  id: string
  planId: string | null
  title: string
  direction: CashDirection
  amountCny: number
  date: Date
  source: 'PLAN' | 'SETTLEMENT'
  recurrence: CashRecurrence
  accountName: string | null
  note: string | null
}

export interface CashCalendarResult {
  month: string
  events: CashCalendarEvent[]
  inflow: number
  outflow: number
  net: number
  confirmedInflow: number
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
      date,
      source: 'PLAN',
      recurrence: plan.recurrence,
      accountName: plan.accountName,
      note: plan.note,
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
      date: settlement.dueDate,
      source: 'SETTLEMENT',
      recurrence: 'NONE',
      accountName: null,
      note: '由基金赎回结算日派生，到账后自动从日历移除',
    })
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title, 'zh-CN'))
  const inflow = events.filter((event) => event.direction === 'INFLOW').reduce((sum, event) => sum + event.amountCny, 0)
  const outflow = events.filter((event) => event.direction === 'OUTFLOW').reduce((sum, event) => sum + event.amountCny, 0)
  const confirmedInflow = events.filter((event) => event.source === 'SETTLEMENT').reduce((sum, event) => sum + event.amountCny, 0)

  return { month, events, inflow, outflow, net: inflow - outflow, confirmedInflow }
}
