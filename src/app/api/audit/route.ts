// GET /api/audit — 最近审计日志（移动端「账本完整性」下钻页）
// 认证：用户会话（Cookie 或 Bearer token）优先，回落全局只读 PORTFOLIO_API_KEY。
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { apiReadAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = scopedDb(prisma, auth.ctx)

  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200) : 50
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim() || null
  if (cursor) {
    const cursorRow = await db.auditLog.findFirst({ where: { id: cursor } })
    if (!cursorRow) return NextResponse.json({ ok: false, error: '分页游标无效或已过期' }, { status: 400 })
  }
  const rows = await db.auditLog.findMany({
    where: { familyId: auth.ctx.familyId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  return NextResponse.json({
    ok: true,
    entries: page.map((e) => ({
      id: e.id,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      detail: e.detail,
      actorName: e.actorName,
      hash: e.hash,
      prevHash: e.prevHash,
      createdAt: e.createdAt.toISOString(),
    })),
    page: { limit, hasMore, nextCursor: hasMore ? page.at(-1)?.id ?? null : null },
  })
}
