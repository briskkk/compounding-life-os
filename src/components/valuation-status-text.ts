// 估值状态文案：看盘页历史区与收益日历共用
import type { PerformanceCurvePoint } from '@/lib/engine/period-performance'

export function valuationStatusText(point: Pick<PerformanceCurvePoint, 'valuationStatus' | 'valuationCoverage'>): string {
  if (point.valuationStatus === 'SETTLED') {
    const coverage = point.valuationCoverage == null ? null : Math.round(point.valuationCoverage * 100)
    return coverage != null && coverage < 100 ? `已结算 · ${coverage}%更新` : '已结算'
  }
  if (point.valuationStatus === 'PARTIAL') {
    const coverage = point.valuationCoverage == null ? null : Math.round(point.valuationCoverage * 100)
    return coverage == null ? '部分估值' : `部分估值 ${coverage}%`
  }
  if (point.valuationStatus === 'CLOSED') return '休市'
  if (point.valuationStatus === 'NO_UPDATE') return '无新估值'
  if (point.valuationStatus === 'FLOW_ONLY') return '仅资金流'
  if (point.valuationStatus === 'LIVE') return '实时估算'
  return '历史口径'
}

export function valuationStatusTitle(point: PerformanceCurvePoint): string {
  if (point.valuationGaps && point.valuationGaps.length > 0) {
    return point.valuationGaps
      .map((gap) => {
        if (gap.reason === 'MARKET_CLOSED') return `${gap.name}：市场休市，沿用 ${gap.valuationDate ?? '最近估值'}`
        return `${gap.name}：${gap.valuationDate ? `暂沿用 ${gap.valuationDate}` : '缺少官方估值'}`
      })
      .join('\n')
  }
  if (point.valuationStatus === 'CLOSED' && point.latestValuationDate) return `休市，价格沿用至 ${point.latestValuationDate}`
  return valuationStatusText(point)
}
