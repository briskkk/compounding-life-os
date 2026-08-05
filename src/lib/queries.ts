// 服务端数据装配：页面从这里取数（所有读取都经过 family 作用域）
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSession, getSessionOrThrow } from './session'
import { foldTransactions, type LedgerTx } from './engine/ledger'
import { valuePositions, type ValuedPosition } from './engine/valuation'
import { aggregate, type Metrics } from './engine/metrics'
import { projectFireGoal, monthsBetween, type FireProjectionResult } from './engine/projection'
import type { ClassWeights } from './engine/covariance'
import { annualized, dailyNetFlows, twrSeries, xirr, xirrFlowsFromTxs } from './engine/attribution'
import { totalLiabilities, type LiabilityEntryInput } from './engine/liabilities'
import { quoteSmart, providerLabel, historySmart } from './market'
import { BENCHMARK_INDICES, type BenchmarkPoint, type LoadedBenchmark } from './engine/benchmark'
import { cnyRateFor, fxRates } from './market/fx'
import { eastmoneyFundProvider } from './market/eastmoney-fund'
import type { AssetInfo, TxInput } from './engine/types'
import { mergePositionsByAsset } from './engine/merge'
import { summarizeDailyPortfolio } from './engine/daily-pnl'
import { buildSavingsOverview, type SavingsOverview } from './engine/savings'
import type { QuoteData } from './market/provider'
import { isPortfolioAssetClass } from './asset-classification'
import { dateKeyAt } from './engine/watch-market'
import type { ValuationGap, ValuationStatus } from './engine/valuation-status'

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
  metrics: Metrics // 资产端聚合（netWorth 字段 = 总资产）
  txCount: number
  liabilitiesTotal: number
  liabilities: LiabilityView[]
  netWorth: number // 总资产 − 总负债
  investable: number
  ledgerTxs: LedgerTx[]
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
    accountId: t.accountId,
    assetId: t.assetId,
    type: t.type,
    quantity: t.quantity == null ? null : Number(t.quantity),
    price: t.price == null ? null : Number(t.price),
    amount: Number(t.amount),
    fee: Number(t.fee),
    occurredAt: t.occurredAt,
    assetClass: t.asset.cls,
    internal: t.internal,
    voidedAt: t.voidedAt,
    currency: t.asset.currency,
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
  const rates = await fxRates()
  const quotes = new Map<string, EngineQuote>()
  await Promise.all(
    listedAssets.map(async (a) => {
      try {
        if (a.cls === 'FUND') {
          // 盘中估值 / 盘后官方净值（eastmoneyFundProvider 内部按净值日期切换）
          const q = await eastmoneyFundProvider.quote(a.symbol)
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
    netWorth: metrics.netWorth - liabilitiesTotal,
    investable: metrics.investable,
    ledgerTxs,
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

export async function loadGoals(ctx: FamilyCtx, state: EngineState): Promise<GoalView[]> {
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
    const common = {
      monthlyContribution: Number(g.monthlyContribution),
      annualReturn: g.expectedReturn,
      volatility: g.volatility,
      seed: [...g.id].reduce((s, c) => s + c.charCodeAt(0), 7),
      portfolioWeights: g.metric === 'NET_WORTH' ? grossW : investableW,
    }
    const projection = projectFireGoal({
      current,
      fireNumberToday: target,
      monthsToRetirement: monthsLeft,
      withdrawalRate,
      inflationRate: g.inflationRate,
      retirementYears,
      ...common,
    })
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
}

export interface WatchData {
  state: EngineState
  series: SeriesPoint[]
}

function contributionsAtDates(series: SeriesPoint[], flows: Map<number, number>): number[] {
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
export async function getWatchData(): Promise<WatchData | null> {
  const ctx = await getSession()
  if (!ctx) return null
  const db = scopedDb(prisma, ctx)
  const [state, snaps] = await Promise.all([
    loadEngineState(ctx),
    db.snapshot.findMany({ orderBy: { date: 'asc' } }),
  ])
  const series: SeriesPoint[] = snaps.map((snapshot) => ({
    date: snapshot.date.toISOString().slice(0, 10),
    netWorth: Number(snapshot.netWorth),
    investable: Number(snapshot.investable),
    contributions: Number(snapshot.contributions),
    assets: Number(snapshot.assets),
    liabilities: Number(snapshot.liabilities),
    ...snapshotValuationFields(snapshot),
  }))

  const rates = await fxRates()
  const currencyRate = (currency: string) => currency === 'USD' ? rates.USDCNY : currency === 'HKD' ? rates.HKDCNY : 1
  const portfolioTxs = state.ledgerTxs.filter((tx) => isPortfolioAssetClass(tx.assetClass))
  const flows = dailyNetFlows(portfolioTxs, currencyRate)
  const normalizedContributions = contributionsAtDates(series, flows)
  series.forEach((point, index) => {
    point.contributions = Math.round(normalizedContributions[index])
  })
  const contributionsNow = [...flows.values()].reduce((sum, amount) => sum + amount, 0)
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
  if (series.at(-1)?.date === livePoint.date) series[series.length - 1] = livePoint
  else series.push(livePoint)

  return { state, series }
}

export async function getDashboard(): Promise<DashboardData | null> {
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
  const rates = await fxRates()
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
  const goals = await loadGoals(ctx, state)

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
  }
}

export { getSessionOrThrow }
