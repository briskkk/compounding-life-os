// GET /api/mobile/returns-calendar?month=YYYY-MM — 与 Web /watch 同源的收益日历
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { getWatchData } from '@/lib/queries'
import { allYearTotals, monthDailyPoints, monthRange, yearMonthTotals } from '@/lib/engine/returns-calendar'
import { roundMoney } from '@/lib/engine/ledger'
import { dateKeyAt } from '@/lib/engine/watch-market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function validMonth(value: string | null): value is string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false
  return value <= dateKeyAt(new Date()).slice(0, 7)
}

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const month = req.nextUrl.searchParams.get('month')
  if (!validMonth(month)) {
    return NextResponse.json({ ok: false, error: 'month 必须是当前或历史月份 YYYY-MM' }, { status: 400 })
  }

  const watch = await getWatchData(auth.ctx)
  if (!watch) return NextResponse.json({ ok: false, error: '收益数据暂不可用' }, { status: 503 })
  const db = scopedDb(prisma, auth.ctx)
  const { startDate, endDate } = monthRange(month)
  const start = new Date(`${startDate}T00:00:00+08:00`)
  const end = new Date(`${endDate}T00:00:00+08:00`)
  end.setDate(end.getDate() + 1)
  const txRows = await db.transaction.findMany({
    where: { occurredAt: { gte: start, lt: end }, voidedAt: null },
    include: { asset: { select: { id: true, name: true, currency: true } } },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  const transactionsByDate = new Map<string, Array<{
    id: string
    type: string
    assetId: string
    assetName: string
    amount: number
    currency: string
    internal: boolean
  }>>()
  for (const row of txRows) {
    const date = dateKeyAt(row.occurredAt)
    const rows = transactionsByDate.get(date) ?? []
    rows.push({
      id: row.id,
      type: row.type,
      assetId: row.asset.id,
      assetName: row.asset.name,
      amount: Number(row.amount),
      currency: row.asset.currency,
      internal: row.internal,
    })
    transactionsByDate.set(date, rows)
  }

  const monthPoints = monthDailyPoints(watch.series, month)
  const days = [...monthPoints.values()]
    .filter((point) => point.dailyAmount != null)
    .map((point) => {
      const gaps = point.valuationGaps ?? []
      const valuationStatus = point.valuationStatus ?? 'LEGACY'
      const hasGap = valuationStatus === 'PARTIAL'
        || gaps.some((gap) => gap.reason !== 'MARKET_CLOSED')
      return {
        date: point.date,
        pnl: roundMoney(point.dailyAmount!),
        pnlPct: point.dailyPct,
        valuationStatus,
        hasGap,
        unsettled: valuationStatus === 'PARTIAL' || valuationStatus === 'NO_UPDATE',
        valuationCoverage: point.valuationCoverage ?? null,
        latestValuationDate: point.latestValuationDate ?? null,
        gaps,
        transactions: transactionsByDate.get(point.date) ?? [],
      }
    })

  const monthPnl = days.length > 0 ? roundMoney(days.reduce((sum, day) => sum + day.pnl, 0)) : null
  const unsettledDates = [...monthPoints.values()]
    .filter((point) => point.valuationStatus === 'PARTIAL' || point.valuationStatus === 'NO_UPDATE')
    .map((point) => ({
      date: point.date,
      valuationStatus: point.valuationStatus,
      hasReturn: point.dailyAmount != null,
    }))
  const year = Number(month.slice(0, 4))
  return NextResponse.json({
    ok: true,
    month,
    days,
    unsettledDates,
    monthSummary: { pnl: monthPnl, observationDays: days.length },
    yearSummary: {
      year,
      months: yearMonthTotals(watch.series, year).map((item) => ({
        month: item.key,
        pnl: item.hasAmount ? roundMoney(item.total) : null,
      })),
      years: allYearTotals(watch.series).map((item) => ({ year: Number(item.key), pnl: roundMoney(item.total) })),
    },
  })
}
