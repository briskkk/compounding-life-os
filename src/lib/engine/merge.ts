// 跨账户持仓合并：同一资产在不同账户的持仓汇总为单一视图（展示层）
import type { ValuedPosition } from './valuation'

/**
 * 按 assetId 合并持仓行：数量/成本/市值/盈亏求和；
 * 价格取资产级（同资产同价）；手动估值求和；最近估值日取最新
 */
export function mergePositionsByAsset(positions: ValuedPosition[]): ValuedPosition[] {
  const map = new Map<string, ValuedPosition>()
  for (const p of positions) {
    const existing = map.get(p.assetId)
    if (!existing) {
      map.set(p.assetId, { ...p })
      continue
    }
    existing.quantity += p.quantity
    existing.availableQty += p.availableQty
    existing.vestedQty += p.vestedQty
    existing.unvestedQty += p.unvestedQty
    existing.costBasis += p.costBasis
    existing.realizedPnl += p.realizedPnl
    existing.value += p.value
    existing.investable += p.investable
    existing.costCny += p.costCny
    existing.realizedCny += p.realizedCny
    existing.unrealized += p.unrealized
    if (p.manualValue != null) existing.manualValue = (existing.manualValue ?? 0) + p.manualValue
    if (p.lastValuationAt && (!existing.lastValuationAt || p.lastValuationAt > existing.lastValuationAt)) {
      existing.lastValuationAt = p.lastValuationAt
    }
  }
  for (const v of map.values()) {
    if (v.asset.cls === 'CASH') {
      v.unrealized = 0
      v.unrealizedPct = null
    } else {
      v.unrealizedPct = v.costCny > 0 ? v.unrealized / v.costCny : null
    }
  }
  return [...map.values()]
}
