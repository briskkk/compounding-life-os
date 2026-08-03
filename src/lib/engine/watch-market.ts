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

function nextDateKey(key: string): string {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * 判断一项交易日盈亏是否仍属于北京时间的“当前看盘日”。
 * 美股一场交易横跨北京时间两个自然日，因此开盘日和次日凌晨都视为当前。
 */
export function isCurrentPortfolioDay(tradingDate: string | null, currency: string, todayKey: string): boolean {
  if (!tradingDate) return false
  if (currency !== 'USD') return tradingDate === todayKey
  return tradingDate === todayKey || nextDateKey(tradingDate) === todayKey
}
