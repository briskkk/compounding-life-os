// GET /api/mobile/summary — 移动端总览/账户/FIRE 数据包（一次拉取，降低移动端往返）
// 认证：用户会话（Cookie 或 Bearer token）优先，回落 PORTFOLIO_API_KEY
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { projectGoalViews } from '@/lib/engine/goal-views'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { livePreviousClose } from '@/lib/engine/portfolio-day'
import { positionDayPnlCny } from '@/lib/engine/account-summary'
import { buildPositionItem } from '@/lib/engine/position-view'
import { hasDailyPositionActivity } from '@/lib/engine/daily-trades'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86_400_000

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  const ctx = auth.ctx
  const db = scopedDb(prisma, ctx)

  const [state, accounts, lastAudit, snapshot30] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany({ include: { settlementFor: { select: { id: true } } }, orderBy: { createdAt: 'asc' } }),
    db.auditLog.findFirst({ orderBy: { createdAt: 'desc' } }),
    db.snapshot.findFirst({
      where: { date: { lte: new Date(Date.now() - 30 * DAY) } },
      orderBy: { date: 'desc' },
    }),
  ])

  const assetById = new Map(state.assets.map((a) => [a.id, a]))
  const quoteNow = new Date()

  // ── 总资产 / 现金流动性 / 当日盈亏（与 positions 口径一致）──
  let totalAssets = 0
  let cashLiquidity = 0
  let dayPnl = 0
  const accountValue = new Map<string, { marketValue: number; dayPnl: number }>()
  for (const p of state.valued) {
    const a = assetById.get(p.assetId)
    const value = p.value
    totalAssets += value
    if (a?.cls === 'CASH') cashLiquidity += value
    const quote = state.quotes.get(a?.symbol ?? '')
    const prev = livePreviousClose({
      asset: { symbol: a?.symbol ?? '', currency: a?.currency, cls: a?.cls },
      exchangeTradingDate: quote?.tradingDate,
      prevClose: quote?.prevCloseCny,
      now: quoteNow,
    })
    const positionPnl = positionDayPnlCny(p, prev) ?? 0
    dayPnl += positionPnl
    const bucket = accountValue.get(p.accountId) ?? { marketValue: 0, dayPnl: 0 }
    bucket.marketValue += value
    bucket.dayPnl += positionPnl
    accountValue.set(p.accountId, bucket)
  }
  const dayBaseline = totalAssets - dayPnl
  const dayPct = dayBaseline > 0 ? (dayPnl / dayBaseline) * 100 : 0

  // ── 30 日净资产增量 ──
  const latestSnapshot = await db.snapshot.findFirst({ orderBy: { date: 'desc' } })
  const baseForDelta = snapshot30?.netWorth != null ? Number(snapshot30.netWorth) : null
  const latestNet = latestSnapshot ? Number(latestSnapshot.netWorth) : state.netWorth
  const delta30 = baseForDelta != null ? latestNet - baseForDelta : null
  const delta30Pct = baseForDelta != null && baseForDelta > 0 ? (delta30! / baseForDelta) * 100 : null

  // ── 账户 ──
  const accountViews = accounts.map((acc) => {
    const v = accountValue.get(acc.id) ?? { marketValue: 0, dayPnl: 0 }
    return {
      id: acc.id,
      name: acc.name,
      type: acc.type,
      institution: acc.institution,
      currency: acc.currency,
      marketValue: v.marketValue,
      dayPnl: v.dayPnl,
      note: acc.note,
      isSettlement: acc.settlementFor.length > 0,
    }
  })

  // ── 负债（LiabilityView 已按 foldLiability 折叠真实余额）──
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const repayEntries = await db.liabilityEntry.findMany({ where: { type: 'REPAY', occurredAt: { gte: monthStart, lte: now } } })
  const repayByLiability = new Map<string, number>()
  for (const e of repayEntries) {
    repayByLiability.set(e.liabilityId, (repayByLiability.get(e.liabilityId) ?? 0) + Number(e.amount))
  }
  const liabilitiesView = state.liabilities.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    rate: l.rate,
    balance: l.balance,
    monthlyPayment: repayByLiability.get(l.id) ?? null,
  }))

  // ── FIRE / 目标（共享投影；与 /api/goals 同源同口径）──
  const goals = await db.goal.findMany({ orderBy: { createdAt: 'asc' } })
  const fireGoals = projectGoalViews(goals, state).map((v) => ({
    id: v.id,
    name: v.name,
    mode: v.mode,
    targetAmount: v.targetAmount,
    currentAssets: v.currentAssets,
    fundedPct: v.fundedPct,
    survivalProb: v.survivalProb,
    noDrawdownProb: v.noDrawdownProb,
    monthlyNeed: v.monthlyNeed,
    estimatedDate: v.estimatedDate,
    annualReturn: v.annualReturn,
    inflation: v.inflation,
    annualSpend: v.annualSpend,
    // v1.2：置信带曲线（p10/p50/p90），供 App FIRE 屏投影
    projection: v.projection ?? null,
  }))

  // ── 在途资产（v1.2：待确认申购 + 赎回到账；并入 netWorth/investable）──
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))
  const inTransit = {
    total: Math.round(state.inTransit * 100) / 100,
    purchase: Math.round(state.purchaseInTransit * 100) / 100,
    redemption: Math.round(state.redemptionInTransit * 100) / 100,
  }
  const cnyRateFor = (cur: string) =>
    cur === 'USD' ? state.currencyRates.USD : cur === 'HKD' ? state.currencyRates.HKD : 1
  const pendingPurchases = state.pendingFundPurchases.map((p) => ({
    id: p.buyTxId,
    assetId: p.assetId,
    assetName: assetById.get(p.assetId)?.name ?? null,
    accountId: p.accountId,
    accountName: accountNameById.get(p.accountId) ?? null,
    amount: Math.round(p.amount * 100) / 100,
    amountCny: Math.round(p.amount * cnyRateFor(p.currency) * 100) / 100,
    currency: p.currency,
    orderedAt: p.orderedAt.toISOString(),
    navDate: p.navDate.toISOString(),
  }))
  const pendingSettlements = state.pendingSettlements.map((s) => ({
    id: s.sellTxId,
    assetId: s.sellAssetId,
    assetName: s.sellAssetId ? (assetById.get(s.sellAssetId)?.name ?? null) : null,
    accountId: s.accountId,
    accountName: accountNameById.get(s.accountId) ?? null,
    amount: Math.round(s.amount * 100) / 100,
    amountCny: Math.round(s.amount * cnyRateFor(s.currency) * 100) / 100,
    currency: s.currency,
    soldAt: s.soldAt?.toISOString() ?? null,
    settlementDate: s.settlementDate.toISOString(),
  }))

  return NextResponse.json({
    ok: true,
    currency: 'CNY',
    netWorth: {
      totalAssets: Math.round(totalAssets * 100) / 100,
      liabilities: state.liabilitiesTotal,
      netWorth: state.netWorth,
      investable: state.investable,
      cashLiquidity: Math.round(cashLiquidity * 100) / 100,
      dayPnl: Math.round(dayPnl * 100) / 100,
      dayPct: Math.round(dayPct * 100) / 100,
      delta30: delta30 != null ? Math.round(delta30 * 100) / 100 : null,
      delta30Pct: delta30Pct != null ? Math.round(delta30Pct * 100) / 100 : null,
      updatedAt: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    accounts: accountViews,
    liabilities: liabilitiesView,
    fire: fireGoals,
    inTransit,
    pendingPurchases,
    pendingSettlements,
    ledger: { hash: lastAudit?.hash?.slice(0, 8) ?? null, txCount: state.txCount },
    positions: state.valued
      .filter((p) => p.asset.cls !== 'CASH' && hasDailyPositionActivity(p))
      .map((p) => buildPositionItem(p, state.quotes.get(p.asset.symbol), quoteNow)),
  })
}
