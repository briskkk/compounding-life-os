// 看盘：当日组合收益曲线（分钟级）+ 全持仓实时估值
import { getWatchData, loadBenchmarks } from '@/lib/queries'
import { cnyRateFor, fxRates } from '@/lib/market/fx'
import { SetupScreen } from '@/components/ui'
import { WatchClient, type WatchHolding, type StaticRow } from '@/components/watch-client'
import { providerLabel } from '@/lib/market'
import { marketChainLabel } from '@/lib/valuation-source'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { parseHoldingSort } from '@/lib/engine/holding-sort'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { parsePreferences } from '@/lib/preferences'

export const dynamic = 'force-dynamic'

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const [watchData, sp, session] = await Promise.all([getWatchData(), searchParams, getSession()])
  if (!watchData) return <SetupScreen />
  const defaultRange = session?.userId
    ? parsePreferences((await prisma.user.findUnique({ where: { id: session.userId }, select: { preferences: true } }))?.preferences ?? null).defaultRange ?? null
    : null

  const state = watchData.state
  const rates = await fxRates()
  // 基准序列向前多取 10 天：保证期初基准日（可能落在非交易日）有可用收盘净值
  const benchmarks = watchData.series.length > 0
    ? await loadBenchmarks(new Date(new Date(`${watchData.series[0].date}T00:00:00`).getTime() - 10 * 86400000), new Date())
    : []
  const mergedPositions = mergePositionsByAsset(state.valued.filter((position) => isPortfolioAssetClass(position.asset.cls)))

  // 行情类持仓（股票/ETF/基金/黄金）——参与曲线与实时估值表
  const marketPositions = mergedPositions.filter(
    (v) => v.quantity > 1e-9 && !v.asset.manual && v.asset.cls !== 'CASH' && v.asset.cls !== 'REAL_ESTATE',
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
      rateToCny: cnyRateFor(v.asset.symbol, rates),
      prevClose: quote?.prevClose ?? null,
      price: quote?.price ?? null,
      tradingDate: quote?.tradingDate ?? null,
      source: quote?.source ?? null,
      fallbackValueCny: v.value,
      priceSource: v.priceSource,
    }
  })

  // 无分时数据的持仓（现金/手动/房产）——以常数计入组合曲线
  const staticPositions = mergedPositions.filter(
    (v) => Math.abs(v.quantity) > 1e-9 && (v.asset.manual || v.asset.cls === 'CASH' || v.asset.cls === 'REAL_ESTATE'),
  )
  const staticValueCny = staticPositions.reduce((s, v) => s + v.value, 0)
  const staticInvestableValueCny = staticPositions.reduce((s, v) => s + v.investable, 0)
  const staticRows: StaticRow[] = staticPositions
    .map((v) => ({
      assetId: v.assetId,
      symbol: v.asset.symbol,
      name: v.asset.name,
      note:
        v.priceSource === 'COST'
          ? '按成本计值 · 无分时数据'
          : `${v.asset.cls === 'CASH' ? '现金' : '手工估值'} · 无分时数据`,
      valueCny: v.value,
      priceSource: v.priceSource,
    }))
    .filter((row) => Math.abs(row.valueCny) >= 0.01)

  return (
    <WatchClient
      holdings={holdings}
      staticValueCny={staticValueCny}
      staticInvestableValueCny={staticInvestableValueCny}
      staticRows={staticRows}
      provider={marketChainLabel(providerLabel()).label}
      historySeries={watchData.series.map((point) => ({
        date: point.date,
        netWorth: point.investable,
        contributions: point.contributions,
        valuationStatus: point.valuationStatus,
        valuationCoverage: point.valuationCoverage,
        latestValuationDate: point.latestValuationDate,
        valuationGaps: point.valuationGaps,
      }))}
      currentContributions={watchData.currentContributions}
      initialSort={parseHoldingSort(sp.sort)}
      defaultRange={defaultRange}
      benchmarks={benchmarks}
    />
  )
}
