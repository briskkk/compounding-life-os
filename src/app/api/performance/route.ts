import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getWatchData, loadBenchmarkSeries } from '@/lib/queries'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { annualized, dailyNetFlows, twrSeries, xirr, xirrFlowsFromTxs } from '@/lib/engine/attribution'
import { performanceBetween, performancePresetRange } from '@/lib/engine/period-performance'
import { riskMetrics } from '@/lib/engine/risk'
import { fxRatesForCurrencies } from '@/lib/market/fx'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { alignBenchmark, BENCHMARK_INDICES, DEFAULT_BENCHMARK_SYMBOL } from '@/lib/engine/benchmark'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/performance
 *
 * 本钱 Life Capital APP 的专用端点（与 /api/monthly-summary、/api/monthly-trend、
 * /api/assets 互补）。只返回可投资组合的收益归因与风险指标，不暴露交易流水。
 *
 * 认证：Bearer Token (PORTFOLIO_API_KEY 环境变量)
 * 与 Web UI 的 Cookie 会话并行，互不干扰。
 *
 * 口径（全部复用引擎现成函数，与总览页/看盘页一致，无新计算）：
 * - contributions: 可投资组合累计净投入（dailyNetFlows 全量求和，四舍五入到整数）
 * - investmentReturn: 投资收益 = 当前可自由投资资产 − 净投入（四舍五入到整数）
 * - twrCumulative / twrAnnualized: twrSeries 链式复利累计值及其按实际天数年化
 *   （与总览页 Attribution 同口径；快照序列以 investable 为净值，并追加实时「今日」点）
 * - xirr: 外部现金流 + 当前可投资资产作终值的资金加权年化（二分法，无可行解为 null）
 * - maxDrawdown / annualizedVolatility: performanceBetween 全区间 TWR 曲线
 *   经 riskMetrics 计算（与看盘页风险卡同口径）；样本不足为 null
 * - 比率字段保留引擎原精度，不做舍入
 */
export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = auth.ctx

  const watch = await getWatchData(ctx)
  if (!watch) return NextResponse.json({ error: '收益数据暂不可用' }, { status: 503 })
  const state = watch.state

  // ── 装配绩效序列（与看盘页 PortfolioHistory 的历史输入口径一致）──
  const rates = await fxRatesForCurrencies(prisma, state.assets.map((asset) => asset.currency))
  const currencyRate = (cur: string) => (cur === 'USD' ? rates.USDCNY : cur === 'HKD' ? rates.HKDCNY : 1)
  const portfolioTxs = state.ledgerTxs.filter((tx) => isPortfolioAssetClass(tx.assetClass))
  const flows = dailyNetFlows(portfolioTxs, currencyRate)

  const series = watch.series.map((point) => ({
    date: point.date,
    netWorth: point.investable,
    contributions: point.contributions,
    valuationStatus: point.valuationStatus,
    valuationCoverage: point.valuationCoverage,
    latestValuationDate: point.latestValuationDate,
    valuationGaps: point.valuationGaps,
  }))
  const contributionsNow = [...flows.values()].reduce((sum, amount) => sum + amount, 0)

  // ── 收益归因（与总览页 Attribution 同口径）─────────────
  const twr = twrSeries(
    series.map((p) => ({ date: new Date(p.date), netWorth: p.netWorth })),
    flows,
  )
  const lastTwr = twr.length > 0 ? twr[twr.length - 1].cumulative : null
  const days = series.length > 1
    ? (new Date(series[series.length - 1].date).getTime() - new Date(series[0].date).getTime()) / 86400000
    : 0
  const xirrValue = xirr(xirrFlowsFromTxs(portfolioTxs, currencyRate), state.investable, new Date())

  // ── 风险指标（全区间 TWR 曲线 → riskMetrics）───────────
  const range = performancePresetRange('ALL', new Date(), series[0]?.date)
  const performance = performanceBetween(series, range.startDate, range.endDate, range.label)
  const risk = riskMetrics(performance.curve)
  const requestedBenchmark = req.nextUrl.searchParams.get('benchmark')
  const benchmarkSymbol = BENCHMARK_INDICES.some((item) => item.symbol === requestedBenchmark)
    ? requestedBenchmark!
    : DEFAULT_BENCHMARK_SYMBOL
  const benchmarkStart = new Date(`${performance.curve[0]?.date ?? range.startDate}T00:00:00Z`)
  benchmarkStart.setUTCDate(benchmarkStart.getUTCDate() - 10)
  const benchmark = performance.curve.length > 0
    ? await loadBenchmarkSeries(benchmarkSymbol, benchmarkStart, new Date(`${range.endDate}T23:59:59Z`))
    : []
  const benchmarkCurve = alignBenchmark(performance.curve.map((point) => point.date), benchmark)

  return NextResponse.json({
    contributions: Math.round(contributionsNow),
    investmentReturn: Math.round(state.investable - contributionsNow),
    twrCumulative: lastTwr,
    twrAnnualized: lastTwr != null ? annualized(lastTwr, days) : null,
    xirr: xirrValue,
    maxDrawdown: risk.maxDrawdown,
    annualizedVolatility: risk.volatility,
    benchmarkSymbol,
    curve: performance.curve.map((point, index) => ({
      date: point.date,
      pct: point.pct,
      mwrPct: point.mwrPct,
      benchmarkPct: benchmarkCurve[index] ?? null,
      valuationStatus: point.valuationStatus ?? null,
    })),
  })
}
