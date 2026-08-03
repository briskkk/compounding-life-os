import { dateKeyAt } from './watch-market'

export interface PerformancePoint {
  date: string
  netWorth: number
  contributions: number
}

export interface PeriodPerformanceResult {
  label: string
  amount: number | null
  pct: number | null
  basisDate: string | null
  baseNetWorth: number | null
  baseContributions: number | null
}

export function periodPerformance(
  series: PerformancePoint[],
  start: Date,
  label: string,
): PeriodPerformanceResult {
  const last = series.at(-1)
  if (!last || series.length < 2) {
    return { label, amount: null, pct: null, basisDate: null, baseNetWorth: null, baseContributions: null }
  }

  // 报告周期按北京时间自然日切分；toISOString() 会把上海零点退回前一 UTC 日。
  const startKey = dateKeyAt(start)
  const beforeStart = series.filter((point) => point.date < startKey).at(-1)
  const base = beforeStart ?? series[0]
  if (base.date === last.date) {
    return {
      label,
      amount: 0,
      pct: 0,
      basisDate: base.date,
      baseNetWorth: base.netWorth,
      baseContributions: base.contributions,
    }
  }

  const netFlow = last.contributions - base.contributions
  const amount = last.netWorth - base.netWorth - netFlow
  return {
    label,
    amount,
    pct: base.netWorth > 0 ? amount / base.netWorth : null,
    basisDate: base.date,
    baseNetWorth: base.netWorth,
    baseContributions: base.contributions,
  }
}
