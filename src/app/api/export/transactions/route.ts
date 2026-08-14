import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { toCsv, txToCsvRecord, TX_CSV_HEADERS } from '@/lib/export'
import { apiAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // 共享认证：用户会话优先，回落全局 PORTFOLIO_API_KEY；失败保持导出页「未初始化」语义
  const auth = await apiAuthCtx(req)
  if (!auth.ctx) return new Response('未初始化', { status: 400 })
  const ctx = auth.ctx
  const db = scopedDb(prisma, ctx)
  const txs = await db.transaction.findMany({
    where: {
      voidedAt: null,
      internal: false,
      type: { not: 'REVERSAL' },
      asset: { cls: { not: 'HUAWEI_STOCK' } },
    },
    include: { account: true, asset: true },
    orderBy: { occurredAt: 'asc' },
  })
  const records = txs.map((t) =>
    txToCsvRecord({
      occurredAt: t.occurredAt,
      accountName: t.account.name,
      symbol: t.asset.symbol,
      type: t.type,
      quantity: t.quantity == null ? null : Number(t.quantity),
      price: t.price == null ? null : Number(t.price),
      amount: Number(t.amount),
      fee: Number(t.fee),
      note: t.note,
    }),
  )
  const csv = toCsv(records, TX_CSV_HEADERS)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="family-wealth-transactions.csv"`,
    },
  })
}
