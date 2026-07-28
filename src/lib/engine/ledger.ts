// 账本折叠：交易流水是唯一事实源，持仓由流水重放推导
import type { AssetClass, TxInput } from './types'

export interface Position {
  accountId: string
  assetId: string
  quantity: number // 总数量（RSU = 已归属 + 未归属；现金 = 余额）
  vestedQty: number // RSU 已归属
  unvestedQty: number // RSU 未归属
  costBasis: number // 剩余成本（移动平均成本法）
  realizedPnl: number // 已实现盈亏（卖出差价 + 分红利息 - 费用）
  manualValue: number | null // 最近一次手动估值总额
  lastValuationAt: Date | null
}

export const positionKey = (accountId: string, assetId: string) => `${accountId}:${assetId}`

export function emptyPosition(accountId: string, assetId: string): Position {
  return {
    accountId,
    assetId,
    quantity: 0,
    vestedQty: 0,
    unvestedQty: 0,
    costBasis: 0,
    realizedPnl: 0,
    manualValue: null,
    lastValuationAt: null,
  }
}

export function applyTransaction(pos: Position, tx: TxInput, cls: AssetClass): void {
  const q = tx.quantity ?? 0
  const p = tx.price ?? 0
  switch (tx.type) {
    case 'BUY': {
      pos.quantity += q
      pos.costBasis += q * p + tx.fee
      if (cls === 'RSU') pos.unvestedQty += q
      break
    }
    case 'SELL': {
      const unit = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0
      const sellQ = Math.min(q, pos.quantity)
      pos.realizedPnl += sellQ * p - tx.fee - unit * sellQ
      pos.quantity -= sellQ
      pos.costBasis -= unit * sellQ
      // RSU 卖出优先消耗已归属部分
      if (cls === 'RSU') pos.vestedQty = Math.max(0, pos.vestedQty - sellQ)
      break
    }
    case 'DEPOSIT': {
      pos.quantity += tx.amount
      pos.costBasis += tx.amount
      break
    }
    case 'WITHDRAW': {
      pos.quantity -= tx.amount
      pos.costBasis = Math.max(0, pos.costBasis - tx.amount)
      break
    }
    case 'TRANSFER_IN': {
      pos.quantity += q
      pos.costBasis += tx.amount // amount 携带转入成本
      // 转入的 RSU 视为已经取得并可处置的份额。
      if (cls === 'RSU') pos.vestedQty += q
      break
    }
    case 'TRANSFER_OUT': {
      const unit = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0
      const outQ = Math.min(q, pos.quantity)
      const carried = tx.amount > 0 ? tx.amount : unit * outQ
      pos.quantity -= outQ
      pos.costBasis = Math.max(0, pos.costBasis - carried)
      if (cls === 'RSU') pos.vestedQty = Math.max(0, pos.vestedQty - outQ)
      break
    }
    case 'DIVIDEND':
    case 'INTEREST': {
      pos.realizedPnl += tx.amount - tx.fee
      // 现金资产的利息/分红直接增加余额
      if (cls === 'CASH') {
        pos.quantity += tx.amount
        pos.costBasis += tx.amount
      }
      break
    }
    case 'FEE': {
      pos.realizedPnl -= tx.amount
      break
    }
    case 'VALUATION': {
      pos.manualValue = tx.amount
      pos.lastValuationAt = tx.occurredAt
      break
    }
    case 'VEST': {
      const v = Math.min(q, pos.unvestedQty)
      pos.unvestedQty -= v
      pos.vestedQty += v
      break
    }
    case 'REVERSAL': {
      // 冲正标记流水：本身无持仓影响（被冲正的原始流水以 voidedAt 排除）
      break
    }
  }
}

export type LedgerTx = TxInput & { assetClass: AssetClass }

/** 将流水重放为持仓集合；upTo 用于历史时点回放（财富轨迹） */
export function foldTransactions(txs: LedgerTx[], upTo?: Date): Position[] {
  const cutoff = upTo ? endOfDay(upTo).getTime() : null
  const sorted = txs
    .filter((t) => !t.voidedAt && (cutoff === null ? true : t.occurredAt.getTime() <= cutoff))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const map = new Map<string, Position>()
  for (const tx of sorted) {
    const key = positionKey(tx.accountId, tx.assetId)
    const pos = map.get(key) ?? emptyPosition(tx.accountId, tx.assetId)
    applyTransaction(pos, tx, tx.assetClass)
    map.set(key, pos)
  }
  return [...map.values()].filter(
    (p) => Math.abs(p.quantity) > 1e-9 || p.manualValue != null || p.realizedPnl !== 0,
  )
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
