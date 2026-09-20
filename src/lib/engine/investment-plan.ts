export type InvestmentCadence = 'WEEKDAY' | 'WEEKLY' | 'MONTHLY'
export type InvestmentPlanLifecycle = 'ACTIVE' | 'ENDED'
export type InvestmentPlanPace = 'ON_TRACK' | 'BEHIND' | 'UPCOMING' | 'ENDED'

export interface InvestmentPlanInput {
  id: string
  name: string
  amount: number
  currency: string
  cadence: InvestmentCadence
  scheduleDay: number | null
  startDate: Date
  endDate: Date | null
  status: InvestmentPlanLifecycle
  endedAt: Date | null
  accountId: string | null
  assetIds: string[]
}

export interface InvestmentPlanBuy {
  id: string
  accountId: string
  assetId: string
  amount: number
  occurredAt: Date
  navSource: string | null
}

export interface InvestmentPlanDayReviewInput {
  planId: string
  scheduledDate: Date
  revokedAt: Date | null
}

export interface InvestmentPlanDay {
  date: Date
  status: 'RECORDED' | 'CONFIRMED_NO_BUY' | 'UNRECORDED_DUE' | 'UPCOMING'
  actualAmount: number
  transactionCount: number
  pendingCount: number
  hasNoBuyReviewConflict: boolean
}

export interface InvestmentPlanMonthRow {
  id: string
  name: string
  currency: string
  scheduledDates: Date[]
  actualDates: Date[]
  days: InvestmentPlanDay[]
  offScheduleDates: Date[]
  dueOccurrences: number
  plannedAmount: number
  dueAmount: number
  actualAmount: number
  pendingAmount: number
  transactionCount: number
  pendingCount: number
  progress: number | null
  pace: InvestmentPlanPace
  nextDate: Date | null
}

export interface InvestmentPlanMonthResult {
  month: string
  rows: InvestmentPlanMonthRow[]
  activePlans: number
  scheduledOccurrences: number
  dueOccurrences: number
  transactionCount: number
  pendingCount: number
}

const DAY_MS = 86400000

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

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function effectiveEnd(plan: InvestmentPlanInput): Date | null {
  const candidates = [plan.endDate, plan.endedAt].filter((date): date is Date => date != null)
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0]
}

function isInPlanWindow(date: Date, plan: InvestmentPlanInput): boolean {
  const stamp = dayStart(date)
  if (stamp < dayStart(plan.startDate)) return false
  const end = effectiveEnd(plan)
  return !end || stamp <= dayStart(end)
}

function isScheduled(date: Date, plan: InvestmentPlanInput): boolean {
  if (!isInPlanWindow(date, plan)) return false
  if (plan.cadence === 'WEEKDAY') return date.getDay() !== 0 && date.getDay() !== 6
  if (plan.cadence === 'WEEKLY') return date.getDay() === plan.scheduleDay
  const expected = localDate(date.getFullYear(), date.getMonth(), plan.scheduleDay ?? plan.startDate.getDate())
  return date.getDate() === expected.getDate()
}

export function scheduledDatesInMonth(month: string, plan: InvestmentPlanInput): Date[] {
  const { year, monthIndex } = monthParts(month)
  const count = new Date(year, monthIndex + 1, 0).getDate()
  const dates: Date[] = []
  for (let day = 1; day <= count; day++) {
    const date = localDate(year, monthIndex, day)
    if (isScheduled(date, plan)) dates.push(date)
  }
  return dates
}

/** 列出所有已到期、同日无匹配 BUY 的计划节点；之后日期已买入也不能掩盖较早的漏录。 */
export function unrecordedScheduledDatesInMonth(
  month: string,
  plan: InvestmentPlanInput,
  buys: InvestmentPlanBuy[],
  now = new Date(),
  reviews: InvestmentPlanDayReviewInput[] = [],
): Date[] {
  const allowedAssets = new Set(plan.assetIds)
  const matching = buys.filter((buy) => (
    allowedAssets.has(buy.assetId)
    && (!plan.accountId || buy.accountId === plan.accountId)
    && isInPlanWindow(buy.occurredAt, plan)
  ))
  const recordedDays = new Set(matching.map((buy) => dayStart(buy.occurredAt)))
  const reviewedDays = new Set(reviews.filter((review) => review.planId === plan.id && !review.revokedAt)
    .map((review) => dayStart(review.scheduledDate)))
  return scheduledDatesInMonth(month, plan).filter((date) => (
    dayStart(date) <= dayStart(now)
    && !recordedDays.has(dayStart(date))
    && !reviewedDays.has(dayStart(date))
  ))
}

/** 该月的计划节点，不做「是否已录入」过滤；用于待核对队列按计划日分组展示。 */
export function scheduledDatesInMonthByPlan(month: string, plans: InvestmentPlanInput[]): Map<string, Date[]> {
  return new Map(plans.map((plan) => [plan.id, scheduledDatesInMonth(month, plan)]))
}

function nextScheduledDate(plan: InvestmentPlanInput, now: Date): Date | null {
  const start = Math.max(dayStart(now), dayStart(plan.startDate))
  for (let offset = 0; offset <= 370; offset++) {
    const candidate = new Date(start + offset * DAY_MS)
    candidate.setHours(12, 0, 0, 0)
    if (isScheduled(candidate, plan)) return candidate
    const end = effectiveEnd(plan)
    if (end && dayStart(candidate) > dayStart(end)) return null
  }
  return null
}

function monthWindow(month: string): { start: Date; end: Date } {
  const { year, monthIndex } = monthParts(month)
  return {
    start: localDate(year, monthIndex, 1),
    end: localDate(year, monthIndex, new Date(year, monthIndex + 1, 0).getDate()),
  }
}

export function buildInvestmentPlanMonth(
  month: string,
  plans: InvestmentPlanInput[],
  buys: InvestmentPlanBuy[],
  now = new Date(),
  reviews: InvestmentPlanDayReviewInput[] = [],
): InvestmentPlanMonthResult {
  const window = monthWindow(month)
  const comparisonDate = dayStart(now) < dayStart(window.start)
    ? new Date(window.start.getTime() - DAY_MS)
    : dayStart(now) > dayStart(window.end) ? window.end : now

  const rows = plans.map((plan): InvestmentPlanMonthRow => {
    const scheduledDates = scheduledDatesInMonth(month, plan)
    const dueDates = scheduledDates.filter((date) => dayStart(date) <= dayStart(comparisonDate))
    const allowedAssets = new Set(plan.assetIds)
    const planBuys = buys.filter((buy) => (
      allowedAssets.has(buy.assetId)
      && (!plan.accountId || buy.accountId === plan.accountId)
      && dayStart(buy.occurredAt) >= dayStart(window.start)
      && dayStart(buy.occurredAt) <= dayStart(window.end)
      && isInPlanWindow(buy.occurredAt, plan)
    ))
    const actualAmount = planBuys.reduce((sum, buy) => sum + buy.amount, 0)
    const pendingBuys = planBuys.filter((buy) => buy.navSource === 'PENDING')
    const pendingAmount = pendingBuys.reduce((sum, buy) => sum + buy.amount, 0)
    const plannedAmount = scheduledDates.length * plan.amount
    const dueAmount = dueDates.length * plan.amount
    const buysByDay = new Map<number, InvestmentPlanBuy[]>()
    for (const buy of planBuys) {
      const stamp = dayStart(buy.occurredAt)
      buysByDay.set(stamp, [...(buysByDay.get(stamp) ?? []), buy])
    }
    const reviewedDays = new Set(reviews.filter((review) => review.planId === plan.id && !review.revokedAt)
      .map((review) => dayStart(review.scheduledDate)))
    const days = scheduledDates.map((date): InvestmentPlanDay => {
      const dayBuys = buysByDay.get(dayStart(date)) ?? []
      return {
        date,
        status: dayBuys.length > 0 ? 'RECORDED'
          : dayStart(date) > dayStart(comparisonDate) ? 'UPCOMING'
            : reviewedDays.has(dayStart(date)) ? 'CONFIRMED_NO_BUY' : 'UNRECORDED_DUE',
        actualAmount: dayBuys.reduce((sum, buy) => sum + buy.amount, 0),
        transactionCount: dayBuys.length,
        pendingCount: dayBuys.filter((buy) => buy.navSource === 'PENDING').length,
        hasNoBuyReviewConflict: dayBuys.length > 0 && reviewedDays.has(dayStart(date)),
      }
    })
    const scheduledDays = new Set(scheduledDates.map(dayStart))
    const offScheduleDates = [...buysByDay.keys()]
      .filter((stamp) => !scheduledDays.has(stamp))
      .sort((a, b) => a - b)
      .map((stamp) => new Date(stamp))
    const progress = plannedAmount > 0 ? actualAmount / plannedAmount : null
    const end = effectiveEnd(plan)
    const isEnded = plan.status === 'ENDED' || Boolean(end && dayStart(end) < dayStart(now))
    const pace: InvestmentPlanPace = isEnded
      ? 'ENDED'
      : dueAmount === 0
        ? 'UPCOMING'
        : actualAmount + 0.01 >= dueAmount
          ? 'ON_TRACK'
          : 'BEHIND'

    return {
      id: plan.id,
      name: plan.name,
      currency: plan.currency,
      scheduledDates,
      actualDates: [...new Map(planBuys.map((buy) => [dayStart(buy.occurredAt), buy.occurredAt])).values()]
        .sort((a, b) => a.getTime() - b.getTime()),
      days,
      offScheduleDates,
      dueOccurrences: dueDates.length,
      plannedAmount,
      dueAmount,
      actualAmount,
      pendingAmount,
      transactionCount: planBuys.length,
      pendingCount: pendingBuys.length,
      progress,
      pace,
      nextDate: !isEnded ? nextScheduledDate(plan, now) : null,
    }
  })

  return {
    month,
    rows,
    activePlans: plans.filter((plan) => {
      const end = effectiveEnd(plan)
      return plan.status === 'ACTIVE' && (!end || dayStart(end) >= dayStart(now))
    }).length,
    scheduledOccurrences: rows.reduce((sum, row) => sum + row.scheduledDates.length, 0),
    dueOccurrences: rows.reduce((sum, row) => sum + row.dueOccurrences, 0),
    transactionCount: rows.reduce((sum, row) => sum + row.transactionCount, 0),
    pendingCount: rows.reduce((sum, row) => sum + row.pendingCount, 0),
  }
}
