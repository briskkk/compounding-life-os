import { describe, expect, it } from 'vitest'
import { settlementStatus } from '@/lib/engine/settlement-status'

describe('结算状态（流水表「在途 / 已到账」）', () => {
  const today = '2026-09-16'

  it('到账日在未来 → 在途并给出自然日差', () => {
    expect(settlementStatus(new Date('2026-09-18T00:00:00Z'), today)).toEqual({ state: 'IN_TRANSIT', days: 2 })
  })

  it('到账日为今天或过去 → 已到账', () => {
    expect(settlementStatus(new Date('2026-09-16T00:00:00Z'), today)).toEqual({ state: 'SETTLED', days: 0 })
    expect(settlementStatus(new Date('2026-09-01T00:00:00Z'), today)).toEqual({ state: 'SETTLED', days: 0 })
  })

  it('没有到账日（如待确认申购主腿）→ 不标注状态', () => {
    expect(settlementStatus(null, today)).toEqual({ state: 'NONE', days: 0 })
    expect(settlementStatus(undefined, today)).toEqual({ state: 'NONE', days: 0 })
    expect(settlementStatus(new Date('invalid'), today)).toEqual({ state: 'NONE', days: 0 })
  })

  it('跨月与跨年按自然日计算', () => {
    expect(settlementStatus(new Date('2026-10-01T00:00:00Z'), '2026-09-30')).toEqual({ state: 'IN_TRANSIT', days: 1 })
    expect(settlementStatus(new Date('2027-01-01T00:00:00Z'), '2026-12-31')).toEqual({ state: 'IN_TRANSIT', days: 1 })
  })
})
