import type { AssetClass } from './engine/types'

export interface TransactionDraft {
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'VALUATION' | 'VEST'
  quantity: number | null
  price: number | null
  amount: number
  /** 基金成交净值所属日 */
  navDate?: Date | null
}

export interface TimelineTransaction {
  type: TransactionDraft['type'] | 'REVERSAL'
  quantity: number | null
  occurredAt: Date
  /** 基金成交净值所属日 */
  navDate?: Date | null
  /** BUY/TRANSFER_IN 的份额在确认完成日才可用 */
  confirmationDate?: Date | null
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
  /** 可用份额（排除确认中申购）；缺省时回退 quantity */
  availableQty?: number
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
    // 基金份额按两位小数确认，「金额 = 份额 × 净值」存在舍入误差；其余资产保持严格口径
    const tolerance = asset.cls === 'FUND'
      ? Math.max(0.05, Math.abs(expected) * 1e-5)
      : Math.max(0.01, Math.abs(expected) * 1e-8)
    if (Math.abs(draft.amount - expected) > tolerance) {
      throw new Error(`成交金额应等于数量 × 单价（应为 ${expected.toFixed(2)}）`)
    }
  }

  if ((draft.type === 'SELL' || draft.type === 'TRANSFER_OUT')) {
    // 可用份额优先（排除确认中的申购），缺省回退总持仓
    const sellable = available.availableQty ?? available.quantity
    if ((draft.quantity ?? 0) > sellable + EPSILON) {
      const pendingNote = available.availableQty != null && available.availableQty < available.quantity - EPSILON
        ? `（其中 ${(available.quantity - available.availableQty).toFixed(2)} 份申购确认中，暂不可卖出）`
        : ''
      throw new Error(`数量不足：当前可卖 ${sellable}，请求 ${draft.quantity ?? 0}${pendingNote}`)
    }
  }
}

/** 校验完整时间线，防止补录历史流水后让任意时点出现超卖。 */
export function assertTransactionTimeline(txs: TimelineTransaction[], asset: TransactionAsset): void {
  const active = txs.filter((tx) => !tx.voidedAt)
  // 申购/转入按确认完成日生效（普通基金 T+1、QDII T+2），卖出/转出按发生日冻结扣减
  const events = active
    .map((tx) => {
      const adds = tx.type === 'BUY' || tx.type === 'TRANSFER_IN'
      const removes = tx.type === 'SELL' || tx.type === 'TRANSFER_OUT'
      if (!adds && !removes) return null
      const effective = adds ? (tx.confirmationDate ?? tx.navDate ?? tx.occurredAt) : tx.occurredAt
      return { tx, adds, effective }
    })
    .filter((e): e is { tx: TimelineTransaction; adds: boolean; effective: Date } => e != null)
    // 同日先入账后卖出：确认日当天份额即可赎回
    .sort((a, b) => a.effective.getTime() - b.effective.getTime()
      || (a.adds === b.adds ? (a.tx.sequence ?? 0) - (b.tx.sequence ?? 0) : a.adds ? -1 : 1))

  let available = 0
  for (const { tx, adds } of events) {
    const q = tx.quantity ?? 0
    if (adds) {
      available += q
    } else {
      if (q > available + EPSILON) {
        throw new Error(`数量不足：${tx.occurredAt.toISOString().slice(0, 10)} 可用（已确认）${available}，请求 ${q}`)
      }
      available -= q
    }
  }
}
