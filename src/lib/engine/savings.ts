export type SavingsPeriod = 'WEEK' | 'MONTH'

export interface SavingsRecordInput {
  periodType: SavingsPeriod
  periodStart: Date
  income: number
  spending: number
  savedAmount: number
}

export interface SavingsMonth {
  month: string
  income: number
  spending: number
  netSavings: number
  savedAmount: number
  unallocated: number
  savingsRate: number | null
  source: SavingsPeriod | null
}

export interface SavingsOverview {
  months: SavingsMonth[]
  current: SavingsMonth
  averageRate: number | null
  sustainableMonthlySavings: number
  recordedMonths: number
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function recentMonthKeys(now: Date, count: number): string[] {
  const keys: string[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    keys.push(monthKey(date))
  }
  return keys
}

function summarize(month: string, rows: SavingsRecordInput[], source: SavingsPeriod | null): SavingsMonth {
  const income = rows.reduce((sum, row) => sum + row.income, 0)
  const spending = rows.reduce((sum, row) => sum + row.spending, 0)
  const savedAmount = rows.reduce((sum, row) => sum + row.savedAmount, 0)
  const netSavings = income - spending
  return {
    month,
    income,
    spending,
    netSavings,
    savedAmount,
    unallocated: netSavings - savedAmount,
    savingsRate: income > 0 ? netSavings / income : null,
    source,
  }
}
/**
 * 月度记录代表已确认汇总值；同月存在月度记录时，不再叠加周度补录。
 * 没有月度记录时，才汇总该月全部周度记录。
 */
export function buildSavingsOverview(
  records: SavingsRecordInput[],
  now = new Date(),
  monthCount = 12,
): SavingsOverview {
  const keys = recentMonthKeys(now, monthCount)
  const byMonth = new Map<string, SavingsRecordInput[]>()
  for (const record of records) {
    const key = monthKey(record.periodStart)
    const rows = byMonth.get(key) ?? []
    rows.push(record)
    byMonth.set(key, rows)
  }

  const months = keys.map((key) => {
    const rows = byMonth.get(key) ?? []
    const monthly = rows.filter((row) => row.periodType === 'MONTH')
    if (monthly.length > 0) return summarize(key, [monthly.at(-1)!], 'MONTH')
    const weekly = rows.filter((row) => row.periodType === 'WEEK')
    return summarize(key, weekly, weekly.length > 0 ? 'WEEK' : null)
  })

  const recorded = months.filter((month) => month.source && month.income > 0)
  const averageRate = recorded.length > 0
    ? recorded.reduce((sum, month) => sum + (month.savingsRate ?? 0), 0) / recorded.length
    : null
  const recentRecorded = recorded.slice(-3)
  const sustainableMonthlySavings = recentRecorded.length > 0
    ? recentRecorded.reduce((sum, month) => sum + month.netSavings, 0) / recentRecorded.length
    : 0

  return {
    months,
    current: months.at(-1)!,
    averageRate,
    sustainableMonthlySavings,
    recordedMonths: recorded.length,
  }
}
