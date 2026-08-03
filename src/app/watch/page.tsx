// 看盘：当日组合收益曲线（分钟级）+ 全持仓实时估值
import { getWatchData } from '@/lib/queries'
import { cnyRateFor, fxRates } from '@/lib/market/fx'
import { SetupScreen } from '@/components/ui'
import { WatchClient, type WatchHolding, type StaticRow } from '@/components/watch-client'
import { providerLabel } from '@/lib/market'
import { marketChainLabel } from '@/lib/valuation-source'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { parseHoldingSort } from '@/lib/engine/holding-sort'
import { periodPerformance } from '@/lib/engine/period-performance'

export const dynamic = 'force-dynamic'

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const [watchData, sp] = await Promise.all([getWatchData(), searchParams])
  if (!watchData) return <SetupScreen />

  const state = watchData.state
  const rates = await fxRates()
  const mergedPositions = mergePositionsByAsset(state.valued)

  // 行情类持仓（股票/ETF/基金/黄金/RSU）——参与曲线与实时估值表
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

  const now = new Date()
  const periods = [
    periodPerformance(watchData.series, new Date(now.getFullYear(), now.getMonth(), 1), '本月'),
    periodPerformance(watchData.series, new Date(now.getFullYear(), 0, 1), '今年'),
    periodPerformance(watchData.series, new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), '近一年'),
  ]

  return (
    <WatchClient
      holdings={holdings}
      staticValueCny={staticValueCny}
      staticRows={staticRows}
      provider={marketChainLabel(providerLabel()).label}
      periods={periods}
      liabilitiesTotal={state.liabilitiesTotal}
      currentContributions={watchData.series.at(-1)?.contributions ?? 0}
      initialSort={parseHoldingSort(sp.sort)}
    />
  )
}
