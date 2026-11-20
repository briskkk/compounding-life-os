import type { EngineState } from '@/lib/queries'
import { observeLivePortfolio } from './live-portfolio'
import { attributionDateKey } from './portfolio-day'
import { roundMoney } from './ledger'

export type DesktopValuationStatus = 'LIVE' | 'ESTIMATED' | 'SETTLED' | 'PARTIAL' | 'UNAVAILABLE'

/** 时间与覆盖只描述当日行情组合，不声称房产、人工估值或汇率已结算。 */
export function buildDesktopGlance(state: EngineState, now: Date) {
  const observation = observeLivePortfolio(state, now)
  const covered = observation.market.filter((item) => item.previousValueCny != null)
  const dates = new Set(covered.map((item) => attributionDateKey(item.asset, item.quote?.tradingDate)))
  // UNKNOWN、模型及新浪估值的 asOf 可能只是接收时点，不能用作行情时间。
  const quoteTimes = covered.map(({ quote }) => {
    if (!quote || !quote.freshness || quote.freshness === 'UNKNOWN'
      || quote.kind === 'SIMULATED' || quote.kind === 'MODEL_ESTIMATE' || quote.kind === 'SINA_ESTIMATE') return null
    const time = Date.parse(quote.asOf)
    return Number.isFinite(time) && time <= now.getTime() ? time : null
  })
  const hasDailyEvidence = covered.length > 0
  let status: DesktopValuationStatus = 'UNAVAILABLE'
  if (hasDailyEvidence) {
    if (covered.length < observation.market.length) status = 'PARTIAL'
    else if (dates.size === 1 && covered.every(({ quote }) => quote?.kind === 'OFFICIAL_NAV')) status = 'SETTLED'
    else if (dates.size === 1 && covered.every(({ quote }, index) => (
      quote?.kind === 'MARKET' && quote.freshness === 'LIVE'
      && quoteTimes[index] != null && now.getTime() - quoteTimes[index]! <= 15 * 60_000
    ))) status = 'LIVE'
    else status = 'ESTIMATED'
  }
  return {
    netWorth: {
      netWorth: state.netWorth,
      investable: state.investable,
      dayPnl: hasDailyEvidence ? roundMoney(observation.summary.pnlCny) : null,
      dayPct: hasDailyEvidence && observation.summary.pnlPct != null
        ? roundMoney(observation.summary.pnlPct * 100) : null,
    },
    valuation: {
      asOfDate: dates.size === 1 ? [...dates][0] : null,
      // 只有全部参与损益的行情都能证明时点，才给出最早的时间（保守水位）。
      quoteAsOf: hasDailyEvidence && quoteTimes.every((time) => time != null)
        ? new Date(Math.min(...quoteTimes as number[])).toISOString() : null,
      syncedAt: now.toISOString(),
      status,
      coveragePct: observation.coverage == null ? null : Math.max(0, Math.min(100, observation.coverage * 100)),
    },
  }
}
