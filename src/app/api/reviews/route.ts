// GET /api/reviews — 已保存复盘列表（游标分页）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { apiReadAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function reviewMetrics(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const db = scopedDb(prisma, auth.ctx)
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 20
  const cursor = req.nextUrl.searchParams.get('cursor')?.trim() || null
  if (cursor && !(await db.portfolioReview.findFirst({ where: { id: cursor } }))) {
    return NextResponse.json({ ok: false, error: '分页游标无效或已过期' }, { status: 400 })
  }
  const rows = await db.portfolioReview.findMany({
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return NextResponse.json({
    ok: true,
    reviews: page.map((review) => ({
      id: review.id,
      period: review.period,
      startDate: review.startDate.toISOString().slice(0, 10),
      endDate: review.endDate.toISOString().slice(0, 10),
      status: review.status,
      note: review.note,
      metrics: reviewMetrics(review.metricsSnapshot),
      authorName: review.authorName,
      completedAt: review.completedAt?.toISOString() ?? null,
      updatedAt: review.updatedAt.toISOString(),
    })),
    page: { limit, hasMore, nextCursor: hasMore ? page.at(-1)?.id ?? null : null },
  })
}
