import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { toCsv, txToCsvRecord, TX_CSV_HEADERS } from '@/lib/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx) return new Response('未初始化', { status: 400 })
  const db = scopedDb(prisma, ctx)
  const txs = await db.transaction.findMany({
    where: { voidedAt: null, internal: false, type: { not: 'REVERSAL' } },
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
