import type { AssetClass } from './engine/types'

export interface TransactionDraft {
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'VALUATION' | 'VEST'
  quantity: number | null
  price: number | null
  amount: number
}

export interface TimelineTransaction {
  type: TransactionDraft['type'] | 'REVERSAL'
  quantity: number | null
  occurredAt: Date
  voidedAt?: Date | null
  sequence?: number
}

export interface TransactionAsset {
  cls: AssetClass
  manual: boolean
}

export interface AvailablePosition {
  quantity: number
  unvestedQty: number
}

const EPSILON = 1e-8

/** 写入账本前必须满足的领域不变量。 */
export function assertTransactionRules(
  draft: TransactionDraft,
  asset: TransactionAsset,
  available: AvailablePosition = { quantity: 0, unvestedQty: 0 },
): void {
  if ((draft.type === 'DEPOSIT' || draft.type === 'WITHDRAW') && asset.cls !== 'CASH') {
    throw new Error('存入 / 取出只能记在现金资产上')
  }
  if (draft.type === 'VEST') {
    throw new Error('归属流水已停用；华为股票请使用买入、分红和估值流水')
  }
  if (draft.type === 'VALUATION' && asset.cls !== 'REAL_ESTATE' && !asset.manual) {
    throw new Error('估值流水只能记在手动估值资产上')
  }
  if ((draft.type === 'BUY' || draft.type === 'SELL') && asset.cls === 'CASH') {
    throw new Error('现金资产请使用存入 / 取出，不应使用买入 / 卖出')
  }

  if (draft.type === 'BUY' || draft.type === 'SELL') {
    const expected = (draft.quantity ?? 0) * (draft.price ?? 0)
    const tolerance = Math.max(0.01, Math.abs(expected) * 1e-8)
    if (Math.abs(draft.amount - expected) > tolerance) {
      throw new Error(`成交金额应等于数量 × 单价（应为 ${expected.toFixed(2)}）`)
    }
  }

  if ((draft.type === 'SELL' || draft.type === 'TRANSFER_OUT') && (draft.quantity ?? 0) > available.quantity + EPSILON) {
    throw new Error(`数量不足：当前可用 ${available.quantity}，请求 ${draft.quantity ?? 0}`)
  }
}

/** 校验完整时间线，防止补录历史流水后让任意时点出现超卖。 */
export function assertTransactionTimeline(txs: TimelineTransaction[], asset: TransactionAsset): void {
  const sorted = txs
    .filter((tx) => !tx.voidedAt)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.sequence ?? 0) - (b.sequence ?? 0))
  let quantity = 0

  for (const tx of sorted) {
    const q = tx.quantity ?? 0
    if (tx.type === 'BUY') {
      quantity += q
    } else if (tx.type === 'TRANSFER_IN') {
      quantity += q
    } else if (tx.type === 'SELL' || tx.type === 'TRANSFER_OUT') {
      if (q > quantity + EPSILON) {
        throw new Error(`数量不足：${tx.occurredAt.toISOString().slice(0, 10)} 可用 ${quantity}，请求 ${q}`)
      }
      quantity -= q
    }
  }
}
