// GET /api/reviews/current?period=THIS_DAY&date=2026-09-04&benchmark=sh000300 — 复盘证据数据包
import { type NextRequest, NextResponse } from 'next/server'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { getReviewPageData } from '@/lib/review-data'

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
