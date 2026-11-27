import type { EngineState } from '@/lib/queries'
import { observeLivePortfolio } from '@/lib/engine/live-portfolio'
import { intradaySeriesBatch } from '@/lib/market/intraday'
import { fundEstimateMinuteSeries } from '@/lib/market/fund-engine'
import { shouldUseOfficialNav } from '@/lib/market/eastmoney-fund'
import { latestNav } from '@/lib/market/fund-holdings'

/** Same market/fund minute providers as /api/intraday, without estimate persistence. */
export async function dailyReportSeries(state: EngineState, now: Date) {
  const market = observeLivePortfolio(state, now).market.filter((row) => row.previousValueCny != null)
  const funds = market.filter((row) => row.asset.cls === 'FUND')
  const series = await intradaySeriesBatch([...new Set(market
    .filter((row) => row.asset.cls !== 'FUND').map((row) => row.asset.symbol))], 'EXCHANGE')
  await Promise.allSettled(funds.map(async ({ asset }) => {
    const nav = await latestNav(asset.symbol).catch(() => null)
    if (nav && shouldUseOfficialNav(nav.date, now)) return
    const result = await fundEstimateMinuteSeries(asset.symbol)
    if (result.points.length > 1) series.set(asset.symbol, {
      symbol: asset.symbol, currency: 'CNY', source: 'FUND-ENGINE', ...result,
    })
  }))
  return series
}
