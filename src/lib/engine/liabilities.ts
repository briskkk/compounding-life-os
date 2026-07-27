// 负债折叠：DRAW 增加本金、REPAY 偿还、ADJUST 直接设定余额
export type LiabilityEntryType = 'DRAW' | 'REPAY' | 'ADJUST'

export interface LiabilityEntryInput {
  liabilityId: string
  type: LiabilityEntryType
  amount: number
  occurredAt: Date
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

/** 单笔负债在指定时点的余额（ADJUST 以时间序最后一条为准） */
export function foldLiability(entries: LiabilityEntryInput[], upTo?: Date): number {
  const cutoff = upTo ? endOfDay(upTo).getTime() : null
  const sorted = entries
    .filter((e) => (cutoff === null ? true : e.occurredAt.getTime() <= cutoff))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  let balance = 0
  for (const e of sorted) {
    if (e.type === 'DRAW') balance += e.amount
    else if (e.type === 'REPAY') balance = Math.max(0, balance - e.amount)
    else balance = e.amount
  }
  return balance
}

/** 全部负债余额合计 */
export function totalLiabilities(entries: LiabilityEntryInput[], upTo?: Date): number {
  const byLiability = new Map<string, LiabilityEntryInput[]>()
  for (const e of entries) {
    const list = byLiability.get(e.liabilityId) ?? []
    list.push(e)
    byLiability.set(e.liabilityId, list)
  }
  let sum = 0
  for (const list of byLiability.values()) sum += foldLiability(list, upTo)
  return sum
}
