import { type NextRequest } from 'next/server'
import { intradaySeriesBatch, type IntradaySeries } from '@/lib/market/intraday'
import { fundEstimate, fundEstimateMinuteSeries } from '@/lib/market/fund-engine'
import { shouldUseOfficialNav } from '@/lib/market/eastmoney-fund'
import { latestNav } from '@/lib/market/fund-holdings'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const responseCache = new Map<string, { at: number; payload: { asOf: string; series: Record<string, IntradaySeries> } }>()
const RESPONSE_CACHE_TTL = 20_000

/** 基金估值落库：同一分钟内去重 */
async function persistFundEstimates(fundSymbols: string[], series: Map<string, IntradaySeries>) {
  const now = new Date()
  await Promise.all(fundSymbols.map(async (symbol) => {
    const s = series.get(symbol)
    if (!s || s.points.length === 0) return
    const est = await fundEstimate(symbol)
    if (!est) return
    const minuteMs = Math.floor(now.getTime() / 60000) * 60000
    const last = await prisma.fundEstimate.findFirst({ where: { symbol }, orderBy: { createdAt: 'desc' } })
    if (last && last.createdAt.getTime() >= minuteMs) return
    const lastPoint = s.points[s.points.length - 1]
    await prisma.fundEstimate.create({
      data: {
        symbol,
        estimateReturn: est.estimate.estimateReturnPct / 100,
        estimatedNav: lastPoint.price,
        confidence: est.estimate.confidencePct / 100,
        detail: JSON.stringify(est.estimate.contributions),
      },
    })
  }))
}

export async function GET(req: NextRequest) {
  let symbols = (req.nextUrl.searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30)

  const ctx = await getSession()

  // symbols=all → 当前家庭全部非现金/房产资产的 symbol（移动端「看盘 · 全持仓」分时）
  if (symbols.includes('all') && ctx) {
    const db = scopedDb(prisma, ctx)
    const rows = await db.asset.findMany({
      where: { familyId: ctx.familyId, cls: { notIn: ['CASH', 'REAL_ESTATE'] } },
      select: { symbol: true },
    })
    symbols = [...new Set(rows.map((r) => r.symbol))].slice(0, 30)
  }

  // cls === 'FUND' 的资产走内部估值分钟序列，其余走行情分钟线
  const fundSymbols: string[] = []
  if (ctx) {
    const db = scopedDb(prisma, ctx)
    const rows = await db.asset.findMany({ where: { symbol: { in: symbols }, cls: 'FUND' } })
    fundSymbols.push(...rows.map((r) => r.symbol))
  }
  const fundSet = new Set(fundSymbols)
  const marketSymbols = symbols.filter((s) => !fundSet.has(s))
  const cacheKey = `${[...symbols].sort().join(',')}|fund:${[...fundSymbols].sort().join(',')}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.at < RESPONSE_CACHE_TTL) return Response.json(cached.payload)

  // 基金分时序列仅在「交易时段且今日净值未公布」时产出；
  // 非交易时段 / 净值已出 → 不产出估值序列，前端回落到官方净值报价
  const estimableFunds: string[] = []
  await Promise.all(
    fundSymbols.map(async (s) => {
      try {
        const nav = await latestNav(s)
        if (!shouldUseOfficialNav(nav.date, new Date())) estimableFunds.push(s)
      } catch {
        /* 净值取不到时保守估值 */
        estimableFunds.push(s)
      }
    }),
  )

  const map = await intradaySeriesBatch(marketSymbols, 'EXCHANGE')
  await Promise.all(
    estimableFunds.map(async (s) => {
      const { points, prevClose } = await fundEstimateMinuteSeries(s)
      if (points.length > 0) {
        map.set(s, { symbol: s, currency: 'CNY', points, prevClose, source: 'FUND-ENGINE' })
      }
    }),
  )
  await persistFundEstimates(estimableFunds, map)

  const payload = {
    asOf: new Date().toISOString(),
    series: Object.fromEntries(map),
  }
  responseCache.set(cacheKey, { at: Date.now(), payload })
  return Response.json(payload)
}
