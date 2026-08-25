// 服务端数据装配：页面从这里取数（所有读取都经过 family 作用域）
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSession, getSessionOrThrow } from './session'
import { foldTransactions, pendingSettlementsAt, roundMoney, type LedgerTx, type PendingSettlement } from './engine/ledger'
import { valuePositions, type ValuedPosition } from './engine/valuation'
import { aggregate, type Metrics } from './engine/metrics'
import { projectFireGoal, monthsBetween, type FireProjectionResult } from './engine/projection'
import type { ClassWeights } from './engine/covariance'
import { annualized, dailyNetFlows, twrSeries, xirr, xirrFlowsFromTxs } from './engine/attribution'
import { totalLiabilities, type LiabilityEntryInput } from './engine/liabilities'
import { quoteSmart, providerLabel, historySmart } from './market'
import { cachedQuote } from './market/cache'
import { BENCHMARK_INDICES, type BenchmarkPoint, type LoadedBenchmark } from './engine/benchmark'
import { cnyRateFor, fxRateAtFactory, fxRatesForCurrencies } from './market/fx'
import { eastmoneyFundProvider } from './market/eastmoney-fund'
import type { AssetInfo, TxInput } from './engine/types'
import { mergePositionsByAsset } from './engine/merge'
import { summarizeDailyPortfolio } from './engine/daily-pnl'
import { buildSavingsOverview, type SavingsOverview } from './engine/savings'
import type { QuoteData } from './market/provider'
import { isInvestableAsset, isPortfolioAssetClass } from './asset-classification'
import { dateKeyAt } from './engine/watch-market'
import type { ValuationGap, ValuationStatus } from './engine/valuation-status'
import { loadPriceSeries, priceAtFn, priceObservationAtFn } from './market/persist'
import { computeWealthSeries } from './snapshots'
import { fundConfirmationDate, isQdiiFund } from './engine/fund-order'
import { buildAssetPerformanceSeries, type AssetNavPoint } from './engine/asset-performance'
import { buildReviewResult, reconstructReviewPortfolioSeries, reviewRange, type ReviewPeriod, type ReviewResult } from './engine/review'

export interface LiabilityView {
  id: string
  name: string
  type: string
  rate: number | null
  balance: number
}

export interface EngineState {
  assets: AssetInfo[]
  valued: ValuedPosition[]
  quotes: Map<string, EngineQuote>
  metrics: Metrics // 资产端聚合（netWorth 字段 = 总资产，不含在途）
  txCount: number
  liabilitiesTotal: number
  liabilities: LiabilityView[]
  liabilityEntries: LiabilityEntryInput[]
  netWorth: number // 总资产（含在途资金）− 总负债
  investable: number // 可自由投资（含在途资金）
  /** 在途资金（赎回已申报、资金未到账），并入 netWorth / investable */
  inTransit: number
  pendingSettlements: PendingSettlement[]
  ledgerTxs: LedgerTx[]
  currencyRates: { CNY: number; USD: number; HKD: number }
}

export interface EngineQuote extends QuoteData {
  /** 按当前汇率折算的人民币价格，供估值引擎使用。 */
  priceCny: number
  prevCloseCny: number
}

export async function loadEngineState(ctx: FamilyCtx): Promise<EngineState> {
  const db = scopedDb(prisma, ctx)
  const [assetsRaw, txsRaw, liabilitiesRaw, entriesRaw] = await Promise.all([
    db.asset.findMany(),
    db.transaction.findMany({ include: { asset: true }, orderBy: { occurredAt: 'asc' } }),
    db.liability.findMany({ orderBy: { createdAt: 'asc' } }),
    db.liabilityEntry.findMany(),
  ])
  const assets: AssetInfo[] = assetsRaw.map((a) => ({
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    cls: a.cls,
    manual: a.manual,
    currency: a.currency,
  }))
  const ledgerTxs: LedgerTx[] = txsRaw.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    assetId: t.assetId,
    type: t.type,
    quantity: t.quantity == null ? null : Number(t.quantity),
    price: t.price == null ? null : Number(t.price),
    amount: Number(t.amount),
    fee: Number(t.fee),
    occurredAt: t.occurredAt,
    navDate: t.navDate,
    confirmationDate: t.navDate && t.asset.cls === 'FUND'
      ? fundConfirmationDate(t.navDate, { qdii: isQdiiFund(t.asset.symbol, t.asset.name) })
      : t.navDate,
    settlementDate: t.settlementDate,
    navSource: t.navSource,
    assetClass: t.asset.cls,
    internal: t.internal,
    voidedAt: t.voidedAt,
    settleOfId: t.settleOfId,
    currency: t.asset.currency,
    note: t.note,
  }))
  const entries: LiabilityEntryInput[] = entriesRaw.map((e) => ({
    liabilityId: e.liabilityId,
    type: e.type,
    amount: Number(e.amount),
    occurredAt: e.occurredAt,
  }))

  // 实时报价（混合源，逐个容错；US/HK 标的按实时汇率折人民币）
  // cls === 'FUND' 的资产统一走内部估值引擎（失败回落官方净值），其余走行情链路
  const listedAssets = assets.filter((a) => !a.manual && a.cls !== 'CASH' && a.cls !== 'REAL_ESTATE')
  const rates = await fxRatesForCurrencies(prisma, assets.map((asset) => asset.currency))
  const quotes = new Map<string, EngineQuote>()
  await Promise.all(
    listedAssets.map(async (a) => {
      try {
        if (a.cls === 'FUND') {
          // 盘中估值 / 盘后官方净值（eastmoneyFundProvider 内部按净值日期切换；外层 30s 缓存）
          const q = await cachedQuote(`fund|${a.symbol}`, () => eastmoneyFundProvider.quote(a.symbol))
          quotes.set(a.symbol, { ...q, priceCny: q.price, prevCloseCny: q.prevClose })
          return
        }
        const q = await quoteSmart(a.symbol)
        const rate = cnyRateFor(a.symbol, rates)
        quotes.set(a.symbol, { ...q, priceCny: q.price * rate, prevCloseCny: q.prevClose * rate })
      } catch {
        /* 无报价 → 成本回落 */
      }
    }),
  )

  const positions = foldTransactions(ledgerTxs)
  const currencyRate = (cur: string) => (cur === 'USD' ? rates.USDCNY : cur === 'HKD' ? rates.HKDCNY : 1)
  const valued = valuePositions(positions, new Map(assets.map((a) => [a.id, a])), (s) => quotes.get(s)?.priceCny, currencyRate)
  const metrics = aggregate(valued)

  // 在途资金：赎回已申报、结算腿未到账 —— 并入总资产与可自由投资口径（ADR-012）
  const pendingSettlements = pendingSettlementsAt(ledgerTxs, new Date())
  const inTransit = roundMoney(pendingSettlements.reduce((s, p) => s + p.amount * currencyRate(p.currency), 0))

  const balanceByLiability = new Map<string, number>()
  for (const l of liabilitiesRaw) {
    balanceByLiability.set(l.id, totalLiabilities(entries.filter((e) => e.liabilityId === l.id)))
  }
  const liabilities: LiabilityView[] = liabilitiesRaw.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    rate: l.rate,
    balance: balanceByLiability.get(l.id) ?? 0,
  }))
  const liabilitiesTotal = liabilities.reduce((s, l) => s + l.balance, 0)

  return {
    assets,
    valued,
    quotes,
    metrics,
    txCount: txsRaw.filter((t) => !t.voidedAt && isPortfolioAssetClass(t.asset.cls)).length,
    liabilitiesTotal,
    liabilities,
    liabilityEntries: entries,
    netWorth: metrics.netWorth + inTransit - liabilitiesTotal,
    investable: metrics.investable + inTransit,
    inTransit,
    pendingSettlements,
    ledgerTxs,
    currencyRates: { CNY: 1, USD: rates.USDCNY, HKD: rates.HKDCNY },
  }
}

export interface GoalView {
  id: string
  name: string
  mode: 'LUMP_SUM' | 'STREAM'
  targetAmount: number
  targetDate: string
  annualSpend: number | null
  spendYears: number | null
  retirementIncome: number
  withdrawalRate: number
  inflationRate: number
  metric: 'NET_WORTH' | 'INVESTABLE'
  monthlyContribution: number
  expectedReturn: number
  volatility: number
  note: string | null
  current: number
  monthsLeft: number
  projection: FireProjectionResult
  /** 以近月可持续投入替换计划投入的平行投影；未提供可持续投入时为 null */
  sustainableProjection: FireProjectionResult | null
}

export async function loadSavingsOverview(ctx: FamilyCtx, monthCount = 12): Promise<SavingsOverview> {
  const db = scopedDb(prisma, ctx)
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCMonth(start.getUTCMonth() - Math.max(0, monthCount - 1))
  const rows = await db.savingsEntry.findMany({
    where: { periodStart: { gte: start } },
    orderBy: [{ periodStart: 'asc' }, { updatedAt: 'asc' }],
  })
  return buildSavingsOverview(
    rows.map((row) => ({
      periodType: row.periodType,
      periodStart: row.periodStart,
      income: Number(row.income),
      spending: Number(row.spending),
      savedAmount: Number(row.savedAmount),
    })),
    new Date(),
    monthCount,
  )
}

/** 按口径聚合各类别权重（协方差模拟输入） */
function classWeights(valued: ValuedPosition[], field: 'value' | 'investable'): ClassWeights {
  const w: ClassWeights = {}
  for (const p of valued) {
    if (!isPortfolioAssetClass(p.asset.cls)) continue
    w[p.asset.cls] = (w[p.asset.cls] ?? 0) + p[field]
  }
  return w
}

export async function loadGoals(
  ctx: FamilyCtx,
  state: EngineState,
  opts: { sustainableMonthlySavings?: number } = {},
): Promise<GoalView[]> {
  const db = scopedDb(prisma, ctx)
  const goals = await db.goal.findMany({ orderBy: { targetDate: 'asc' } })
  const now = new Date()
  const investableW = classWeights(state.valued, 'investable')
  const grossW = classWeights(state.valued, 'value')
  return goals.map((g) => {
    const retirementIncome = Number(g.retirementIncome)
    const withdrawalRate = g.withdrawalRate
    const storedAnnualSpend = Number(g.annualSpend ?? 0)
    const target = g.mode === 'STREAM'
      ? Math.max(0, storedAnnualSpend - retirementIncome) / withdrawalRate
      : Number(g.targetAmount)
    const annualSpend = g.mode === 'STREAM'
      ? storedAnnualSpend
      : target * withdrawalRate + retirementIncome
    const retirementYears = g.spendYears ?? 40
    const current = g.metric === 'NET_WORTH' ? state.netWorth : state.investable
    const monthsLeft = monthsBetween(now, g.targetDate)
    const baseInput = {
      current,
      fireNumberToday: target,
      monthsToRetirement: monthsLeft,
      withdrawalRate,
      inflationRate: g.inflationRate,
      retirementYears,
      monthlyContribution: Number(g.monthlyContribution),
      annualReturn: g.expectedReturn,
      volatility: g.volatility,
      seed: [...g.id].reduce((s, c) => s + c.charCodeAt(0), 7),
      portfolioWeights: g.metric === 'NET_WORTH' ? grossW : investableW,
    }
    const projection = projectFireGoal(baseInput)
    const sustainableProjection = opts.sustainableMonthlySavings != null
      ? projectFireGoal({ ...baseInput, monthlyContribution: opts.sustainableMonthlySavings })
      : null
    return {
      id: g.id,
      name: g.name,
      mode: g.mode,
      targetAmount: target,
      targetDate: g.targetDate.toISOString(),
      annualSpend,
      spendYears: retirementYears,
      retirementIncome,
      withdrawalRate,
      inflationRate: g.inflationRate,
      metric: g.metric,
      monthlyContribution: Number(g.monthlyContribution),
      expectedReturn: g.expectedReturn,
      volatility: g.volatility,
      note: g.note,
      current,
      monthsLeft,
      projection,
      sustainableProjection,
    }
  })
}

export interface SeriesPoint {
  date: string
  netWorth: number
  investable: number
  contributions: number
  assets: number
  liabilities: number
  valuationStatus: ValuationStatus
  valuationCoverage: number | null
  latestValuationDate: string | null
  valuationGaps: ValuationGap[]
}

function parseValuationGaps(value: string): ValuationGap[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function snapshotValuationFields(snapshot: {
  valuationStatus: string
  valuationCoverage: number | null
  latestValuationDate: Date | null
  valuationDetails: string
}): Pick<SeriesPoint, 'valuationStatus' | 'valuationCoverage' | 'latestValuationDate' | 'valuationGaps'> {
  return {
    valuationStatus: snapshot.valuationStatus as ValuationStatus,
    valuationCoverage: snapshot.valuationCoverage,
    latestValuationDate: snapshot.latestValuationDate?.toISOString().slice(0, 10) ?? null,
    valuationGaps: parseValuationGaps(snapshot.valuationDetails),
  }
}

export interface Attribution {
  contributions: number // 可投资组合累计净投入
  gain: number // 可投资收益 = 可自由投资资产 − 净投入
  twrCumulative: number | null
  twrAnnualized: number | null
  xirr: number | null
}

export interface DashboardData {
  ctx: FamilyCtx
  familyName: string
  state: EngineState
  series: SeriesPoint[]
  marketDayPnl: number
  marketDayPnlPct: number | null
  delta30d: number | null
  attribution: Attribution
  goals: GoalView[]
  quotes: { symbol: string; name: string; price: number; prevClose: number; changePct: number; source: string; asOf: string }[]
  provider: string
  period: ReviewPeriod
  review: ReviewResult
}

export interface WatchData {
  state: EngineState
  series: SeriesPoint[]
  currentContributions: number
}

function nextDateKey(key: string): Date {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date
}

/**
 * PriceBar 可由资产详情页自愈更新，而持久化 Snapshot 只在显式行情刷新或业务写入时重建。
 * 看盘读取时用现有行情在内存补齐这段尾部，避免把多日变化集中归入最新访问日；不产生读路径写库。
 */
async function extendWatchSeriesFromPrices(
  state: EngineState,
  series: SeriesPoint[],
): Promise<SeriesPoint[]> {
  const symbols = state.assets
    .filter((asset) => !asset.manual && asset.cls !== 'CASH' && asset.cls !== 'REAL_ESTATE')
    .map((asset) => asset.symbol)
  if (symbols.length === 0 || state.ledgerTxs.length === 0) return series

  const latestBar = await prisma.priceBar.findFirst({
    where: { symbol: { in: symbols } },
    orderBy: { date: 'desc' },
    select: { date: true },
  })
  if (!latestBar) return series
  const latestSnapshotKey = series.at(-1)?.date ?? null
  const latestBarKey = dateKeyAt(latestBar.date)
  if (latestSnapshotKey != null && latestBarKey <= latestSnapshotKey) return series

  const [priceMap, rateAt] = await Promise.all([
    loadPriceSeries(prisma, symbols),
    fxRateAtFactory(prisma, state.assets.map((asset) => asset.currency)),
  ])
  const basePriceAt = priceAtFn(priceMap)
  const observationAt = priceObservationAtFn(priceMap)
  const priceAt = (symbol: string, date: Date) => {
    const value = basePriceAt(symbol, date)
    return value == null ? undefined : value * cnyRateFor(symbol, {
      USDCNY: rateAt('USD', date),
      HKDCNY: rateAt('HKD', date),
    })
  }
  const from = latestSnapshotKey != null
    ? nextDateKey(latestSnapshotKey)
    : state.ledgerTxs[0].occurredAt
  const today = new Date(`${dateKeyAt(new Date())}T00:00:00Z`)
  const tail = computeWealthSeries(
    state.ledgerTxs,
    state.assets,
    state.liabilityEntries,
    from,
    today,
    priceAt,
    rateAt,
    observationAt,
  ).map((point): SeriesPoint => ({
    date: point.date.toISOString().slice(0, 10),
    netWorth: point.netWorth,
    investable: point.investable,
    contributions: point.contributions,
    assets: point.assets,
    liabilities: point.liabilities,
    valuationStatus: point.valuationStatus,
    valuationCoverage: point.valuationCoverage,
    latestValuationDate: point.latestValuationDate,
    valuationGaps: parseValuationGaps(point.valuationDetails),
  }))
  return [...series, ...tail]
}

export function contributionsAtDates(series: { date: string }[], flows: Map<number, number>): number[] {
  const entries = [...flows.entries()].sort((a, b) => a[0] - b[0])
  let flowIndex = 0
  let cumulative = 0
  return series.map((point) => {
    const day = Math.floor(new Date(`${point.date}T00:00:00Z`).getTime() / 86400000)
    while (flowIndex < entries.length && entries[flowIndex][0] <= day) {
      cumulative += entries[flowIndex][1]
      flowIndex += 1
    }
    return cumulative
  })
}

/** 基准指数收盘价序列：优先 PriceBar 缓存（行情刷新时落库），不足时沿行情链取一次；全链失败返回空（调用方不展示基准，绝不伪造） */
export async function loadBenchmarkSeries(symbol: string, from: Date, to: Date): Promise<BenchmarkPoint[]> {
  const cached = await prisma.priceBar.findMany({
    where: { symbol, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  })
  if (cached.length >= 2) {
    return cached.map((bar) => ({ date: bar.date.toISOString().slice(0, 10), close: Number(bar.close) }))
  }
  try {
    const { bars } = await historySmart(symbol, from, to)
    return bars.map((bar) => ({ date: bar.date.toISOString().slice(0, 10), close: bar.close }))
  } catch {
    return []
  }
}

/** 加载全部可选基准指数；无数据的指数静默剔除 */
export async function loadBenchmarks(from: Date, to: Date): Promise<LoadedBenchmark[]> {
  const results = await Promise.all(
    BENCHMARK_INDICES.map(async (index) => ({
      ...index,
      points: await loadBenchmarkSeries(index.symbol, from, to),
    })),
  )
  return results.filter((result) => result.points.length >= 2)
}

/** 看盘只装配持仓与财富轨迹，避免触发目标投影和完整收益归因。 */
export async function getWatchData(ctxOverride?: FamilyCtx): Promise<WatchData | null> {
  const ctx = ctxOverride ?? await getSession()
  if (!ctx) return null
  const db = scopedDb(prisma, ctx)
  const [state, snaps] = await Promise.all([
    loadEngineState(ctx),
    db.snapshot.findMany({ orderBy: { date: 'asc' } }),
  ])
  let series: SeriesPoint[] = snaps.map((snapshot) => ({
    date: snapshot.date.toISOString().slice(0, 10),
    netWorth: Number(snapshot.netWorth),
    investable: Number(snapshot.investable),
    contributions: Number(snapshot.contributions),
    assets: Number(snapshot.assets),
    liabilities: Number(snapshot.liabilities),
    ...snapshotValuationFields(snapshot),
  }))
  series = await extendWatchSeriesFromPrices(state, series)

  const rates = await fxRatesForCurrencies(prisma, state.assets.map((asset) => asset.currency))
  const currencyRate = (currency: string) => currency === 'USD' ? rates.USDCNY : currency === 'HKD' ? rates.HKDCNY : 1
  const portfolioTxs = state.ledgerTxs.filter((tx) => isPortfolioAssetClass(tx.assetClass))
  const flows = dailyNetFlows(portfolioTxs, currencyRate)
  const normalizedContributions = contributionsAtDates(series, flows)
  series.forEach((point, index) => {
    point.contributions = Math.round(normalizedContributions[index])
  })
  const contributionsNow = [...flows.values()].reduce((sum, amount) => sum + amount, 0)
  return { state, series, currentContributions: Math.round(contributionsNow) }
}

function dashboardNavPoints(
  symbol: string,
  priceMap: Awaited<ReturnType<typeof loadPriceSeries>>,
): AssetNavPoint[] {
  const series = priceMap.get(symbol)
  if (!series) return []
  return series.times.map((_, index) => ({
    date: series.valuationDates[index],
    nav: series.closes[index],
    source: series.sources[index],
  }))
}

async function loadDashboardReview(
  state: EngineState,
  series: SeriesPoint[],
  period: ReviewPeriod,
): Promise<ReviewResult> {
  const range = reviewRange(period)
  const reviewAssets = state.assets.filter(isInvestableAsset)
  const assetIds = new Set(reviewAssets.map((asset) => asset.id))
  const transactions = state.ledgerTxs.filter((tx) => assetIds.has(tx.assetId))
  const symbols = reviewAssets.filter((asset) => asset.cls !== 'CASH').map((asset) => asset.symbol)
  const [priceMap, rateAt] = await Promise.all([
    loadPriceSeries(prisma, symbols),
    fxRateAtFactory(prisma, reviewAssets.map((asset) => asset.currency)),
  ])
  const assets = reviewAssets.map((asset) => {
    const prices = dashboardNavPoints(asset.symbol, priceMap)
    const liveQuote = state.quotes.get(asset.symbol)
    if (liveQuote && asset.cls !== 'CASH') {
      const liveDate = liveQuote.tradingDate || dateKeyAt(new Date(liveQuote.asOf))
      const point = { date: liveDate, nav: liveQuote.price, source: liveQuote.source }
      const index = prices.findIndex((item) => item.date === liveDate)
      if (index >= 0) prices[index] = point
      else prices.push(point)
    }
    prices.sort((a, b) => a.date.localeCompare(b.date))
    return {
      assetId: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      cls: asset.cls,
      style: null,
      currency: asset.currency,
      series: buildAssetPerformanceSeries({
        asset,
        transactions,
        prices,
        to: new Date(`${range.endDate}T23:59:59Z`),
        currencyRate: (date) => rateAt(asset.currency, date),
      }),
    }
  })

  const portfolioSeries = reconstructReviewPortfolioSeries({
    series: series.map((point) => ({
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

  return buildReviewResult({
    portfolioSeries,
    assets,
    transactions,
    startDate: range.startDate,
    endDate: range.endDate,
    label: range.label,
    rateAt: (currency, date) => rateAt(currency, date),
  })
}

export async function getDashboard(period: ReviewPeriod = 'THIS_MONTH'): Promise<DashboardData | null> {
  const ctx = await getSession()
  if (!ctx) return null
  const db = scopedDb(prisma, ctx)
  const family = await prisma.familySpace.findUnique({ where: { id: ctx.familyId } })
  const state = await loadEngineState(ctx)
  const snaps = await db.snapshot.findMany({ orderBy: { date: 'asc' } })
  const series: SeriesPoint[] = snaps.map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    netWorth: Number(s.netWorth),
    investable: Number(s.investable),
    contributions: Number(s.contributions),
    assets: Number(s.assets),
    liabilities: Number(s.liabilities),
    ...snapshotValuationFields(s),
  }))
  // 追加实时「今日」点
  const rates = await fxRatesForCurrencies(prisma, state.assets.map((asset) => asset.currency))
  const currencyRate = (cur: string) => (cur === 'USD' ? rates.USDCNY : cur === 'HKD' ? rates.HKDCNY : 1)
  const portfolioTxs = state.ledgerTxs.filter((tx) => isPortfolioAssetClass(tx.assetClass))
  const flows = dailyNetFlows(portfolioTxs, currencyRate)
  const normalizedContributions = contributionsAtDates(series, flows)
  series.forEach((point, index) => {
    point.contributions = Math.round(normalizedContributions[index])
  })
  const contributionsNow = [...flows.values()].reduce((a, b) => a + b, 0)
  const existingToday = series.at(-1)?.date === dateKeyAt(new Date()) ? series.at(-1) : null
  const livePoint: SeriesPoint = {
    date: dateKeyAt(new Date()),
    netWorth: Math.round(state.netWorth),
    investable: Math.round(state.investable),
    contributions: Math.round(contributionsNow),
    assets: Math.round(state.metrics.netWorth),
    liabilities: Math.round(state.liabilitiesTotal),
    valuationStatus: existingToday?.valuationStatus === 'CLOSED' || existingToday?.valuationStatus === 'FLOW_ONLY'
      ? existingToday.valuationStatus
      : 'LIVE',
    valuationCoverage: existingToday?.valuationCoverage ?? null,
    latestValuationDate: existingToday?.latestValuationDate ?? dateKeyAt(new Date()),
    valuationGaps: existingToday?.valuationGaps ?? [],
  }
  // 快照重建可能已经写入今日数据；实时点应覆盖今日快照，避免财富轨迹出现同日双点。
  if (series.at(-1)?.date === livePoint.date) series[series.length - 1] = livePoint
  else series.push(livePoint)

  const ago30 = snaps.length > 30 ? Number(snaps[snaps.length - 30].netWorth) : null
  const [goals, review] = await Promise.all([
    loadGoals(ctx, state),
    loadDashboardReview(state, series, period),
  ])

  // 收益归因
  const twr = twrSeries(
    series.map((p) => ({ date: new Date(p.date), netWorth: p.investable })),
    flows,
  )
  const lastTwr = twr.length > 0 ? twr[twr.length - 1].cumulative : null
  const days = series.length > 1 ? (new Date(series[series.length - 1].date).getTime() - new Date(series[0].date).getTime()) / 86400000 : 0
  const xirrValue = xirr(xirrFlowsFromTxs(portfolioTxs, currencyRate), state.investable, new Date())
  const attribution: Attribution = {
    contributions: Math.round(contributionsNow),
    gain: Math.round(state.investable - contributionsNow),
    twrCumulative: lastTwr,
    twrAnnualized: lastTwr != null ? annualized(lastTwr, days) : null,
    xirr: xirrValue,
  }

  const nameBySymbol = new Map(state.assets.map((a) => [a.symbol, a.name]))
  const quotes = [...state.quotes.values()].map((q) => ({
    symbol: q.symbol,
    name: nameBySymbol.get(q.symbol) ?? q.symbol,
    price: q.priceCny,
    prevClose: q.prevCloseCny,
    changePct: q.changePct,
    source: q.source,
    asOf: q.asOf,
  }))

  const mergedPositions = mergePositionsByAsset(
    state.valued.filter((position) => isPortfolioAssetClass(position.asset.cls)),
  ).filter((v) => Math.abs(v.quantity) > 1e-9)
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]))
  const staticValueCny = mergedPositions
    .filter((v) => v.asset.manual || v.asset.cls === 'CASH' || v.asset.cls === 'REAL_ESTATE')
    .reduce((sum, v) => sum + v.value, 0)
  const marketItems = mergedPositions
    .filter((v) => !v.asset.manual && v.asset.cls !== 'CASH' && v.asset.cls !== 'REAL_ESTATE')
    .map((v) => {
      const quote = quoteBySymbol.get(v.asset.symbol)
      return {
        currentValueCny: quote ? v.quantity * quote.price : v.value,
        previousValueCny: quote ? v.quantity * quote.prevClose : null,
      }
    })
  const marketDay = summarizeDailyPortfolio(marketItems, staticValueCny)

  return {
    ctx,
    familyName: family?.name ?? '家庭空间',
    state,
    series,
    marketDayPnl: marketDay.pnlCny,
    marketDayPnlPct: marketDay.pnlPct,
    delta30d: ago30 != null ? state.netWorth - ago30 : null,
    attribution,
    goals,
    quotes,
    provider: providerLabel(),
    period,
    review,
  }
}

export { getSessionOrThrow }
