// 账本折叠：交易流水是唯一事实源，持仓由流水重放推导
import type { AssetClass, TxInput } from './types'

/** 金额钳制：累加点统一保留 6 位小数，消除浮点累积漂移（分以下 4 位余量） */
const MONEY_SCALE = 1e6
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * MONEY_SCALE) / MONEY_SCALE
}

export interface Position {
  accountId: string
  assetId: string
  quantity: number // 总数量（现金资产中表示余额）
  availableQty: number // 可用份额：申购按派生确认完成日生效，赎回/转出按发生日扣减
  vestedQty: number // 兼容历史 RSU 流水，当前资产模型不再使用
  unvestedQty: number // 兼容历史 RSU 流水，当前资产模型不再使用
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
    availableQty: 0,
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
      pos.costBasis = roundMoney(pos.costBasis + q * p + tx.fee)
      break
    }
    case 'SELL': {
      const unit = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0
      const sellQ = Math.min(q, pos.quantity)
      pos.realizedPnl = roundMoney(pos.realizedPnl + sellQ * p - tx.fee - unit * sellQ)
      pos.quantity -= sellQ
      pos.costBasis = roundMoney(Math.max(0, pos.costBasis - unit * sellQ))
      break
    }
    case 'DEPOSIT': {
      pos.quantity += tx.amount
      pos.costBasis = roundMoney(pos.costBasis + tx.amount)
      break
    }
    case 'WITHDRAW': {
      pos.quantity -= tx.amount
      pos.costBasis = roundMoney(Math.max(0, pos.costBasis - tx.amount))
      break
    }
    case 'TRANSFER_IN': {
      pos.quantity += q
      pos.costBasis = roundMoney(pos.costBasis + tx.amount) // amount 携带转入成本
      break
    }
    case 'TRANSFER_OUT': {
      const unit = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0
      const outQ = Math.min(q, pos.quantity)
      const carried = tx.amount > 0 ? tx.amount : unit * outQ
      pos.quantity -= outQ
      pos.costBasis = roundMoney(Math.max(0, pos.costBasis - carried))
      break
    }
    case 'DIVIDEND':
    case 'INTEREST': {
      pos.realizedPnl = roundMoney(pos.realizedPnl + tx.amount - tx.fee)
      // 现金资产的利息/分红直接增加余额
      if (cls === 'CASH') {
        pos.quantity += tx.amount
        pos.costBasis = roundMoney(pos.costBasis + tx.amount)
      }
      break
    }
    case 'FEE': {
      pos.realizedPnl = roundMoney(pos.realizedPnl - tx.amount)
      break
    }
    case 'VALUATION': {
      pos.manualValue = tx.amount
      pos.lastValuationAt = tx.occurredAt
      break
    }
    case 'VEST': {
      // 仅为兼容历史 RSU 审计流水；该分类已由华为股票替代，不再改变持仓。
      break
    }
    case 'REVERSAL': {
      // 冲正标记流水：本身无持仓影响（被冲正的原始流水以 voidedAt 排除）
      break
    }
  }
}

export type LedgerTx = TxInput & {
  assetClass: AssetClass
  id?: string
  settleOfId?: string | null
  note?: string | null
}

/** 可用份额折叠：申购/转入按确认完成日生效；赎回/转出按发生日即时冻结扣减。 */
function applyAvailability(pos: Position, tx: TxInput, asOfMs: number): void {
  const q = tx.quantity ?? 0
  if (q <= 0) return
  if (tx.type === 'BUY' || tx.type === 'TRANSFER_IN') {
    const confirmMs = endOfDay(tx.confirmationDate ?? tx.navDate ?? tx.occurredAt).getTime()
    if (confirmMs <= asOfMs) pos.availableQty = roundMoney(pos.availableQty + q)
  } else if (tx.type === 'SELL' || tx.type === 'TRANSFER_OUT') {
    pos.availableQty = roundMoney(pos.availableQty - q)
  }
}

/** 将流水重放为持仓集合；upTo 用于历史时点回放（财富轨迹） */
export function foldTransactions(txs: LedgerTx[], upTo?: Date): Position[] {
  const cutoff = upTo ? endOfDay(upTo).getTime() : null
  // 可用份额口径：历史回放按回放日，实时状态按当前时间
  const asOfMs = cutoff ?? endOfDay(new Date()).getTime()
  const sorted = txs
    .filter((t) => !t.voidedAt && (cutoff === null ? true : t.occurredAt.getTime() <= cutoff))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const map = new Map<string, Position>()
  for (const tx of sorted) {
    const key = positionKey(tx.accountId, tx.assetId)
    const pos = map.get(key) ?? emptyPosition(tx.accountId, tx.assetId)
    applyTransaction(pos, tx, tx.assetClass)
    applyAvailability(pos, tx, asOfMs)
    map.set(key, pos)
  }
  return [...map.values()].filter(
    (p) => Math.abs(p.quantity) > 1e-9 || p.manualValue != null || p.realizedPnl !== 0,
  )
}

/** 在途资金派生项：赎回已申报、结算腿（现金到账）发生在 asOf 之后的资金。 */
export interface PendingSettlement {
  sellTxId: string
  sellAssetId: string | null // 被赎回的资产（UI 展示用）
  soldAt: Date | null // 赎回申报日
  accountId: string // 资金到账账户
  cashAssetId: string
  amount: number // 预计到账金额（原币，已扣费用）
  currency: string
  settlementDate: Date // 预计到账日
}

/**
 * 在途资金 = 未来发生的内部现金结算腿（仅赎回联动 DEPOSIT 腿可延迟）。
 * 净资产口径：份额在申报日已扣减、现金腿尚未生效，中间的差值即在途资金，
 * 由调用方（估值/快照）按当日汇率折人民币后并入总资产与可自由投资。
 */
export function pendingSettlementsAt(txs: LedgerTx[], asOf: Date): PendingSettlement[] {
  const cutoff = endOfDay(asOf).getTime()
  const byId = new Map(txs.map((t) => [t.id, t] as const))
  const result: PendingSettlement[] = []
  for (const leg of txs) {
    if (leg.voidedAt || !leg.internal || !leg.settleOfId || leg.type !== 'DEPOSIT') continue
    if (leg.occurredAt.getTime() <= cutoff) continue // 已到账
    const sell = byId.get(leg.settleOfId)
    if (!sell || sell.voidedAt || sell.type !== 'SELL') continue
    if (sell.occurredAt.getTime() > cutoff) continue // 赎回尚未申报（未来单），不算在途
    result.push({
      sellTxId: leg.settleOfId,
      sellAssetId: sell.assetId ?? null,
      soldAt: sell.occurredAt,
      accountId: leg.accountId,
      cashAssetId: leg.assetId,
      amount: leg.amount,
      currency: leg.currency ?? 'CNY',
      settlementDate: leg.occurredAt,
    })
  }
  return result
}

/** 按 (accountId, assetId) 索引的持仓快照（表单卖出关联 / 超卖拦截用） */
export function holdingsIndex(positions: Position[]): Record<string, { quantity: number; availableQty: number }> {
  const map: Record<string, { quantity: number; availableQty: number }> = {}
  for (const p of positions) {
    map[positionKey(p.accountId, p.assetId)] = { quantity: p.quantity, availableQty: p.availableQty }
  }
  return map
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
