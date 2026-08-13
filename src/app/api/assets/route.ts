import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { getSession } from '@/lib/session'
import type { FamilyCtx } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { ALL_CLASSES } from '@/lib/engine/metrics'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import { dateKeyAt } from '@/lib/engine/watch-market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/assets
 *
 * 本钱 Life Capital APP 的专用端点（与 /api/monthly-summary、/api/monthly-trend 互补）。
 * 返回资产构成与净资产曲线，供 App 展示；不暴露交易流水。
 *
 * 认证：Bearer Token (PORTFOLIO_API_KEY 环境变量)
 * 与 Web UI 的 Cookie 会话并行，互不干扰。
 *
 * 返回：
 * - date: 最新快照日期；无快照时返回当前日期（Asia/Shanghai）
 * - netWorth: 净资产（总资产 − 总负债，来自 loadEngineState）
 * - investable: 可自由投资口径（来自 loadEngineState）
 * - cashRatio: 现金 / 投资组合价值（Metrics.cashRatio 透传）
 * - concentration: 最大单一非现金持仓（Metrics.concentration 透传，pct 为
 *   占投资组合权重）；无持仓时为 null
 * - composition[]: 7 类资产全量（按 ALL_CLASSES 顺序），value 为各类市值，
 *   pct = value / 总资产（Metrics.netWorth 毛口径，含房产/华为股票）
 * - series[]: 最近 90 个快照日（升序），netWorth / investable
 * - todayPnl: 当日盈亏（人民币口径，四舍五入到整数）
 * - todayPnlPct: 当日盈亏百分比（无基准时为 null）
 * - delta30d: 净资产较 30 个快照日前的增量（样本不足为 null）
 */
export async function GET(req: NextRequest) {
  // ── 获取家庭上下文 ────────────────────────────────────
  // 优先用户会话（Cookie 或 Bearer token），无会话时回落到全局 PORTFOLIO_API_KEY
  let ctx: FamilyCtx | null = await getSession()
  if (!ctx) {
    const apiKey = process.env.PORTFOLIO_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: 'PORTFOLIO_API_KEY not configured' },
        { status: 503 },
      )
    }

    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')
    if (token !== apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const owner = await prisma.member.findFirst({
      where: { role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    })
    if (!owner) {
      return NextResponse.json(
        { error: 'No family space initialized' },
        { status: 500 },
      )
    }
    ctx = {
      familyId: owner.familyId,
      memberId: owner.id,
      memberName: owner.name,
      role: owner.role,
      userId: owner.userId ?? '',
    }
  }

  const db = scopedDb(prisma, ctx)

  // ── 并行查询：实时引擎状态 + 最近 90 个快照日 ─────────
  const [state, recentSnapshots] = await Promise.all([
    loadEngineState(ctx),
    db.snapshot.findMany({
      orderBy: { date: 'desc' },
      take: 90,
    }),
  ])

  // ── 装配净资产曲线（取最近 90 个快照日，升序）─────────
  const series = recentSnapshots.reverse().map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    netWorth: Number(s.netWorth),
    investable: Number(s.investable),
  }))

  // ── 装配资产构成（7 类全量；pct 用总资产口径归一）──────
  const metrics = state.metrics
  const grossAssets = metrics.netWorth // 总资产（含房产/华为股票），与 byClass 之和一致
  const composition = ALL_CLASSES.map((cls) => {
    const value = Math.round(metrics.byClass[cls])
    return {
      class: cls,
      value,
      pct: grossAssets > 0 ? value / grossAssets : 0,
    }
  })

  // ── 当日盈亏与 30 日变化（复用 getDashboard 口径）────────
  const quoteBySymbol = new Map(
    [...state.quotes.values()].map((q) => [q.symbol, { price: q.priceCny, prevClose: q.prevCloseCny }]),
  )
  const mergedPositions = mergePositionsByAsset(
    state.valued.filter((v) => isPortfolioAssetClass(v.asset.cls)),
  ).filter((v) => Math.abs(v.quantity) > 1e-9)
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
  const delta30d = series.length > 30
    ? series[series.length - 1].netWorth - series[series.length - 31].netWorth
    : null

  return NextResponse.json({
    date: series.at(-1)?.date ?? dateKeyAt(new Date()),
    netWorth: Math.round(state.netWorth),
    investable: Math.round(state.investable),
    todayPnl: Math.round(marketDay.pnlCny),
    todayPnlPct: marketDay.pnlPct,
    delta30d,
    cashRatio: metrics.cashRatio,
    concentration: metrics.concentration
      ? { name: metrics.concentration.name, pct: metrics.concentration.weight }
      : null,
    composition,
    series,
  })
}
