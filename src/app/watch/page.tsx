// 看盘：当日组合收益曲线（分钟级）+ 实时估值摘要 + 近 30 日表现快照
import { getWatchData, loadBenchmarkSeries } from '@/lib/queries'
import { cnyRateFor } from '@/lib/market/fx'
import { SetupScreen } from '@/components/ui'
import { WatchClient, type WatchHolding, type StaticRow } from '@/components/watch-client'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { dailyTradeActivities, hasDailyPositionActivity, isCurrentDailyTrade, transactionTradingDate, type DailyTradeActivity } from '@/lib/engine/daily-trades'
import { positionKey } from '@/lib/engine/ledger'
import { parseWatchClassFilter, parseWatchSort } from '@/lib/engine/watch-filter'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { BENCHMARK_INDICES, DEFAULT_BENCHMARK_SYMBOL, type LoadedBenchmark } from '@/lib/engine/benchmark'
import { performancePresetRange } from '@/lib/engine/period-performance'

export const dynamic = 'force-dynamic'

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; cls?: string; excl?: string }>
}) {
  const [watchData, sp] = await Promise.all([getWatchData(), searchParams])
  if (!watchData) return <SetupScreen />

  const state = watchData.state
  const { settledStatus, settledGapCount } = watchData.settlement
  const rates = { USDCNY: state.currencyRates.USD, HKDCNY: state.currencyRates.HKD }
  const now = new Date()
  const snapshotRange = performancePresetRange('LAST_30_DAYS', now)
  const firstSnapshotIndex = watchData.series.findIndex((point) => point.date >= snapshotRange.startDate)
  const compactHistorySeries = firstSnapshotIndex === -1
    ? watchData.series.slice(-1)
    : watchData.series.slice(Math.max(0, firstSnapshotIndex - 1))
  // 只加载默认基准；看盘不再承担多基准和任意区间分析，完整比较进入复盘。
  const benchmarkPoints = compactHistorySeries.length > 0
    ? await loadBenchmarkSeries(
      DEFAULT_BENCHMARK_SYMBOL,
      new Date(new Date(`${snapshotRange.startDate}T00:00:00Z`).getTime() - 10 * 86400000),
      now,
    )
    : []
  const benchmarkMeta = BENCHMARK_INDICES.find((item) => item.symbol === DEFAULT_BENCHMARK_SYMBOL)
  const benchmark: LoadedBenchmark | null = benchmarkMeta && benchmarkPoints.length >= 2
    ? { ...benchmarkMeta, points: benchmarkPoints }
    : null
  const mergedPositions = mergePositionsByAsset(state.valued.filter((position) => isPortfolioAssetClass(position.asset.cls)))
  // 报价冷启动可能仍是上一交易日。预先带上当前窗口内各场交易调整，供客户端新报价按日匹配。
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]))
  const tradeDates = new Set(state.ledgerTxs.flatMap((tx) => {
    const asset = assetsById.get(tx.assetId)
    return asset && isCurrentDailyTrade(tx, asset, now) ? [transactionTradingDate(tx, asset)] : []
  }))
  const activitiesByAsset = new Map<string, DailyTradeActivity[]>()
  for (const date of tradeDates) {
    const byPosition = dailyTradeActivities(state.ledgerTxs, assetsById, () => date,
      (currency) => state.currencyRates[currency as keyof typeof state.currencyRates] ?? 1, now)
    for (const position of state.valued) {
      const activity = byPosition.get(positionKey(position.accountId, position.assetId))
      if (!activity) continue
      const activities = activitiesByAsset.get(position.assetId) ?? []
      const existing = activities.find((item) => item.tradingDate === date)
      if (existing) {
        existing.quantityDelta += activity.quantityDelta
        existing.cashFlowCny += activity.cashFlowCny
        existing.trades = [...(existing.trades ?? []), ...(activity.trades ?? [])]
      } else activities.push({ ...activity, trades: [...(activity.trades ?? [])] })
      activitiesByAsset.set(position.assetId, activities)
    }
  }

  // 行情类持仓（股票/ETF/基金/黄金）——参与曲线与实时估值表
  const marketPositions = mergedPositions.filter(
    (v) => (hasDailyPositionActivity(v) || activitiesByAsset.has(v.assetId)) && !v.asset.manual && v.asset.cls !== 'CASH' && v.asset.cls !== 'REAL_ESTATE',
  )
  const holdings: WatchHolding[] = marketPositions.map((v) => {
    const quote = state.quotes.get(v.asset.symbol)
    return {
      assetId: v.assetId,
      symbol: v.asset.symbol,
      name: v.asset.name,
      cls: v.asset.cls,
      currency: v.asset.currency,
      qty: v.quantity,
      dailyActivities: activitiesByAsset.get(v.assetId),
      rateToCny: cnyRateFor(v.asset.symbol, rates),
      prevClose: quote?.prevClose ?? null,
      price: quote?.price ?? null,
      tradingDate: quote?.tradingDate ?? null,
      source: quote?.source ?? null,
      fallbackValueCny: v.value,
      costCny: v.costCny,
      priceSource: v.priceSource,
    }
  })

  // 无分时数据的持仓（现金/手动/房产）——以常数计入组合曲线
  const staticPositions = mergedPositions.filter(
    (v) => Math.abs(v.quantity) > 1e-9 && (v.asset.manual || v.asset.cls === 'CASH' || v.asset.cls === 'REAL_ESTATE'),
  )
  const staticValueCny = staticPositions.reduce((s, v) => s + v.value, 0) + state.inTransit
  const staticInvestableValueCny = staticPositions.reduce((s, v) => s + v.investable, 0) + state.inTransit
  const staticRows: StaticRow[] = [
    ...staticPositions.map((v) => ({
      assetId: v.assetId,
      symbol: v.asset.symbol,
      name: v.asset.name,
      note:
        v.priceSource === 'COST'
          ? '按成本计值 · 无分时数据'
          : `${v.asset.cls === 'CASH' ? '现金' : '手工估值'} · 无分时数据`,
      valueCny: v.value,
      unrealizedPnlCny: v.asset.cls === 'CASH' ? null : v.unrealized,
      unrealizedPnlPct: v.unrealizedPct,
      priceSource: v.priceSource,
    })).filter((row) => Math.abs(row.valueCny) >= 0.01),
    ...(Math.abs(state.inTransit) >= 0.01 ? [{
      assetId: null,
      symbol: 'IN-TRANSIT',
      name: '在途资产',
      note: `申购待确认 ${state.pendingFundPurchases.length} 笔 · 赎回待到账 ${state.pendingSettlements.length} 笔`,
      valueCny: state.inTransit,
      unrealizedPnlCny: null,
      unrealizedPnlPct: null,
      priceSource: 'FACE' as const,
      sourceLabel: '账本在途',
    }] : []),
  ]

  return (
    <WatchClient
      holdings={holdings}
      staticValueCny={staticValueCny}
      staticInvestableValueCny={staticInvestableValueCny}
      staticRows={staticRows}
      historySeries={compactHistorySeries.map((point) => ({
        date: point.date,
        netWorth: point.investable,
        contributions: point.contributions,
        valuationStatus: point.valuationStatus,
        valuationCoverage: point.valuationCoverage,
        latestValuationDate: point.latestValuationDate,
        valuationGaps: point.valuationGaps,
      }))}
      currentContributions={watchData.currentContributions}
      initialSort={parseWatchSort(sp.sort)}
      initialQuery={sp.q ?? ''}
      initialClass={parseWatchClassFilter(sp.cls)}
      initialOnlyExcluded={sp.excl === '1'}
      benchmark={benchmark}
      historyHasGap={settledStatus === 'PARTIAL' || settledStatus === 'NO_UPDATE' || settledGapCount > 0}
    />
  )
}
