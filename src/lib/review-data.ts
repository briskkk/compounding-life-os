import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSession } from './session'
import { getWatchData, loadBenchmarkSeries } from './queries'
import { fxRateAtFactory } from './market/fx'
import { loadPriceSeries } from './market/persist'
import { alignBenchmark, BENCHMARK_INDICES, DEFAULT_BENCHMARK_SYMBOL } from './engine/benchmark'
import { buildAssetPerformanceSeries, type AssetNavPoint } from './engine/asset-performance'
import { performanceBetween, performancePresetRange, type PerformanceRange } from './engine/period-performance'
import { buildReviewResult, type ReviewPeriod, type ReviewResult } from './engine/review'
import { dateKeyAt } from './engine/watch-market'

export interface SavedReviewView {
  id: string
  status: 'DRAFT' | 'COMPLETED'
  note: string
  authorName: string
  completedAt: string | null
  updatedAt: string
}

export interface ReviewPendingSettlementView {
  id: string
  assetName: string
  accountName: string
  amount: number
  originalAmount: number
  currency: string
  soldAt: string | null
  settlementDate: string
}

export interface ReviewPageData {
  ctx: FamilyCtx
  period: ReviewPeriod
  range: PerformanceRange
  benchmarkSymbol: string
  benchmarks: typeof BENCHMARK_INDICES
  result: ReviewResult
  inTransit: number
  pendingSettlements: ReviewPendingSettlementView[]
  savedReview: SavedReviewView | null
}

function quarterRange(now: Date): PerformanceRange {
  const endDate = dateKeyAt(now)
  const month = Number(endDate.slice(5, 7))
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1
  return {
    label: '本季度',
    startDate: `${endDate.slice(0, 4)}-${String(quarterMonth).padStart(2, '0')}-01`,
    endDate,
  }
}

export function reviewRange(period: ReviewPeriod, now = new Date()): PerformanceRange {
  return period === 'THIS_QUARTER' ? quarterRange(now) : performancePresetRange(period, now)
}

function benchmarkFrom(value?: string): string {
  return BENCHMARK_INDICES.some((item) => item.symbol === value) ? value! : DEFAULT_BENCHMARK_SYMBOL
}

function periodFrom(value?: string): ReviewPeriod {
  return value === 'THIS_WEEK' || value === 'THIS_QUARTER' ? value : 'THIS_MONTH'
}

function navPoints(
  symbol: string,
  priceMap: Awaited<ReturnType<typeof loadPriceSeries>>,
): AssetNavPoint[] {
  const series = priceMap.get(symbol)
  if (!series) return []
  return series.times.map((time, index) => ({
    date: series.valuationDates[index],
    nav: series.closes[index],
    source: series.sources[index],
  }))
}

export async function getReviewPageData(options: {
  period?: string
  benchmark?: string
} = {}): Promise<ReviewPageData | null> {
  const ctx = await getSession()
  if (!ctx) return null
  const watch = await getWatchData()
  if (!watch) return null

  const period = periodFrom(options.period)
  const range = reviewRange(period)
  const benchmarkSymbol = benchmarkFrom(options.benchmark)
  const db = scopedDb(prisma, ctx)
  const [rawAssets, rawAccounts] = await Promise.all([
    db.asset.findMany({ orderBy: { createdAt: 'asc' } }),
    db.account.findMany({ orderBy: { createdAt: 'asc' } }),
  ])
  const reviewAssets = rawAssets.filter((asset) => (
    asset.cls === 'CASH'
    || (!asset.manual && asset.cls !== 'REAL_ESTATE' && asset.cls !== 'HUAWEI_STOCK')
  ))
  const assetIds = new Set(reviewAssets.map((asset) => asset.id))
  const transactions = watch.state.ledgerTxs.filter((tx) => assetIds.has(tx.assetId))
  const symbols = reviewAssets.filter((asset) => asset.cls !== 'CASH').map((asset) => asset.symbol)
  const [priceMap, rateAt] = await Promise.all([
    loadPriceSeries(prisma, symbols),
    fxRateAtFactory(prisma),
  ])

  const assets = reviewAssets.map((asset) => {
    const prices = navPoints(asset.symbol, priceMap)
    const liveQuote = watch.state.quotes.get(asset.symbol)
    if (liveQuote && asset.cls !== 'CASH') {
      const liveDate = liveQuote.tradingDate || dateKeyAt(new Date(liveQuote.asOf))
      const liveNav = liveQuote.price
      const index = prices.findIndex((point) => point.date === liveDate)
      const point = { date: liveDate, nav: liveNav, source: liveQuote.source }
      if (index >= 0) prices[index] = point
      else prices.push(point)
    }
    prices.sort((a, b) => a.date.localeCompare(b.date))
    return {
      assetId: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      cls: asset.cls,
      style: asset.style,
      currency: asset.currency,
      series: buildAssetPerformanceSeries({
        asset: {
          id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          cls: asset.cls,
          manual: asset.manual,
          currency: asset.currency,
        },
        transactions,
        prices,
        to: new Date(`${range.endDate}T23:59:59Z`),
        currencyRate: (date) => rateAt(asset.currency, date),
      }),
    }
  })

  const portfolioSeries = watch.series.map((point) => ({
    date: point.date,
    netWorth: point.investable,
    contributions: point.contributions,
    valuationStatus: point.valuationStatus,
    valuationCoverage: point.valuationCoverage,
    latestValuationDate: point.latestValuationDate,
    valuationGaps: point.valuationGaps,
  }))
  const preliminary = performanceBetween(portfolioSeries, range.startDate, range.endDate, range.label)
  const benchmarkStart = new Date(`${range.startDate}T00:00:00Z`)
  benchmarkStart.setUTCDate(benchmarkStart.getUTCDate() - 10)
  const benchmarkPoints = await loadBenchmarkSeries(
    benchmarkSymbol,
    benchmarkStart,
    new Date(`${range.endDate}T23:59:59Z`),
  )
  const aligned = alignBenchmark(preliminary.curve.map((point) => point.date), benchmarkPoints)
  const benchmarkPct = [...aligned].reverse().find((value) => value != null) ?? null
  const result = buildReviewResult({
    portfolioSeries,
    assets,
    transactions,
    startDate: range.startDate,
    endDate: range.endDate,
    label: range.label,
    benchmarkPct,
    rateAt: (currency, date) => rateAt(currency, date),
  })

  const savedReview = await db.portfolioReview.findFirst({
    where: {
      period,
      startDate: new Date(`${range.startDate}T00:00:00Z`),
    },
  })
  const assetNameById = new Map(rawAssets.map((asset) => [asset.id, asset.name]))
  const accountNameById = new Map(rawAccounts.map((account) => [account.id, account.name]))
  const pendingSettlements = watch.state.pendingSettlements.map((settlement) => ({
    id: settlement.sellTxId,
    assetName: settlement.sellAssetId
      ? assetNameById.get(settlement.sellAssetId) ?? '基金赎回'
      : '基金赎回',
    accountName: accountNameById.get(settlement.accountId) ?? '资金账户',
    amount: settlement.amount * rateAt(settlement.currency, new Date()),
    originalAmount: settlement.amount,
    currency: settlement.currency,
    soldAt: settlement.soldAt ? dateKeyAt(settlement.soldAt) : null,
    settlementDate: dateKeyAt(settlement.settlementDate),
  }))

  return {
    ctx,
    period,
    range,
    benchmarkSymbol,
    benchmarks: BENCHMARK_INDICES,
    result,
    inTransit: watch.state.inTransit,
    pendingSettlements,
    savedReview: savedReview ? {
      id: savedReview.id,
      status: savedReview.status,
      note: savedReview.note,
      authorName: savedReview.authorName,
      completedAt: savedReview.completedAt?.toISOString() ?? null,
      updatedAt: savedReview.updatedAt.toISOString(),
    } : null,
  }
}
