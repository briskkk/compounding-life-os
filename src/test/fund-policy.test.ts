import { describe, expect, it } from 'vitest'
import {
  isFundPurchaseSuspended,
  parseRedemptionFeeRules,
  purchaseFeeReference,
  redemptionFeeRateForDays,
} from '@/lib/engine/fund-policy'

describe('fund trade policy', () => {
  it('parses and sorts valid redemption fee tiers', () => {
    const rules = parseRedemptionFeeRules('[{"maxHoldingDays":30,"rate":0.005},{"maxHoldingDays":7,"rate":0.015}]')
    expect(rules.map((rule) => rule.maxHoldingDays)).toEqual([7, 30])
    expect(redemptionFeeRateForDays(6, rules)).toBe(0.015)
    expect(redemptionFeeRateForDays(8, rules)).toBe(0.005)
    expect(redemptionFeeRateForDays(31, rules)).toBeNull()
  })

  it('calculates a reference fee without mutating transaction amount', () => {
    expect(purchaseFeeReference(10_000, 0.0015)).toBe(15)
    expect(purchaseFeeReference(0, 0.0015)).toBe(0)
  })

  it('treats suspension boundaries as inclusive', () => {
    const window = {
      purchaseSuspendedFrom: new Date('2026-08-20T12:00:00'),
      purchaseSuspendedUntil: new Date('2026-08-27T12:00:00'),
    }
    expect(isFundPurchaseSuspended(new Date('2026-08-20T09:00:00'), window)).toBe(true)
    expect(isFundPurchaseSuspended(new Date('2026-08-27T16:00:00'), window)).toBe(true)
    expect(isFundPurchaseSuspended(new Date('2026-08-28T09:00:00'), window)).toBe(false)
  })
})
