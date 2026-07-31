// 看盘：当日组合收益曲线（分钟级）+ 全持仓实时估值
import { getDashboard, type SeriesPoint } from '@/lib/queries'
import { cnyRateFor, fxRates } from '@/lib/market/fx'
import { SetupScreen } from '@/components/ui'
import { WatchClient, type WatchHolding, type StaticRow, type PeriodPerformance } from '@/components/watch-client'
import { providerLabel } from '@/lib/market'
import { marketChainLabel } from '@/lib/valuation-source'
import { mergePositionsByAsset } from '@/lib/engine/merge'

export const dynamic = 'force-dynamic'

function periodPerformance(series: SeriesPoint[], start: Date, label: string): PeriodPerformance {
  const last = series.at(-1)
  if (!last || series.length < 2) return { label, amount: null, pct: null }

  const startKey = start.toISOString().slice(0, 10)
  const beforeStart = series.filter((point) => point.date < startKey).at(-1)
  const base = beforeStart ?? series[0]
  if (base.date === last.date) return { label, amount: 0, pct: 0 }

  const netFlow = last.contributions - base.contributions
  const amount = last.netWorth - base.netWorth - netFlow
  return {
    label,
    amount,
    pct: base.netWorth > 0 ? amount / base.netWorth : null,
  }
}

export default async function WatchPage() {
  const dashboard = await getDashboard()
  if (!dashboard) return <SetupScreen />

  const state = dashboard.state
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
    periodPerformance(dashboard.series, new Date(now.getFullYear(), now.getMonth(), 1), '本月'),
    periodPerformance(dashboard.series, new Date(now.getFullYear(), 0, 1), '今年'),
    periodPerformance(dashboard.series, new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), '近一年'),
  ]

  return (
    <WatchClient
      holdings={holdings}
      staticValueCny={staticValueCny}
      staticRows={staticRows}
      provider={marketChainLabel(providerLabel()).label}
      periods={periods}
    />
  )
}
