export interface RedemptionFeeRule {
  maxHoldingDays: number
  rate: number
}

export interface FundTradePolicyLike {
  purchaseFeeRate: number
  redemptionFeeRules: string
  purchaseSuspendedFrom: Date | null
  purchaseSuspendedUntil: Date | null
}

export function parseRedemptionFeeRules(value: string): RedemptionFeeRule[] {
  try {
    const rows = JSON.parse(value) as unknown
    if (!Array.isArray(rows)) return []
    return rows
      .filter((row): row is RedemptionFeeRule => (
        typeof row === 'object'
        && row != null
        && Number.isInteger((row as RedemptionFeeRule).maxHoldingDays)
        && (row as RedemptionFeeRule).maxHoldingDays >= 0
        && Number.isFinite((row as RedemptionFeeRule).rate)
        && (row as RedemptionFeeRule).rate >= 0
        && (row as RedemptionFeeRule).rate <= 1
      ))
      .sort((a, b) => a.maxHoldingDays - b.maxHoldingDays)
  } catch {
    return []
  }
}

export function purchaseFeeReference(amount: number, rate: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) return 0
  return Math.round(amount * rate * 100) / 100
}

export function redemptionFeeRateForDays(holdingDays: number, rules: RedemptionFeeRule[]): number | null {
  if (!Number.isFinite(holdingDays) || holdingDays < 0) return null
  return rules.find((rule) => holdingDays <= rule.maxHoldingDays)?.rate ?? null
}

export function isFundPurchaseSuspended(
  occurredAt: Date,
  window: Pick<FundTradePolicyLike, 'purchaseSuspendedFrom' | 'purchaseSuspendedUntil'>,
): boolean {
  const at = new Date(occurredAt)
  at.setHours(0, 0, 0, 0)
  const from = window.purchaseSuspendedFrom ? new Date(window.purchaseSuspendedFrom) : null
  const until = window.purchaseSuspendedUntil ? new Date(window.purchaseSuspendedUntil) : null
  if (from) from.setHours(0, 0, 0, 0)
  if (until) until.setHours(23, 59, 59, 999)
  return (!from || at >= from) && (!until || at <= until) && Boolean(from || until)
}
