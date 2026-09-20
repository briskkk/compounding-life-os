import type { IntradaySeries } from '@/lib/market/intraday'

const DATE_KEY_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = DATE_KEY_FORMATTERS.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    DATE_KEY_FORMATTERS.set(timeZone, formatter)
  }
  return formatter
}

export function dateKeyAt(value: Date | number, timeZone = 'Asia/Shanghai'): string {
  return formatterFor(timeZone).format(typeof value === 'number' ? new Date(value) : value)
}

export function exchangeTimeZone(currency: string, cls: string): string {
  if (currency === 'USD') return 'America/New_York'
  if (currency === 'HKD') return 'Asia/Hong_Kong'
  return cls === 'FUND' ? 'Asia/Shanghai' : 'Asia/Shanghai'
}

export function seriesTradingDate(series: IntradaySeries | undefined, currency: string, cls: string): string | null {
  const last = series?.points.at(-1)
  return last ? dateKeyAt(last.t, exchangeTimeZone(currency, cls)) : null
}

export function seriesPortfolioDate(series: IntradaySeries | undefined): string | null {
  const last = series?.points.at(-1)
  return last ? dateKeyAt(last.t) : null
}

// “今日涨跌”的归属判定与昨收基线统一由 engine/portfolio-day 提供（ADR-027：
// 一场交易按“数据在北京时间哪一天落定”归属，美股美东 D 日计入北京 D+1）。
// 本模块只保留纯日期键与交易所交易日读取，不做归属偏移。

export interface DatedValuation {
  tradingDate: string | null
  valueCny: number
}

/** 当前估值实际落在哪一个北京归属日，以及该日价格覆盖了多少行情资产（调用方传入归属日期键）。 */
export function summarizeValuationDate(items: DatedValuation[]): { date: string; coverage: number } | null {
  const dated = items.filter((item) => item.tradingDate != null && /^\d{4}-\d{2}-\d{2}$/.test(item.tradingDate))
  const date = dated.reduce<string | null>(
    (latest, item) => latest == null || item.tradingDate! > latest ? item.tradingDate : latest,
    null,
  )
  if (!date) return null

  const pricedValue = items.reduce((sum, item) => sum + Math.abs(item.valueCny), 0)
  const datedValue = dated
    .filter((item) => item.tradingDate === date)
    .reduce((sum, item) => sum + Math.abs(item.valueCny), 0)
  return {
    date,
    coverage: pricedValue > 0 ? datedValue / pricedValue : 1,
  }
}
