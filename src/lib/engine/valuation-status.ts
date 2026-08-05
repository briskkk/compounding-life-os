export type ValuationStatus =
  | 'LEGACY'
  | 'SETTLED'
  | 'PARTIAL'
  | 'CLOSED'
  | 'NO_UPDATE'
  | 'FLOW_ONLY'
  | 'LIVE'

export interface ValuationGap {
  symbol: string
  name: string
  valuationDate: string | null
  valueCny: number
  reason?: 'PENDING' | 'MARKET_CLOSED' | 'NO_PRICE'
}

/** 这些快照保留余额与资金流，但不构成新的收益观察点。 */
export function isReturnObservation(status?: ValuationStatus): boolean {
  return status == null || !['CLOSED', 'NO_UPDATE', 'FLOW_ONLY'].includes(status)
}
