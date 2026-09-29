import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getWatchData } from './queries'
import { isInvestableAsset } from './asset-classification'
import { assetsForPerformanceScope, filterActiveStrategyScopes, performanceScopes, resolvePerformanceScope } from './engine/performance-scope'
import { buildAssetPerformanceSeries, type AssetPerformancePoint, type AssetNavPoint } from './engine/asset-performance'
import { combineAssetPerformanceSeries } from './engine/group-performance'
import { performanceBetween, type PerformancePoint } from './engine/period-performance'
import { dateKeyAt } from './engine/watch-market'
import { attributionDateKey } from './engine/portfolio-day'
import { loadPriceSeries } from './market/persist'
import { fxRateAtFactory } from './market/fx'
import type { LiveDayReturn } from './engine/returns-calendar'

export async function getGroupPerformance(ctx: FamilyCtx, scopeKey: string | undefined, forGroupReview = false) {
  const db = scopedDb(prisma, ctx)
  const rawAssets = await db.asset.findMany()
  const investableAssets = rawAssets.filter(isInvestableAsset)
  const watch = await getWatchData(ctx)
  if (!watch) return null
  const tradedIds = new Set(watch.state.ledgerTxs.map((tx) => tx.assetId))
  const reviewableAssets = investableAssets.filter((asset) => tradedIds.has(asset.id))
  const heldIds = new Set(watch.state.valued
    .filter((position) => Math.abs(position.quantity) > 1e-9 || position.value > 0)
    .map((position) => position.assetId))
  const scopes = filterActiveStrategyScopes(
    performanceScopes(forGroupReview ? reviewableAssets : investableAssets),
    reviewableAssets,
    heldIds,
  )
  const requestedScope = resolvePerformanceScope(scopes, scopeKey)
  const scope = forGroupReview && requestedScope.key === 'all'
    ? scopes.find((item) => item.key.startsWith('strategy:') && item.key !== 'strategy:未分组' && reviewableAssets.some((asset) => heldIds.has(asset.id) && item.matches(asset)))
      ?? scopes.find((item) => item.key.startsWith('class:') && item.key !== 'class:CASH' && reviewableAssets.some((asset) => heldIds.has(asset.id) && item.matches(asset)))
      ?? scopes.find((item) => item.key.startsWith('class:'))
      ?? requestedScope
    : requestedScope
  const scopeOptions = scopes.map(({ key, label }) => ({ key, label }))
  if (scope.key === 'all') return { scope, scopes: scopeOptions, series: [] as PerformancePoint[], liveDayReturn: null, assets: [] as { id: string; name: string; symbol: string; series: AssetPerformancePoint[] }[] }
  const selected = assetsForPerformanceScope(reviewableAssets, scope, heldIds)
  const selectedIds = new Set(selected.map((asset) => asset.id))
  const transactions = watch.state.ledgerTxs.filter((tx) => selectedIds.has(tx.assetId))
  const [priceMap, rateAt] = await Promise.all([
    loadPriceSeries(prisma, selected.filter((asset) => asset.cls !== 'CASH').map((asset) => asset.symbol)),
    fxRateAtFactory(prisma, selected.map((asset) => asset.currency)),
  ])
  const now = new Date()
  const today = dateKeyAt(now)
  const assetSeries = selected.map((asset) => {
    const prices = priceMap.get(asset.symbol)
    const points: AssetNavPoint[] = prices?.times.map((_, index) => ({
      date: prices.valuationDates[index],
      nav: prices.closes[index],
      source: prices.sources[index],
    })) ?? []
    const quote = watch.state.quotes.get(asset.symbol)
    if (quote && asset.cls !== 'CASH') {
      const liveDate = attributionDateKey(
        { symbol: asset.symbol, currency: asset.currency, cls: asset.cls },
        quote.tradingDate || dateKeyAt(new Date(quote.asOf)),
      )
      if (liveDate === today) {
        const index = points.findIndex((point) => point.date === liveDate)
        const live = { date: liveDate, nav: quote.price, source: quote.source }
        if (index >= 0) points[index] = live
        else points.push(live)
      }
    }
    return {
      asset,
      points: buildAssetPerformanceSeries({
        asset: { id: asset.id, symbol: asset.symbol, name: asset.name, cls: asset.cls, manual: asset.manual, currency: asset.currency },
        transactions,
        prices: points,
        to: now,
        currencyRate: (date) => rateAt(asset.currency, date),
      }),
    }
  })
  const series = combineAssetPerformanceSeries(assetSeries.map((item) => ({ cls: item.asset.cls, points: item.points })))
  const daily = performanceBetween(series, today, today)
  const todayPoint = daily.curve.find((point) => point.date === today)
  const liveDayReturn: LiveDayReturn | null = todayPoint?.dailyAmount != null && (todayPoint.valuationCoverage ?? 0) > 0
    ? { date: today, amount: todayPoint.dailyAmount, pct: todayPoint.dailyPct, valuationCoverage: todayPoint.valuationCoverage ?? 0 }
    : null
  return {
    scope,
    scopes: scopeOptions,
    series,
    liveDayReturn,
    assets: assetSeries.map((item) => ({
      id: item.asset.id,
      name: item.asset.name,
      symbol: item.asset.symbol,
      series: item.points,
    })),
  }
}
