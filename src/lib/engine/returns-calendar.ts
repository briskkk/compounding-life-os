// 收益日历：自然月网格 + 当月逐日收益（复用 performanceBetween 的收益口径）
import { performanceBetween, type PerformanceCurvePoint, type PerformancePoint } from './period-performance'
import type { BenchmarkPoint } from './benchmark'

export interface CalendarDayCell {
  date: string // YYYY-MM-DD
  inMonth: boolean
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7)
}

/** 月份加减（可跨年），返回 'YYYY-MM' */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7)) - 1 + delta
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7)
}

/** 自然月起止日期键（UTC 日历日，与 dateKeyAt 口径一致） */
export function monthRange(monthKey: string): { startDate: string; endDate: string } {
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  return { startDate: `${monthKey}-01`, endDate }
}

/** 周一开头的 7 列月历网格；相邻月溢出日以 inMonth=false 标记。 */
export function buildMonthGrid(monthKey: string): CalendarDayCell[][] {
  const { startDate, endDate } = monthRange(monthKey)
  const leadDays = (new Date(`${startDate}T00:00:00Z`).getUTCDay() + 6) % 7
  const totalDays = Number(endDate.slice(8, 10))
  const cellCount = Math.ceil((leadDays + totalDays) / 7) * 7
  const cursor = new Date(`${startDate}T00:00:00Z`)
  cursor.setUTCDate(cursor.getUTCDate() - leadDays)
  const days: CalendarDayCell[] = []
  for (let index = 0; index < cellCount; index++) {
    const date = cursor.toISOString().slice(0, 10)
    days.push({ date, inMonth: date.slice(0, 7) === monthKey })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const weeks: CalendarDayCell[][] = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7))
  }
  return weeks
}

/**
 * 当月逐日收益曲线：performanceBetween 的期初基准自动落在月初之前最近一个快照，
 * 因此每月 1 日仍有自己的当日收益；基准点本身不进入结果。
 */
export function monthDailyPoints(
  series: PerformancePoint[],
  monthKey: string,
): Map<string, PerformanceCurvePoint> {
  const { startDate, endDate } = monthRange(monthKey)
  const result = performanceBetween(series, startDate, endDate)
  const map = new Map<string, PerformanceCurvePoint>()
  for (const point of result.curve) {
    if (point.date >= startDate && point.date <= endDate) map.set(point.date, point)
  }
  return map
}

/**
 * 区间基准涨跌幅：期初为区间起点之前最近收盘，期末为区间终点当天或之前最近收盘。
 * 起点前无收盘或区间内没有新收盘时记 null（调用方不展示）。
 */
function benchmarkRangeReturn(points: BenchmarkPoint[], startDate: string, endDate: string): number | null {
  if (points.length === 0) return null
  let base: BenchmarkPoint | null = null
  let end: BenchmarkPoint | null = null
  for (const point of points) {
    if (point.date < startDate && (base == null || point.date > base.date)) base = point
    if (point.date <= endDate && (end == null || point.date > end.date)) end = point
  }
  if (base == null || end == null || base.close <= 0) return null
  if (end.date <= base.date) return null
  return end.close / base.close - 1
}

/** 当月基准涨跌幅。 */
export function benchmarkMonthReturn(points: BenchmarkPoint[], monthKey: string): number | null {
  const { startDate, endDate } = monthRange(monthKey)
  return benchmarkRangeReturn(points, startDate, endDate)
}

/** 当年基准涨跌幅。 */
export function benchmarkYearReturn(points: BenchmarkPoint[], year: number): number | null {
  return benchmarkRangeReturn(points, `${year}-01-01`, `${year}-12-31`)
}

export interface PeriodTotal {
  key: string // 'YYYY-MM' 或 'YYYY'
  total: number
  hasAmount: boolean
}

/** 单次 performanceBetween 后按日期前缀（月 'YYYY-MM' 或年 'YYYY'）分桶求和当日收益。 */
function bucketDailyAmounts(
  series: PerformancePoint[],
  startDate: string,
  endDate: string,
  keyLength: 4 | 7,
): Map<string, PeriodTotal> {
  const result = performanceBetween(series, startDate, endDate)
  const buckets = new Map<string, PeriodTotal>()
  for (const point of result.curve) {
    if (point.date < startDate || point.date > endDate) continue
    const key = point.date.slice(0, keyLength)
    const bucket = buckets.get(key) ?? { key, total: 0, hasAmount: false }
    if (point.dailyAmount != null) {
      bucket.total += point.dailyAmount
      bucket.hasAmount = true
    }
    buckets.set(key, bucket)
  }
  return buckets
}

/**
 * 当年 12 个月的收益合计：一次引擎调用覆盖全年（期初基准落在上一年末快照），
 * 再按日收益分桶；无收益观察的月份 hasAmount=false。
 */
export function yearMonthTotals(series: PerformancePoint[], year: number): PeriodTotal[] {
  const buckets = bucketDailyAmounts(series, `${year}-01-01`, `${year}-12-31`, 7)
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`
    return buckets.get(key) ?? { key, total: 0, hasAmount: false }
  })
}

/**
 * 全部年份的收益合计（年收益视图）：一次引擎调用覆盖整个序列，按年分桶。
 * 只保留至少有一个收益观察日的年份——快照跨度可能远早于首个有效估值
 * （如早期华为股票台账），无观察的年份不进入列表。序列为空时返回空数组。
 */
export function allYearTotals(series: PerformancePoint[]): PeriodTotal[] {
  const first = series[0]?.date
  const last = series.at(-1)?.date
  if (!first || !last) return []
  const buckets = bucketDailyAmounts(series, first, last, 4)
  const firstYear = Number(first.slice(0, 4))
  const lastYear = Number(last.slice(0, 4))
  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
    const key = String(firstYear + index)
    return buckets.get(key) ?? { key, total: 0, hasAmount: false }
  }).filter((item) => item.hasAmount)
}

/**
 * 有收益观察的月份键集合（'YYYY-MM'，按日期升序）：
 * 月收益网格的可点击范围、「—」占位与年份导航边界都以此为口径。
 */
export function observedReturnMonths(series: PerformancePoint[]): string[] {
  const first = series[0]?.date
  const last = series.at(-1)?.date
  if (!first || !last) return []
  const result = performanceBetween(series, first, last)
  const months = new Set<string>()
  for (const point of result.curve) {
    if (point.date >= first && point.dailyAmount != null) months.add(point.date.slice(0, 7))
  }
  return [...months]
}
