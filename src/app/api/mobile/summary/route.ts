// GET /api/mobile/summary — 移动端总览/账户/FIRE 数据包（一次拉取，降低移动端往返）
// 认证：用户会话（Cookie 或 Bearer token）优先，回落 PORTFOLIO_API_KEY
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { apiAuthCtx } from '@/lib/services/api-auth'
import { projectGoalViews } from '@/lib/engine/goal-views'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86_400_000

export async function GET(req: NextRequest) {
  const auth = await apiAuthCtx(req)
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

  // ── 总资产 / 现金流动性 / 当日盈亏（与 positions 口径一致）──
  let totalAssets = 0
  let cashLiquidity = 0
  let dayPnl = 0
  let priorTotal = 0
  const accountValue = new Map<string, { marketValue: number; dayPnl: number }>()
  for (const p of state.valued) {
    const a = assetById.get(p.assetId)
    const value = p.value
    totalAssets += value
    if (a?.cls === 'CASH') cashLiquidity += value
    const quote = state.quotes.get(a?.symbol ?? '')
    const prev = quote?.prevCloseCny
    if (prev != null && prev > 0) {
      const prior = p.quantity * prev
      priorTotal += prior
      dayPnl += value - prior
    }
    const bucket = accountValue.get(p.accountId) ?? { marketValue: 0, dayPnl: 0 }
    bucket.marketValue += value
    if (prev != null && prev > 0) bucket.dayPnl += value - p.quantity * prev
    accountValue.set(p.accountId, bucket)
  }
  const dayPct = priorTotal > 0 ? (dayPnl / priorTotal) * 100 : 0

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
    ledger: { hash: lastAudit?.hash?.slice(0, 8) ?? null, txCount: state.txCount },
    positions: state.valued
      .filter((p) => p.asset.cls !== 'CASH' && Math.abs(p.quantity) > 1e-9)
      .map((p) => {
        const a = assetById.get(p.assetId)!
        const quote = state.quotes.get(a.symbol)
        return {
          assetId: p.assetId,
          symbol: a.symbol,
          name: a.name,
          cls: a.cls,
          quantity: p.quantity,
          avgCost: p.quantity > 0 ? p.costCny / p.quantity : null,
          marketValue: p.value,
          dayPnl: 0,
          dayPnlPct: null,
          source: quote?.source ?? p.priceSource,
          manual: a.manual,
        }
      }),
  })
}
