import { redirect } from 'next/navigation'
import { PortfolioHistory } from '@/components/portfolio-history'
import { ReviewModeNav } from '@/components/review-mode-nav'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { parsePreferences } from '@/lib/preferences'
import { getWatchData, loadBenchmarks } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function ReviewReturnsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [watchData, preferences] = await Promise.all([
    getWatchData(session),
    session.userId
      ? prisma.user.findUnique({ where: { id: session.userId }, select: { preferences: true } })
      : Promise.resolve(null),
  ])
  if (!watchData) redirect('/login')

  // 基准向前多取 10 天，保证区间首日落在非交易日时仍有可用收盘价。
  const benchmarks = watchData.series.length > 0
    ? await loadBenchmarks(
      new Date(new Date(`${watchData.series[0].date}T00:00:00Z`).getTime() - 10 * 86400000),
      new Date(),
    )
    : []
  const defaultRange = parsePreferences(preferences?.preferences ?? null).defaultRange ?? null

  return (
    <div className="page-shell review-shell">
      <ReviewModeNav current="returns" />
      <PortfolioHistory
        series={watchData.series.map((point) => ({
          date: point.date,
          netWorth: point.investable,
          contributions: point.contributions,
          valuationStatus: point.valuationStatus,
          valuationCoverage: point.valuationCoverage,
          latestValuationDate: point.latestValuationDate,
          valuationGaps: point.valuationGaps,
        }))}
        livePoint={null}
        liveDayReturn={null}
        benchmarks={benchmarks}
        initialPreset={defaultRange ?? undefined}
      />
    </div>
  )
}
