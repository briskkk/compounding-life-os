import type { EngineState } from '@/lib/queries'
import type { IntradaySeries } from '@/lib/market/intraday'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { buildDesktopGlance } from './desktop-glance'
import { observeLivePortfolio } from './live-portfolio'
import { mergePositionsByAsset } from './merge'
import { roundMoney } from './ledger'
import { buildIntradayCurves, type CurveHolding } from './intraday'
import { dateKeyAt, seriesTradingDate } from './watch-market'

/** A single read-only snapshot. Rankings, chart and total share the quote/ledger basis. */
export function buildDailyReport(state: EngineState, minuteSeries: Map<string, IntradaySeries>, now: Date) {
  const glance = buildDesktopGlance(state, now)
  const observation = observeLivePortfolio(state, now)
  const date = dateKeyAt(now)
  const rateFor = (currency: string) => currency === 'USD' ? state.currencyRates.USD
    : currency === 'HKD' ? state.currencyRates.HKD : 1
  const leaders = observation.market
    .filter((row) => row.previousValueCny != null)
    .map((row) => ({
      assetId: row.asset.id,
      name: row.asset.name,
      pnl: roundMoney(row.currentValueCny - row.previousValueCny!),
      pct: row.previousValueCny! > 0
        ? roundMoney((row.currentValueCny / row.previousValueCny! - 1) * 100) : null,
    }))
    .filter((row) => row.pnl > 0)
    .sort((a, b) => b.pnl - a.pnl || a.assetId.localeCompare(b.assetId))
    .slice(0, 5)

  const assets = new Map(state.assets.map((asset) => [asset.id, asset]))
  const operations = state.ledgerTxs
    .filter((tx) => (tx.type === 'BUY' || tx.type === 'SELL') && !tx.voidedAt
      && !tx.internal && !tx.settleOfId && tx.occurredAt <= now && dateKeyAt(tx.occurredAt) === date)
    .flatMap((tx) => {
      const asset = assets.get(tx.assetId)
      if (!asset || !isPortfolioAssetClass(asset.cls) || asset.cls === 'CASH') return []
      const amount = tx.quantity != null && tx.price != null && tx.navSource !== 'PENDING'
        ? tx.quantity * tx.price : tx.amount
      return [{
        name: asset.name, side: tx.type as 'BUY' | 'SELL',
        amount: roundMoney(amount * rateFor(asset.currency)),
        pending: tx.navSource === 'PENDING',
      }]
    })

  const positions = new Map(mergePositionsByAsset(state.valued).map((p) => [p.assetId, p]))
  const covered = observation.market.filter((row) => row.previousValueCny != null)
  const holdings: CurveHolding[] = []
  const active = new Map<string, IntradaySeries['points']>()
  let constantPnl = 0
  for (const row of covered) {
    const p = positions.get(row.asset.id)!
    const series = minuteSeries.get(row.asset.symbol)
    const matchingDate = series && seriesTradingDate(series, row.asset.currency, row.asset.cls) === row.quote?.tradingDate
    const points = matchingDate ? series.points
      .filter((point) => point.t <= now.getTime() && Number.isFinite(point.t) && Number.isFinite(point.price) && point.price > 0)
      .map((point) => ({ ...point })) : []
    if (points.length < 2) {
      constantPnl += row.currentValueCny - row.previousValueCny!
      continue
    }
    // Same quote as the summary/table; never substitute the minute-series previous close.
    points[points.length - 1].price = row.quote!.price
    active.set(row.asset.symbol, points)
    holdings.push({ symbol: row.asset.symbol, qty: p.quantity, rateToCny: rateFor(row.asset.currency),
      prevClose: row.quote!.prevClose, trades: p.dailyActivity?.trades })
  }
  const curve = buildIntradayCurves(holdings, active, 0, constantPnl).curve
    .filter((point) => Number.isFinite(point.pnl))
    .map((point) => ({ t: point.t, pnl: roundMoney(point.pnl) }))
  // A late transaction or absent minute history must not produce a misleading endpoint.
  const reconciles = glance.netWorth.dayPnl != null && curve.length > 1
    && Math.abs(curve[curve.length - 1].pnl - glance.netWorth.dayPnl) <= 0.01
  return {
    date,
    pnl: glance.netWorth.dayPnl,
    pct: glance.netWorth.dayPct,
    valuation: glance.valuation,
    leaders,
    remainingPnl: glance.netWorth.dayPnl == null ? null
      : roundMoney(glance.netWorth.dayPnl - leaders.reduce((sum, row) => sum + row.pnl, 0)),
    curve: reconciles ? curve : [],
    curveStatus: reconciles ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
    operations,
    simulated: covered.some((row) => row.quote?.kind === 'SIMULATED'),
  }
}
