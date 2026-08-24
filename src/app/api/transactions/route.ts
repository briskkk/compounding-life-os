// POST /api/transactions — 记一笔（移动端 APP 通道；与 Server Action createTransaction 共用同一写服务）
// GET  /api/transactions?assetId=xxx&limit=50&cursor=xxx — 流水游标列表（溯源）
// 认证：GET 可回落全局只读 Key；POST 必须真实用户 Cookie/Bearer 会话。
import { type NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { txInputSchema } from '@/lib/schemas'
import { createTransactionRecord, rebuildSnapshotsForFamily } from '@/lib/services/transactions'
import { apiReadAuthCtx, apiWriteAuthCtx } from '@/lib/services/api-auth'
import { auditedTransaction } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------- POST：记一笔 ----------

export async function POST(req: NextRequest) {
  const auth = await apiWriteAuthCtx(req)
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
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() || null
  if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return NextResponse.json({ ok: false, error: 'Idempotency-Key 需为 8–128 位字母、数字或 ._:-' }, { status: 400 })
  }
  const requestHash = idempotencyKey
    ? createHash('sha256').update(JSON.stringify(data)).digest('hex')
    : null

  if (idempotencyKey) {
    const existing = await prisma.transaction.findFirst({
      where: { familyId: auth.ctx.familyId, clientRequestId: idempotencyKey },
      select: { id: true, clientRequestHash: true },
    })
    if (existing) {
      if (existing.clientRequestHash !== requestHash) {
        return NextResponse.json({ ok: false, error: '该 Idempotency-Key 已用于不同请求' }, { status: 409 })
      }
      return NextResponse.json({ ok: true, id: existing.id, replayed: true })
    }
  }

  try {
    const { id: txId, affectedSince } = await auditedTransaction(prisma, auth.ctx.familyId, (txDb) =>
      createTransactionRecord(txDb, auth.ctx!, data, {
        clientRequestId: idempotencyKey ?? undefined,
        clientRequestHash: requestHash ?? undefined,
      }),
    )
    const warning = await rebuildSnapshotsForFamily(prisma, auth.ctx.familyId, affectedSince)
    return NextResponse.json({ ok: true, id: txId, replayed: false, warning })
  } catch (e) {
    if (idempotencyKey && typeof e === 'object' && e != null && 'code' in e && e.code === 'P2002') {
      const existing = await prisma.transaction.findFirst({
        where: { familyId: auth.ctx.familyId, clientRequestId: idempotencyKey },
        select: { id: true, clientRequestHash: true },
      })
      if (existing?.clientRequestHash === requestHash) {
        return NextResponse.json({ ok: true, id: existing.id, replayed: true })
      }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}

// ---------- GET：流水列表（溯源） ----------

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const assetId = req.nextUrl.searchParams.get('assetId') ?? undefined
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200) : 50
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim() || null
  const db = scopedDb(prisma, auth.ctx)
  if (cursor) {
    const cursorRow = await db.transaction.findFirst({ where: { id: cursor, ...(assetId ? { assetId } : {}), voidedAt: null } })
    if (!cursorRow) return NextResponse.json({ ok: false, error: '分页游标无效或已过期' }, { status: 400 })
  }
  const rows = await db.transaction.findMany({
    where: { ...(assetId ? { assetId } : {}), voidedAt: null },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { asset: { select: { id: true, symbol: true, name: true, cls: true } } },
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return NextResponse.json({
    ok: true,
    transactions: page.map((t) => ({
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
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    },
  })
}
