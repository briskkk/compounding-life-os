// POST /api/transactions — 记一笔（移动端 APP 通道；与 Server Action createTransaction 共用同一写服务）
// GET  /api/transactions?assetId=xxx&limit=50 — 流水列表（溯源）
// 认证：优先用户会话（Cookie 或 Bearer token），无会话时回落 PORTFOLIO_API_KEY
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { txInputSchema } from '@/lib/schemas'
import { createTransactionRecord, rebuildSnapshotsForFamily } from '@/lib/services/transactions'
import { apiAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------- POST：记一笔 ----------

export async function POST(req: NextRequest) {
  const auth = await apiAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  if (auth.ctx.role === 'VIEWER') return NextResponse.json({ ok: false, error: '只读成员无权写操作' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const parsed = txInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join('；') },
      { status: 400 },
    )
  }
  const data = parsed.data

  try {
    const { id: txId, affectedSince } = await prisma.$transaction((txDb) =>
      createTransactionRecord(txDb, auth.ctx!, data),
    )
    const warning = await rebuildSnapshotsForFamily(prisma, auth.ctx.familyId, affectedSince)
    return NextResponse.json({ ok: true, id: txId, warning })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}

// ---------- GET：流水列表（溯源） ----------

export async function GET(req: NextRequest) {
  const auth = await apiAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const assetId = req.nextUrl.searchParams.get('assetId') ?? undefined
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 50), 1), 200)
  const db = scopedDb(prisma, auth.ctx)
  const rows = await db.transaction.findMany({
    where: { ...(assetId ? { assetId } : {}), voidedAt: null },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { asset: { select: { id: true, symbol: true, name: true, cls: true } } },
  })
  return NextResponse.json({
    ok: true,
    transactions: rows.map((t) => ({
      id: t.id,
      type: t.type,
      occurredAt: t.occurredAt.toISOString(),
      amount: Number(t.amount),
      fee: Number(t.fee),
      quantity: t.quantity == null ? null : Number(t.quantity),
      price: t.price == null ? null : Number(t.price),
      note: t.note,
      internal: t.internal,
      asset: { id: t.asset.id, symbol: t.asset.symbol, name: t.asset.name, cls: t.asset.cls },
    })),
  })
}
