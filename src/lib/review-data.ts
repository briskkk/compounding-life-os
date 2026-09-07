import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSession } from './session'
import { getWatchData, loadBenchmarkSeries } from './queries'
import { fxRateAtFactory } from './market/fx'
import { loadPriceSeries } from './market/persist'
import { alignBenchmark, BENCHMARK_INDICES, DEFAULT_BENCHMARK_SYMBOL } from './engine/benchmark'
import { buildAssetPerformanceSeries, type AssetNavPoint } from './engine/asset-performance'
import { performanceBetween, type PerformanceRange } from './engine/period-performance'
import { buildReviewResult, reconstructReviewPortfolioSeries, reviewRange, type ReviewPeriod, type ReviewResult } from './engine/review'
import { dateKeyAt } from './engine/watch-market'
import { isInvestableAsset } from './asset-classification'
import type { ValuationGap } from './engine/valuation-status'
import { pendingFundPurchasesAt, pendingSettlementsAt, roundMoney } from './engine/ledger'

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

export interface ReviewPendingPurchaseView {
  id: string
  assetName: string
  accountName: string
  amount: number
  originalAmount: number
  currency: string
  orderedAt: string
  navDate: string
}

export interface ReviewPageData {
  ctx: FamilyCtx
  period: ReviewPeriod
  range: PerformanceRange
  benchmarkSymbol: string
  benchmarks: typeof BENCHMARK_INDICES
  result: ReviewResult
  inTransit: number
  pendingPurchases: ReviewPendingPurchaseView[]
  pendingSettlements: ReviewPendingSettlementView[]
  savedReview: SavedReviewView | null
  month: string | null
  date: string | null
  currentMonth: string
  currentDate: string
}

function benchmarkFrom(value?: string): string {
  return BENCHMARK_INDICES.some((item) => item.symbol === value) ? value! : DEFAULT_BENCHMARK_SYMBOL
}

function periodFrom(value?: string): ReviewPeriod {
  return value === 'THIS_DAY' || value === 'THIS_WEEK' || value === 'THIS_QUARTER' ? value : 'THIS_MONTH'
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

function liveValuationFields(
  watch: NonNullable<Awaited<ReturnType<typeof getWatchData>>>,
): {
  coverage: number | null
  latestDate: string | null
  gaps: ValuationGap[]
} {
  const marketPositions = watch.state.valued.filter((position) => (
    isInvestableAsset(position.asset)
    && !position.asset.manual
    && position.asset.cls !== 'CASH'
    && position.asset.cls !== 'REAL_ESTATE'
    && Math.abs(position.investable) >= 0.005
  ))
  const totalValue = marketPositions.reduce((sum, position) => sum + Math.abs(position.investable), 0)
  const pricedValue = marketPositions.reduce((sum, position) => (
    sum + (watch.state.quotes.has(position.asset.symbol) ? Math.abs(position.investable) : 0)
  ), 0)
  const latestDate = [...watch.state.quotes.values()].reduce<string | null>((latest, quote) => {
    const date = quote.tradingDate || dateKeyAt(new Date(quote.asOf))
    return latest == null || date > latest ? date : latest
  }, null)
  const previousGaps = new Map(
    (watch.series.at(-1)?.valuationGaps ?? []).map((gap) => [gap.symbol, gap]),
  )
  const missing = new Map<string, ValuationGap>()
  for (const position of marketPositions) {
    if (watch.state.quotes.has(position.asset.symbol)) continue
    const previous = previousGaps.get(position.asset.symbol)
    const current = missing.get(position.asset.symbol) ?? {
      symbol: position.asset.symbol,
      name: position.asset.name,
      valuationDate: previous?.valuationDate ?? null,
      valueCny: 0,
      reason: previous?.reason === 'NO_PRICE' ? 'NO_PRICE' : 'PENDING',
    }
    current.valueCny += Math.round(position.investable)
    missing.set(position.asset.symbol, current)
  }
  return {
    coverage: totalValue > 0 ? pricedValue / totalValue : null,
    latestDate,
    gaps: [...missing.values()],
  }
}

export async function getReviewPageData(options: {
  period?: string
  benchmark?: string
  month?: string
  date?: string
} = {}, ctxOverride?: FamilyCtx): Promise<ReviewPageData | null> {
  const ctx = ctxOverride ?? await getSession()
  if (!ctx) return null
  const watch = await getWatchData(ctx)
  if (!watch) return null

  const period = periodFrom(options.period)
  const now = new Date()
  const today = dateKeyAt(now)
  const currentMonth = today.slice(0, 7)
  const range = reviewRange(period, now, options.month, options.date)
  const selectedMonth = period === 'THIS_MONTH' ? range.startDate.slice(0, 7) : null
  const selectedDate = period === 'THIS_DAY' ? range.startDate : null
  const isLiveRange = range.endDate === today
  const benchmarkSymbol = benchmarkFrom(options.benchmark)
  const db = scopedDb(prisma, ctx)
  const [rawAssets, rawAccounts] = await Promise.all([
    db.asset.findMany({ orderBy: { createdAt: 'asc' } }),
    db.account.findMany({ orderBy: { createdAt: 'asc' } }),
  ])
  const reviewAssets = rawAssets.filter(isInvestableAsset)
  const assetIds = new Set(reviewAssets.map((asset) => asset.id))
  const transactions = watch.state.ledgerTxs.filter((tx) => assetIds.has(tx.assetId))
  const symbols = reviewAssets.filter((asset) => asset.cls !== 'CASH').map((asset) => asset.symbol)
  const [priceMap, rateAt] = await Promise.all([
    loadPriceSeries(prisma, symbols),
    fxRateAtFactory(prisma, reviewAssets.map((asset) => asset.currency)),
  ])

  const assets = reviewAssets.map((asset) => {
    const prices = navPoints(asset.symbol, priceMap)
    const liveQuote = watch.state.quotes.get(asset.symbol)
    if (isLiveRange && liveQuote && asset.cls !== 'CASH') {
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

  const portfolioSeries = reconstructReviewPortfolioSeries({
    series: watch.series.map((point) => ({
      date: point.date,
      netWorth: point.investable,
      contributions: point.contributions,
      valuationStatus: point.valuationStatus,
      valuationCoverage: point.valuationCoverage,
      latestValuationDate: point.latestValuationDate,
      valuationGaps: point.valuationGaps,
    })),
    assets,
    transactions,
    rateAt: (currency, date) => rateAt(currency, date),
  })
  // 只有截至今日的周期才合入本次请求的实时报价；历史月严格保留历史证据。
  // 当前周期的组合期末与标的归因必须使用同一批报价，避免把行情时点差伪装成“待对账差额”。
  if (isLiveRange) {
    const liveValuation = liveValuationFields(watch)
    const livePoint = {
      date: range.endDate,
      netWorth: portfolioSeries.at(-1)?.date === range.endDate
        ? portfolioSeries.at(-1)!.netWorth
        : reconstructReviewPortfolioSeries({
            series: [{ date: range.endDate, netWorth: 0, contributions: watch.currentContributions }],
            assets,
            transactions,
            rateAt: (currency, date) => rateAt(currency, date),
          })[0].netWorth,
      contributions: watch.currentContributions,
      valuationStatus: 'LIVE' as const,
      valuationCoverage: liveValuation.coverage,
      latestValuationDate: liveValuation.latestDate,
      valuationGaps: liveValuation.gaps,
    }
    if (portfolioSeries.at(-1)?.date === livePoint.date) portfolioSeries[portfolioSeries.length - 1] = livePoint
    else portfolioSeries.push(livePoint)
  }
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
  const rangeEnd = new Date(`${range.endDate}T12:00:00+08:00`)
  const settlementsAtRangeEnd = pendingSettlementsAt(transactions, rangeEnd)
  const purchasesAtRangeEnd = pendingFundPurchasesAt(transactions, rangeEnd)
  const pendingSettlements = settlementsAtRangeEnd.map((settlement) => ({
    id: settlement.sellTxId,
    assetName: settlement.sellAssetId
      ? assetNameById.get(settlement.sellAssetId) ?? '基金赎回'
      : '基金赎回',
    accountName: accountNameById.get(settlement.accountId) ?? '资金账户',
    amount: settlement.amount * rateAt(settlement.currency, rangeEnd),
    originalAmount: settlement.amount,
    currency: settlement.currency,
    soldAt: settlement.soldAt ? dateKeyAt(settlement.soldAt) : null,
    settlementDate: dateKeyAt(settlement.settlementDate),
  }))
  const pendingPurchases = purchasesAtRangeEnd.map((purchase) => ({
    id: purchase.buyTxId,
    assetName: assetNameById.get(purchase.assetId) ?? '基金申购',
    accountName: accountNameById.get(purchase.accountId) ?? '基金账户',
    amount: purchase.amount * rateAt(purchase.currency, rangeEnd),
    originalAmount: purchase.amount,
    currency: purchase.currency,
    orderedAt: dateKeyAt(purchase.orderedAt),
    navDate: dateKeyAt(purchase.navDate),
  }))
  const inTransit = roundMoney(
    pendingSettlements.reduce((sum, settlement) => sum + settlement.amount, 0)
    + pendingPurchases.reduce((sum, purchase) => sum + purchase.amount, 0),
  )

  return {
    ctx,
    period,
    range,
    benchmarkSymbol,
    benchmarks: BENCHMARK_INDICES,
    result,
    inTransit,
    pendingPurchases,
    pendingSettlements,
    savedReview: savedReview ? {
      id: savedReview.id,
      status: savedReview.status,
      note: savedReview.note,
      authorName: savedReview.authorName,
      completedAt: savedReview.completedAt?.toISOString() ?? null,
      updatedAt: savedReview.updatedAt.toISOString(),
    } : null,
    month: selectedMonth,
    date: selectedDate,
    currentMonth,
    currentDate: today,
  }
}
