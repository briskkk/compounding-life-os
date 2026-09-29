import type { AssetClass } from './types'
import type { AssetPerformancePoint } from './asset-performance'
import type { PerformancePoint } from './period-performance'

/** 按当前分类把资产日序列相加；资金流随所选资产聚合，组间买卖不冒充收益。 */
export function combineAssetPerformanceSeries(
  assets: { cls: AssetClass; points: AssetPerformancePoint[] }[],
): PerformancePoint[] {
  const dates = [...new Set(assets.flatMap((asset) => asset.points.map((point) => point.date)))].sort()
  const byAsset = assets.map((asset) => ({
    cls: asset.cls,
    byDate: new Map(asset.points.map((point) => [point.date, point])),
  }))
  return dates.map((date) => {
    const points = byAsset.map((item) => ({ cls: item.cls, point: item.byDate.get(date) }))
      .filter((item): item is { cls: AssetClass; point: AssetPerformancePoint } => item.point != null)
    const netWorth = points.reduce((sum, item) => sum + item.point.netWorth, 0)
    const contributions = points.reduce((sum, item) => sum + item.point.contributions, 0)
    const active = points.filter((item) => Math.abs(item.point.netWorth) > 0.005)
    const market = active.filter((item) => item.cls !== 'CASH')
    const priced = market.filter((item) => item.point.valuationCoverage === 1)
    const marketValue = market.reduce((sum, item) => sum + Math.abs(item.point.netWorth), 0)
    const pricedValue = priced.reduce((sum, item) => sum + Math.abs(item.point.netWorth), 0)
    const observations = active.filter((item) => item.point.valuationStatus === 'SETTLED' || item.point.valuationStatus === 'LIVE')
    const valuationStatus = market.length > 0
      ? priced.length === market.length ? 'SETTLED' : observations.length > 0 ? 'PARTIAL' : market.every((item) => item.point.valuationStatus === 'CLOSED') ? 'CLOSED' : 'NO_UPDATE'
      : observations.length > 0 ? 'SETTLED' : active.some((item) => item.point.valuationStatus === 'FLOW_ONLY') ? 'FLOW_ONLY' : 'NO_UPDATE'
    const latestValuationDate = points.reduce<string | null>((latest, item) => {
      const value = item.point.latestValuationDate
      return value && (!latest || value > latest) ? value : latest
    }, null)
    return {
      date,
      netWorth,
      contributions,
      valuationStatus,
      valuationCoverage: marketValue > 0 ? pricedValue / marketValue : 1,
      latestValuationDate,
      valuationGaps: points.flatMap((item) => item.point.valuationGaps),
    }
  })
}
