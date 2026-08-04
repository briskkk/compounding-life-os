/** 洞察类型 → 处理页路由。总览「今日行动建议」与洞察页「前往处理」共用，保证指向一致。 */
export function insightHref(kind?: string): string {
  if (kind === 'GOAL_GAP' || kind === 'SAVINGS_RATE') return '/goals'
  if (kind === 'CONCENTRATION' || kind === 'STALE_VALUATION') return '/positions'
  if (kind === 'LIQUIDITY_LOW' || kind === 'CASH_DRAG') return '/accounts'
  return '/insights'
}
