// GET /api/reviews/current?period=THIS_DAY&date=2026-09-04&benchmark=sh000300 — 复盘证据数据包
import { type NextRequest, NextResponse } from 'next/server'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { apiWriteAuthCtx } from '@/lib/services/api-auth'
import { getReviewPageData } from '@/lib/review-data'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { savePortfolioReviewRecord } from '@/lib/services/reviews'
import { portfolioReviewInputSchema } from '@/lib/schemas'
import { DEFAULT_BENCHMARK_SYMBOL } from '@/lib/engine/benchmark'
import { reviewRange } from '@/lib/engine/review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const data = await getReviewPageData({
    period: req.nextUrl.searchParams.get('period') ?? undefined,
    benchmark: req.nextUrl.searchParams.get('benchmark') ?? undefined,
    month: req.nextUrl.searchParams.get('month') ?? undefined,
    date: req.nextUrl.searchParams.get('date') ?? undefined,
  }, auth.ctx)
  if (!data) return NextResponse.json({ ok: false, error: '复盘数据暂不可用' }, { status: 503 })
  return NextResponse.json({
    ok: true,
    period: data.period,
    range: data.range,
    benchmarkSymbol: data.benchmarkSymbol,
    benchmarks: data.benchmarks,
    result: data.result,
    inTransit: data.inTransit,
    pendingPurchases: data.pendingPurchases,
    pendingSettlements: data.pendingSettlements,
    savedReview: data.savedReview,
  })
}

const putInputSchema = z.object({
  period: z.enum(['THIS_DAY', 'THIS_WEEK', 'THIS_MONTH', 'THIS_QUARTER']).default('THIS_MONTH'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  benchmarkSymbol: z.enum(['sh000300', 'sh000001', 'sz399006', 'sh000688']).default(DEFAULT_BENCHMARK_SYMBOL),
  status: z.enum(['DRAFT', 'COMPLETED']),
  note: z.string().max(4000, '复盘笔记最多 4000 字'),
})

/** PUT /api/reviews/current — 保存当前/指定历史日月复盘笔记与完成态。 */
export async function PUT(req: NextRequest) {
  const auth = await apiWriteAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  if (auth.ctx.role === 'VIEWER') return NextResponse.json({ ok: false, error: '只读成员无权写操作' }, { status: 403 })
  try {
    const body = putInputSchema.safeParse(await req.json())
    if (!body.success) {
      return NextResponse.json({ ok: false, error: body.error.issues.map((issue) => issue.message).join('；') }, { status: 400 })
    }
    const range = reviewRange(
      body.data.period,
      new Date(),
      body.data.period === 'THIS_MONTH' ? body.data.startDate?.slice(0, 7) : undefined,
      body.data.period === 'THIS_DAY' ? body.data.startDate : undefined,
    )
    if (body.data.startDate && body.data.startDate !== range.startDate) {
      return NextResponse.json({ ok: false, error: 'startDate 与所选复盘周期不一致' }, { status: 409 })
    }
    const input = portfolioReviewInputSchema.parse({
      period: body.data.period,
      benchmarkSymbol: body.data.benchmarkSymbol,
      startDate: range.startDate,
      endDate: range.endDate,
      status: body.data.status,
      note: body.data.note,
    })
    const saved = await savePortfolioReviewRecord(prisma, auth.ctx, input)
    return NextResponse.json({ ok: true, review: saved })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
