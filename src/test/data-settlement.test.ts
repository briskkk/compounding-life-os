import { describe, expect, it } from 'vitest'
import { buildDataSettlementState } from '@/lib/engine/data-settlement'

describe('buildDataSettlementState', () => {
  it('separates current quote coverage from the latest fully settled snapshot', () => {
    const result = buildDataSettlementState([
      { date: '2026-08-26', valuationStatus: 'SETTLED', valuationCoverage: 1, valuationGaps: [] },
      { date: '2026-08-27', valuationStatus: 'PARTIAL', valuationCoverage: 0.8, valuationGaps: [{}] },
      { date: '2026-08-28', valuationStatus: 'LIVE', valuationCoverage: 0.9, valuationGaps: [] },
    ], [
      { valueCny: 600, hasQuote: true, tradingDate: '2026-08-28' },
      { valueCny: 400, hasQuote: false, tradingDate: null },
    ], '2026-08-28')

    expect(result.liveCoverage).toBe(0.6)
    expect(result.liveQuotedCount).toBe(1)
    expect(result.settledDate).toBe('2026-08-26')
    expect(result.settledStatus).toBe('SETTLED')
  })

  it('falls back to the latest non-live snapshot when no fully settled day exists', () => {
    const result = buildDataSettlementState([
      { date: '2026-08-27', valuationStatus: 'PARTIAL', valuationCoverage: 0.8, valuationGaps: [{}, {}] },
    ], [], '2026-08-28')

    expect(result.settledDate).toBe('2026-08-27')
    expect(result.settledStatus).toBe('PARTIAL')
    expect(result.settledGapCount).toBe(2)
  })
})
