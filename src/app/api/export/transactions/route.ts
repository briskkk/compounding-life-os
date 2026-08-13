import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { toCsv, txToCsvRecord, TX_CSV_HEADERS } from '@/lib/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // 用户会话优先（Cookie 或 Bearer token）；无会话时兼容全局 PORTFOLIO_API_KEY
  let ctx = await getSession()
  if (!ctx) {
    const apiKey = process.env.PORTFOLIO_API_KEY
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')
    if (apiKey && token === apiKey) {
      const owner = await prisma.member.findFirst({
        where: { role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
      })
      if (owner) {
        ctx = {
          familyId: owner.familyId,
          memberId: owner.id,
          memberName: owner.name,
          role: owner.role,
          userId: owner.userId ?? '',
        }
      }
    }
  }
  if (!ctx) return new Response('未初始化', { status: 400 })
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
