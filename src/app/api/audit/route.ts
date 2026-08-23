// GET /api/audit — 最近审计日志（移动端「账本完整性」下钻页）
// 认证：用户会话（Cookie 或 Bearer token）优先，回落 PORTFOLIO_API_KEY
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { apiAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = scopedDb(prisma, auth.ctx)

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 50), 1), 200)
  const rows = await db.auditLog.findMany({
    where: { familyId: auth.ctx.familyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    ok: true,
    entries: rows.map((e) => ({
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
  })
}
