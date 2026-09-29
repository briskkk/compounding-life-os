import { redirect } from 'next/navigation'
import { PortfolioHistory } from '@/components/portfolio-history'
import { ReviewDomainNav } from '@/components/review-domain-nav'
import { InvestmentDomainNav } from '@/components/investment-domain-nav'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { parsePreferences } from '@/lib/preferences'
import { getWatchData, loadBenchmarks } from '@/lib/queries'
import { getGroupPerformance } from '@/lib/group-performance'
import { scopedDb } from '@/lib/scoped'
import { isInvestableAsset } from '@/lib/asset-classification'
import { performanceScopes } from '@/lib/engine/performance-scope'
import { PerformanceScopePicker } from '@/components/performance-scope-picker'

export const dynamic = 'force-dynamic'

export default async function ReviewReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; scope?: string }>
}) {
  const params = await searchParams
  const session = await getSession()
  if (!session) redirect('/login')

  const preferencesPromise = session.userId
    ? prisma.user.findUnique({ where: { id: session.userId }, select: { preferences: true } })
    : Promise.resolve(null)
  const scopedCandidate = params.scope && params.scope !== 'all'
    ? await getGroupPerformance(session, params.scope)
    : null
  const scoped = scopedCandidate?.scope.key === 'all' ? null : scopedCandidate
  const watchData = scoped ? null : await getWatchData(session)
  if (!scoped && !watchData) redirect('/login')
  const preferences = await preferencesPromise
  const scopeOptions = scoped?.scopes ?? performanceScopes(
    (await scopedDb(prisma, session).asset.findMany()).filter(isInvestableAsset),
  ).map(({ key, label }) => ({ key, label }))
  const series = scoped?.series ?? watchData!.series.map((point) => ({
    date: point.date,
    netWorth: point.investable,
    contributions: point.contributions,
    valuationStatus: point.valuationStatus,
    valuationCoverage: point.valuationCoverage,
    latestValuationDate: point.latestValuationDate,
    valuationGaps: point.valuationGaps,
  }))

  // 基准向前多取 10 天，保证区间首日落在非交易日时仍有可用收盘价。
  const benchmarks = series.length > 0
    ? await loadBenchmarks(
      new Date(new Date(`${series[0].date}T00:00:00Z`).getTime() - 10 * 86400000),
      new Date(),
    )
    : []
  const defaultRange = parsePreferences(preferences?.preferences ?? null).defaultRange ?? null

  return (
    <div className="page-shell review-shell">
      <InvestmentDomainNav active="history" />
      <ReviewDomainNav active="returns" params={params} />
      <PerformanceScopePicker options={scopeOptions} value={scoped?.scope.key ?? 'all'} />
      <PortfolioHistory
        series={series}
        livePoint={watchData ? {
          date: watchData.livePoint.date,
          netWorth: watchData.livePoint.investable,
          contributions: watchData.livePoint.contributions,
          valuationStatus: watchData.livePoint.valuationStatus,
          valuationCoverage: watchData.livePoint.valuationCoverage,
          latestValuationDate: watchData.livePoint.latestValuationDate,
          valuationGaps: watchData.livePoint.valuationGaps,
        } : null}
        liveDayReturn={scoped?.liveDayReturn ?? watchData?.liveDayReturn ?? null}
        benchmarks={benchmarks}
        initialPreset={defaultRange ?? undefined}
        scopeLabel={scoped?.scope.label}
      />
    </div>
  )
}
