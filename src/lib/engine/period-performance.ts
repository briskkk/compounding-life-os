import { dateKeyAt } from './watch-market'
import { isReturnObservation, type ValuationGap, type ValuationStatus } from './valuation-status'

export interface PerformancePoint {
  date: string
  netWorth: number
  contributions: number
  valuationStatus?: ValuationStatus
  valuationCoverage?: number | null
  latestValuationDate?: string | null
  valuationGaps?: ValuationGap[]
}

export type PerformancePreset =
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'THIS_YEAR'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_YEAR'
  | 'ALL'

export interface PerformanceRange {
  label: string
  startDate: string
  endDate: string
}

export interface PerformanceCurvePoint {
  date: string
  pct: number
  amount: number
  dailyPct: number | null
  dailyAmount: number | null
  /** 累计资金加权收益率（Modified Dietz 逐日链式，出入金按当日中点权重 0.5）。 */
  mwrPct: number
  netWorth: number
  valuationStatus?: ValuationStatus
  valuationCoverage?: number | null
  latestValuationDate?: string | null
  valuationGaps?: ValuationGap[]
}

export interface PeriodPerformanceResult {
  label: string
  amount: number | null
  pct: number | null
  basisDate: string | null
  startDate: string | null
  endDate: string | null
  baseNetWorth: number | null
  endNetWorth: number | null
  baseContributions: number | null
  netFlow: number | null
  curve: PerformanceCurvePoint[]
}

const PRESET_LABELS: Record<PerformancePreset, string> = {
  THIS_WEEK: '本周',
  THIS_MONTH: '本月',
  THIS_YEAR: '今年',
  LAST_7_DAYS: '近 7 日',
  LAST_30_DAYS: '近 30 日',
  LAST_YEAR: '近一年',
  ALL: '全部',
}

function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 把预设周期解析为北京时间自然日区间。 */
export function performancePresetRange(
  preset: PerformancePreset,
  now = new Date(),
  earliestDate?: string,
): PerformanceRange {
  const endDate = dateKeyAt(now)
  let startDate = endDate

  if (preset === 'THIS_WEEK') {
    const weekday = new Date(`${endDate}T00:00:00Z`).getUTCDay()
    startDate = shiftDateKey(endDate, -((weekday + 6) % 7))
  } else if (preset === 'THIS_MONTH') {
    startDate = `${endDate.slice(0, 7)}-01`
  } else if (preset === 'THIS_YEAR') {
    startDate = `${endDate.slice(0, 4)}-01-01`
  } else if (preset === 'LAST_7_DAYS') {
    startDate = shiftDateKey(endDate, -6)
  } else if (preset === 'LAST_30_DAYS') {
    startDate = shiftDateKey(endDate, -29)
  } else if (preset === 'LAST_YEAR') {
    const date = new Date(`${endDate}T00:00:00Z`)
    date.setUTCFullYear(date.getUTCFullYear() - 1)
    startDate = date.toISOString().slice(0, 10)
  } else if (earliestDate) {
    startDate = earliestDate
  }

  return { label: PRESET_LABELS[preset], startDate, endDate }
}

function emptyResult(label: string): PeriodPerformanceResult {
  return {
    label,
    amount: null,
    pct: null,
    basisDate: null,
    startDate: null,
    endDate: null,
    baseNetWorth: null,
    endNetWorth: null,
    baseContributions: null,
    netFlow: null,
    curve: [],
  }
}

/**
 * 任意历史区间收益：
 * - 收益金额 = 期末可投资资产 − 期初可投资资产 − 同期净投入
 * - 收益率 = 每日 (Vd − Vd-1 − Fd) / Vd-1 链式复利（TWR）
 * - 资金加权收益率 = 每日 Modified Dietz：(Vd − Vd-1 − Fd) / (Vd-1 + Fd × 0.5) 链式复利；
 *   流水按当日中午记账取权重 0.5，分母非正当日跳过并沿用前值，非收益观察日与 dailyPct 同样记空。
 *
 * 区间起日使用它之前最近一个快照作期初基准，避免把起日内的资金流误判为收益。
 */
export function performanceBetween(
  series: PerformancePoint[],
  startDate: string,
  endDate: string,
  label = '自定义',
): PeriodPerformanceResult {
  if (!startDate || !endDate || startDate > endDate) return emptyResult(label)

  const points = [...series]
    .filter((point) => point.date <= endDate && Number.isFinite(point.netWorth) && Number.isFinite(point.contributions))
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((point, index, all) => index === all.length - 1 || point.date !== all[index + 1].date)

  const end = points.at(-1)
  if (!end) return emptyResult(label)

  const beforeStart = points.filter((point) => point.date < startDate).at(-1)
  const firstInRange = points.find((point) => point.date >= startDate)
  if (!firstInRange) return emptyResult(label)
  const base = beforeStart ?? firstInRange
  if (!base || base.date > end.date) return emptyResult(label)

  const baseIndex = points.findIndex((point) => point === base)
  const rangePoints = points.slice(baseIndex)
  const netFlow = end.contributions - base.contributions
  const amount = end.netWorth - base.netWorth - netFlow
  let cumulativeFactor = 1
  let mwrCumulativeFactor = 1
  let validReturnPeriods = 0
  const curve: PerformanceCurvePoint[] = [{
    date: base.date,
    pct: 0,
    amount: 0,
    dailyPct: null,
    dailyAmount: null,
    mwrPct: 0,
    netWorth: base.netWorth,
    valuationStatus: base.valuationStatus,
    valuationCoverage: base.valuationCoverage,
    latestValuationDate: base.latestValuationDate,
    valuationGaps: base.valuationGaps,
  }]

  for (let index = 1; index < rangePoints.length; index++) {
    const previous = rangePoints[index - 1]
    const current = rangePoints[index]
    const flow = current.contributions - previous.contributions
    const observesReturn = isReturnObservation(current.valuationStatus)
    const dailyAmount = observesReturn ? current.netWorth - previous.netWorth - flow : null
    const dailyPct = dailyAmount != null && previous.netWorth > 0 ? dailyAmount / previous.netWorth : null
    if (dailyPct != null && Number.isFinite(dailyPct)) {
      cumulativeFactor *= 1 + dailyPct
      validReturnPeriods += 1
    }
    // Modified Dietz：当日净出入金按日中点（权重 0.5）计入分母；分母非正当日跳过，沿用累计值。
    const mwrDenominator = previous.netWorth + flow * 0.5
    const mwrDailyPct = dailyAmount != null && mwrDenominator > 0 ? dailyAmount / mwrDenominator : null
    if (mwrDailyPct != null && Number.isFinite(mwrDailyPct)) {
      mwrCumulativeFactor *= 1 + mwrDailyPct
    }
    curve.push({
      date: current.date,
      pct: cumulativeFactor - 1,
      amount: observesReturn
        ? current.netWorth - base.netWorth - (current.contributions - base.contributions)
        : curve.at(-1)?.amount ?? 0,
      dailyPct: dailyPct != null && Number.isFinite(dailyPct) ? dailyPct : null,
      dailyAmount,
      mwrPct: mwrCumulativeFactor - 1,
      netWorth: current.netWorth,
      valuationStatus: current.valuationStatus,
      valuationCoverage: current.valuationCoverage,
      latestValuationDate: current.latestValuationDate,
      valuationGaps: current.valuationGaps,
    })
  }

  return {
    label,
    amount: rangePoints.length === 1 ? 0 : validReturnPeriods > 0 ? curve.at(-1)?.amount ?? amount : null,
    pct: rangePoints.length === 1 ? 0 : validReturnPeriods > 0 ? cumulativeFactor - 1 : null,
    basisDate: base.date,
    startDate: firstInRange?.date ?? base.date,
    endDate: end.date,
    baseNetWorth: base.netWorth,
    endNetWorth: end.netWorth,
    baseContributions: base.contributions,
    netFlow,
    curve,
  }
}

/** 兼容旧调用：从指定自然日起算至最新快照。 */
export function periodPerformance(
  series: PerformancePoint[],
  start: Date,
  label: string,
): PeriodPerformanceResult {
  const endDate = series.at(-1)?.date
  if (!endDate) return emptyResult(label)
  return performanceBetween(series, dateKeyAt(start), endDate, label)
}
