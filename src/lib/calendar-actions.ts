'use server'

// 收益日历读操作：当日流水（VIEWER 可读，RLS 作用域与页面一致）
import { prisma } from './db'
import { scopedDb } from './scoped'
import { getSession } from './session'

export interface CalendarDayTransaction {
  id: string
  type: string
  assetName: string
  amount: number
  currency: string
  internal: boolean
}

export type CalendarDayTransactionsResult =
  | { ok: true; txs: CalendarDayTransaction[] }
  | { ok: false; error: string }

/** 按上海时区自然日查询未冲正流水（含资产名），供收益日历当日明细使用。 */
export async function getCalendarDayTransactions(dateKey: string): Promise<CalendarDayTransactionsResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return { ok: false, error: '日期格式不正确' }
  const ctx = await getSession()
  if (!ctx) return { ok: false, error: '尚未初始化家庭空间' }
  const db = scopedDb(prisma, ctx)
  // 日期键口径与 dateKeyAt 一致（Asia/Shanghai，固定 +08:00）
  const start = new Date(`${dateKey}T00:00:00+08:00`)
  const end = new Date(start.getTime() + 86400000)
  const rows = await db.transaction.findMany({
    where: { occurredAt: { gte: start, lt: end }, voidedAt: null },
    include: { asset: { select: { name: true, currency: true } } },
    orderBy: { occurredAt: 'asc' },
  })
  return {
    ok: true,
    txs: rows.map((row) => ({
      id: row.id,
      type: row.type,
      assetName: row.asset.name,
      amount: Number(row.amount),
      currency: row.asset.currency,
      internal: row.internal,
    })),
  }
}
