// 现金联动结算：投资事件发生时自动生成指定资金账户的现金结算腿（internal 标记）
import type { TxInput } from './types'

/**
 * BUY → WITHDRAW（金额 + 费用），即时发生（申购当日资金即划出）
 * SELL → DEPOSIT（金额 − 费用），发生于 opts.settleAt（基金赎回在途：预计到账日）；
 *         缺省 settleAt = 成交日（股票等即时到账口径）
 * DIVIDEND / INTEREST → DEPOSIT（金额 − 费用）
 * FEE → WITHDRAW（金额）
 * 其余类型、零金额、现金资产自身 → 不产生结算腿
 */
export function buildSettlementLegs(
  tx: TxInput,
  cashAssetId: string,
  settlementAccountId: string,
  opts?: { settleAt?: Date },
): TxInput[] {
  if (tx.assetId === cashAssetId) return []
  if (tx.type === 'BUY') {
    const total = tx.amount + tx.fee
    if (total <= 0) return []
    return [
      {
        accountId: settlementAccountId,
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
    const settleAt = opts?.settleAt ?? tx.occurredAt
    return [
      {
        accountId: settlementAccountId,
        assetId: cashAssetId,
        type: 'DEPOSIT',
        quantity: null,
        price: null,
        amount: net,
        fee: 0,
        occurredAt: settleAt,
        internal: true,
      },
    ]
  }
  if (tx.type === 'DIVIDEND' || tx.type === 'INTEREST') {
    const net = tx.amount - tx.fee
    if (net <= 0) return []
    return [
      {
        accountId: settlementAccountId,
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
  if (tx.type === 'FEE') {
    if (tx.amount <= 0) return []
    return [
      {
        accountId: settlementAccountId,
        assetId: cashAssetId,
        type: 'WITHDRAW',
        quantity: null,
        price: null,
        amount: tx.amount,
        fee: 0,
        occurredAt: tx.occurredAt,
        internal: true,
      },
    ]
  }
  return []
}
