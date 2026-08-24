import type { QuoteFreshness } from './provider'

type ExchangeMarket = 'CN_A' | 'HK' | 'US' | 'FUND' | 'INDEX' | 'OTHER'

function localParts(raw: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const normalized = raw.replaceAll('/', '-')
  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  const separated = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  const fields = compact ?? separated
  if (!fields) return null
  const [year, month, day, hour, minute, second] = fields.slice(1).map(Number)
  return { year, month, day, hour, minute, second }
}

function zonedLocalToIso(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): string | null {
  const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  let guess = desiredUtc
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (let i = 0; i < 2; i++) {
    const values = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    )
    const representedUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    )
    guess += desiredUtc - representedUtc
  }
  return Number.isFinite(guess) ? new Date(guess).toISOString() : null
}

function marketTimeZone(market: ExchangeMarket): string | null {
  if (market === 'CN_A' || market === 'HK' || market === 'INDEX') return 'Asia/Shanghai'
  if (market === 'US') return 'America/New_York'
  return null
}

/** 把行情源的本地交易所时间按对应市场时区转成无歧义 ISO。 */
export function exchangeTimeToIso(raw: string, market: ExchangeMarket): string | null {
  const parts = localParts(raw)
  const timeZone = marketTimeZone(market)
  return parts && timeZone ? zonedLocalToIso(parts, timeZone) : null
}

/**
 * 只在可证明时标为 LIVE：交易时段内数据不超过 15 分钟；15–30 分钟标为 DELAYED。
 * 休市时的最近收盘价标为 CLOSED；交易时段仍停留在旧日或超过 30 分钟则标为 STALE。
 */
export function marketQuoteFreshness(
  market: ExchangeMarket,
  asOf: string | null,
  tradingDate: string | null,
  receivedAt: Date,
): QuoteFreshness {
  const timeZone = marketTimeZone(market)
  if (!asOf || !tradingDate || !timeZone) return 'UNKNOWN'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(receivedAt).map((part) => [part.type, part.value]),
  )
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  const weekday = parts.weekday !== 'Sat' && parts.weekday !== 'Sun'
  const morning = minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30
  const afternoonEnd = market === 'CN_A' || market === 'INDEX' ? 15 * 60 : 16 * 60
  const afternoon = minutes >= 13 * 60 && minutes < afternoonEnd
  const tradingHours = weekday && (market === 'US'
    ? minutes >= 9 * 60 + 30 && minutes < 16 * 60
    : morning || afternoon)

  if (!tradingHours) return 'CLOSED'
  if (tradingDate !== today) return 'STALE'
  const ageMs = receivedAt.getTime() - new Date(asOf).getTime()
  if (ageMs >= 0 && ageMs <= 15 * 60_000) return 'LIVE'
  if (ageMs > 15 * 60_000 && ageMs <= 30 * 60_000) return 'DELAYED'
  return 'STALE'
}
