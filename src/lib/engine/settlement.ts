// 现金联动结算：买卖成交时自动生成同账户的现金结算腿（internal 标记）
import type { TxInput } from './types'

/**
 * BUY → WITHDRAW（金额 + 费用）
 * SELL → DEPOSIT（金额 − 费用）
 * 其余类型、零金额、现金资产自身 → 不产生结算腿
 */
export function buildSettlementLegs(tx: TxInput, cashAssetId: string): TxInput[] {
  if (tx.assetId === cashAssetId) return []
  if (tx.type === 'BUY') {
    const total = tx.amount + tx.fee
    if (total <= 0) return []
    return [
      {
        accountId: tx.accountId,
        assetId: cashAssetId,
        type: 'WITHDRAW',
        quantity: null,
        price: null,
        amount: total,
        fee: 0,
        occurredAt: tx.occurredAt,
        internal: true,
      },
    ]
  }
  if (tx.type === 'SELL') {
    const net = tx.amount - tx.fee
    if (net <= 0) return []
    return [
      {
        accountId: tx.accountId,
        assetId: cashAssetId,
        type: 'DEPOSIT',
        quantity: null,
        price: null,
        amount: net,
        fee: 0,
        occurredAt: tx.occurredAt,
        internal: true,
      },
    ]
  }
  return []
}
