// 服务端数据装配：页面从这里取数（所有读取都经过 family 作用域）
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSession, getSessionOrThrow } from './session'
import { foldTransactions, type LedgerTx } from './engine/ledger'
import { valuePositions, type ValuedPosition } from './engine/valuation'
import { aggregate, type Metrics } from './engine/metrics'
import { projectGoal, projectStreamGoal, monthsBetween, type ProjectionResult } from './engine/projection'
import type { ClassWeights } from './engine/covariance'
import { generateInsights, type InsightDraft } from './engine/insights'
import { annualized, dailyNetFlows, twrSeries, xirr, xirrFlowsFromTxs } from './engine/attribution'
import { totalLiabilities, type LiabilityEntryInput } from './engine/liabilities'
import { polishNarrative } from './ai/llm'
import { quoteSmart, providerLabel } from './market'
import { cnyRateFor, fxRates } from './market/fx'
import { eastmoneyFundProvider } from './market/eastmoney-fund'
import type { AssetInfo, TxInput } from './engine/types'
import { mergePositionsByAsset } from './engine/merge'
import { summarizeDailyPortfolio } from './engine/daily-pnl'

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
  metrics: Metrics // 资产端聚合（netWorth 字段 = 总资产）
  txCount: number
  liabilitiesTotal: number
  liabilities: LiabilityView[]
  netWorth: number // 总资产 − 总负债
  investable: number
  ledgerTxs: TxInput[]
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
  const quotes = new Map<string, number>()
  await Promise.all(
    listedAssets.map(async (a) => {
      try {
        if (a.cls === 'FUND') {
          // 盘中估值 / 盘后官方净值（eastmoneyFundProvider 内部按净值日期切换）
          const q = await eastmoneyFundProvider.quote(a.symbol)
          quotes.set(a.symbol, q.price)
          return
        }
        const q = await quoteSmart(a.symbol)
        quotes.set(a.symbol, q.price * cnyRateFor(a.symbol, rates))
      } catch {
        /* 无报价 → 成本回落 */
      }
    }),
  )

  const positions = foldTransactions(ledgerTxs)
  const currencyRate = (cur: string) => (cur === 'USD' ? rates.USDCNY : cur === 'HKD' ? rates.HKDCNY : 1)
  const valued = valuePositions(positions, new Map(assets.map((a) => [a.id, a])), (s) => quotes.get(s), currencyRate)
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
    metrics,
    txCount: txsRaw.filter((t) => !t.voidedAt).length,
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
  metric: 'NET_WORTH' | 'INVESTABLE'
  monthlyContribution: number
  expectedReturn: number
  volatility: number
  note: string | null
  current: number
  monthsLeft: number
  projection: ProjectionResult
}

/** 按口径聚合各类别权重（协方差模拟输入） */
function classWeights(valued: ValuedPosition[], field: 'value' | 'investable'): ClassWeights {
  const w: ClassWeights = {}
  for (const p of valued) {
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
    const target = Number(g.targetAmount)
    const current = g.metric === 'NET_WORTH' ? state.netWorth : state.investable
    const monthsLeft = monthsBetween(now, g.targetDate)
    const common = {
      monthlyContribution: Number(g.monthlyContribution),
      annualReturn: g.expectedReturn,
      volatility: g.volatility,
      seed: [...g.id].reduce((s, c) => s + c.charCodeAt(0), 7),
      portfolioWeights: g.metric === 'NET_WORTH' ? grossW : investableW,
    }
    const projection =
      g.mode === 'STREAM'
        ? projectStreamGoal({
            current,
            monthsAccum: monthsLeft,
            annualSpend: Number(g.annualSpend ?? 0),
            spendYears: g.spendYears ?? 0,
            ...common,
          })
        : projectGoal({ current, target, months: monthsLeft, ...common })
    return {
      id: g.id,
      name: g.name,
      mode: g.mode,
      targetAmount: target,
      targetDate: g.targetDate.toISOString(),
      annualSpend: g.annualSpend == null ? null : Number(g.annualSpend),
      spendYears: g.spendYears,
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

/** 洞察保鲜：超过 6 小时则重算（可选 LLM 润色） */
export async function ensureInsights(
  ctx: FamilyCtx,
  state: EngineState,
  goals: GoalView[],
): Promise<{ id: string; kind: string; severity: string; title: string; body: string; action: string | null; createdAt: string }[]> {
  const db = scopedDb(prisma, ctx)
  const latest = await db.insight.findFirst({ orderBy: { createdAt: 'desc' } })
  const fresh = latest && Date.now() - latest.createdAt.getTime() < 6 * 3600 * 1000
  if (fresh) {
    const rows = await db.insight.findMany({ orderBy: { createdAt: 'desc' }, take: 12 })
    return rows.map(serializeInsight)
  }

  const snaps = await db.snapshot.findMany({ orderBy: { date: 'desc' }, take: 31 })
  const netWorth30dAgo = snaps.length >= 30 ? Number(snaps[30].netWorth) : snaps.length > 1 ? Number(snaps[snaps.length - 1].netWorth) : null
  const prefs = await db.familyPrefs.findUnique({ where: { familyId: ctx.familyId } })

  const drafts: InsightDraft[] = generateInsights({
    metrics: { ...state.metrics, netWorth: state.netWorth },
    valued: state.valued,
    goals: goals.map((g) => ({ name: g.name, target: g.targetAmount, projection: g.projection })),
    netWorth30dAgo,
    now: new Date(),
    cashFloor: prefs?.cashFloor,
    concentrationCeiling: prefs?.concentrationCeiling,
    cashDragCeiling: prefs?.cashDragCeiling,
    drawdownThreshold: prefs?.drawdownThreshold,
    goalProbThreshold: prefs?.goalProbThreshold,
  })

  await db.insight.deleteMany({})
  for (const d of drafts) {
    const polished = await polishNarrative(d.title, `${d.body}${d.action ? ` 建议：${d.action}` : ''}`)
    await db.insight.create({
      data: {
        familyId: ctx.familyId,
        kind: d.kind,
        severity: d.severity,
        title: d.title,
        body: polished ?? d.body,
        action: d.action ?? null,
      },
    })
  }
  const rows = await db.insight.findMany({ orderBy: { createdAt: 'desc' }, take: 12 })
  return rows.map(serializeInsight)
}

function serializeInsight(i: { id: string; kind: string; severity: string; title: string; body: string; action: string | null; createdAt: Date }) {
  return { id: i.id, kind: i.kind, severity: i.severity, title: i.title, body: i.body, action: i.action, createdAt: i.createdAt.toISOString() }
}

export interface SeriesPoint {
  date: string
  netWorth: number
  investable: number
  contributions: number
  assets: number
  liabilities: number
}

export interface Attribution {
  contributions: number // 累计净投入
  gain: number // 投资收益 = 净资产 − 净投入
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
  insights: Awaited<ReturnType<typeof ensureInsights>>
  quotes: { symbol: string; name: string; price: number; prevClose: number; changePct: number }[]
  provider: string
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
  }))
  // 追加实时「今日」点
  const rates = await fxRates()
  const currencyRate = (cur: string) => (cur === 'USD' ? rates.USDCNY : cur === 'HKD' ? rates.HKDCNY : 1)
  const flows = dailyNetFlows(state.ledgerTxs, currencyRate)
  const contributionsNow = [...flows.values()].reduce((a, b) => a + b, 0)
  const livePoint: SeriesPoint = {
    date: new Date().toISOString().slice(0, 10),
    netWorth: Math.round(state.netWorth),
    investable: Math.round(state.investable),
    contributions: Math.round(contributionsNow),
    assets: Math.round(state.metrics.netWorth),
    liabilities: Math.round(state.liabilitiesTotal),
  }
  // 快照重建可能已经写入今日数据；实时点应覆盖今日快照，避免财富轨迹出现同日双点。
  if (series.at(-1)?.date === livePoint.date) series[series.length - 1] = livePoint
  else series.push(livePoint)

  const ago30 = snaps.length > 30 ? Number(snaps[snaps.length - 30].netWorth) : null
  const goals = await loadGoals(ctx, state)
  const insights = await ensureInsights(ctx, state, goals)

  // 收益归因
  const twr = twrSeries(
    series.map((p) => ({ date: new Date(p.date), netWorth: p.netWorth })),
    flows,
  )
  const lastTwr = twr.length > 0 ? twr[twr.length - 1].cumulative : null
  const days = series.length > 1 ? (new Date(series[series.length - 1].date).getTime() - new Date(series[0].date).getTime()) / 86400000 : 0
  const xirrValue = xirr(xirrFlowsFromTxs(state.ledgerTxs, currencyRate), state.netWorth, new Date())
  const attribution: Attribution = {
    contributions: Math.round(contributionsNow),
    gain: Math.round(state.netWorth - contributionsNow),
    twrCumulative: lastTwr,
    twrAnnualized: lastTwr != null ? annualized(lastTwr, days) : null,
    xirr: xirrValue,
  }

  const listed = state.assets.filter((a) => !a.manual && a.cls !== 'CASH' && a.cls !== 'REAL_ESTATE')
  const quotes = await Promise.all(
    listed.map(async (a) => {
      if (a.cls === 'FUND') {
        try {
          const q = await eastmoneyFundProvider.quote(a.symbol)
          return { symbol: a.symbol, name: a.name, price: q.price, prevClose: q.prevClose, changePct: q.changePct }
        } catch {
          /* 回落行情链路 */
        }
      }
      const q = await quoteSmart(a.symbol)
      const rate = cnyRateFor(a.symbol, rates)
      return {
        symbol: a.symbol,
        name: a.name,
        price: q.price * rate,
        prevClose: q.prevClose * rate,
        changePct: q.changePct,
      }
    }),
  )

  const mergedPositions = mergePositionsByAsset(state.valued).filter((v) => Math.abs(v.quantity) > 1e-9)
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
    insights,
    quotes,
    provider: providerLabel(),
  }
}

export { getSessionOrThrow }
