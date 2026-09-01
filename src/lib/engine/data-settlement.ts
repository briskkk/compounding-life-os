import type { ValuationStatus } from './valuation-status'

export interface SettlementSeriesPoint {
  date: string
  valuationStatus: ValuationStatus
  valuationCoverage: number | null
  valuationGaps: unknown[]
}

export interface LiveValuationItem {
  valueCny: number
  hasQuote: boolean
  tradingDate: string | null
}

export interface DataSettlementState {
  liveDate: string
  liveCoverage: number | null
  liveQuotedCount: number
  liveAssetCount: number
  settledDate: string | null
  settledStatus: ValuationStatus | null
  settledCoverage: number | null
  settledGapCount: number
}

/**
 * 把盘中报价与持久化快照明确拆成两条证据轨：实时数可变化，结算数保持可复核。
 * 只描述状态，不修改行情、快照或流水。
 */
export function buildDataSettlementState(
  series: SettlementSeriesPoint[],
  liveItems: LiveValuationItem[],
  todayKey: string,
): DataSettlementState {
  const liveValue = liveItems.reduce((sum, item) => sum + Math.abs(item.valueCny), 0)
  const quotedValue = liveItems.reduce((sum, item) => sum + (item.hasQuote ? Math.abs(item.valueCny) : 0), 0)
  const liveDates = liveItems.flatMap((item) => item.tradingDate ? [item.tradingDate] : [])
  const candidates = series.filter((point) => point.date <= todayKey && point.valuationStatus !== 'LIVE')
  const fullySettled = [...candidates].reverse().find((point) => point.valuationStatus === 'SETTLED')
  const settled = fullySettled ?? candidates.at(-1) ?? null

  return {
    liveDate: liveDates.sort().at(-1) ?? todayKey,
    liveCoverage: liveValue > 0 ? quotedValue / liveValue : null,
    liveQuotedCount: liveItems.filter((item) => item.hasQuote).length,
    liveAssetCount: liveItems.length,
    settledDate: settled?.date ?? null,
    settledStatus: settled?.valuationStatus ?? null,
    settledCoverage: settled?.valuationCoverage ?? null,
    settledGapCount: settled?.valuationGaps.length ?? 0,
  }
}
