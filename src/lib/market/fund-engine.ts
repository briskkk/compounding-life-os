// 基金盘中估值编排：持仓画像 + 个股/指数实时行情 → 内部估值（不经过 index.ts，避免循环依赖）
import { estimateFund, estimateLinkedFund, estimateMinuteSeries, type InternalEstimate } from '@/lib/engine/fund-estimate'
import { buildCalibration, summarizeCalibration, type CalibrationPoint, type CalibrationSummary } from '@/lib/engine/fund-calibrate'
import { fundProfile, latestNav, fetchNavSeries, cnDayKey, type FundProfile } from './fund-holdings'
import { tencentProvider, tencentQuoteMany } from './tencent'
import { sinaProvider } from './sina'
import { intradaySeries, tencentMinuteSeries, type IntradayPoint } from './intraday'
import { parseSymbol, toTencentCode } from './symbols'
import { bestFitIndex, closesToReturns } from '@/lib/engine/benchmark'
import { CANDIDATE_INDICES, indexHistory, INDEX_SYMBOL } from './index-candidates'
import { prisma } from '@/lib/db'

export async function stockChangePct(code: string): Promise<number | null> {
  for (const p of [tencentProvider, sinaProvider]) {
    try {
      const q = await p.quote(code)
      return q.changePct * 100
    } catch {
      /* 下一源 */
    }
  }
  return null
}

/** 批量个股涨跌幅：一次腾讯请求（40/批），缺口新浪逐个补齐 */
export async function stockChangesBatch(codes: string[]): Promise<Map<string, number>> {
  const mapping = new Map<string, string>() // 腾讯代码（小写）→ 原始代码
  for (const code of codes) {
    // 指数等原始腾讯代码直接使用
    if (/^s[hz]\d{6}$/.test(code)) {
      mapping.set(code, code)
      continue
    }
    const t = toTencentCode(parseSymbol(code))
    if (t) mapping.set(t.toLowerCase(), code)
  }
  const out = new Map<string, number>()
  try {
    const quotes = await tencentQuoteMany([...mapping.keys()])
    for (const [t, orig] of mapping) {
      const q = quotes.get(t)
      if (q) out.set(orig, q.changePct * 100)
    }
  } catch {
    /* 批量失败 → 新浪逐个补 */
  }
  for (const orig of mapping.values()) {
    if (!out.has(orig)) {
      const change = orig === INDEX_SYMBOL ? await (async () => { try { return (await sinaProvider.quote(orig)).changePct * 100 } catch { return null } })() : await stockChangePct(orig)
      if (change != null) out.set(orig, change)
    }
  }
  return out
}

export interface FundEstimateResult {
  estimate: InternalEstimate
  prevNav: number
  prevNavDate: Date
  reportDate: string
}

const estimateCache = new Map<string, { at: number; result: FundEstimateResult }>()
const ESTIMATE_TTL = 60_000 // 60s（与采集节奏一致）

// 残差代理指数：按基金净值历史与候选指数相关性自动选择（24h 缓存）
const residualIndexCache = new Map<string, { at: number; code: string }>()
const RESIDUAL_TTL = 24 * 3600_000

export async function residualIndexFor(symbol: string): Promise<string> {
  const cached = residualIndexCache.get(symbol)
  if (cached && Date.now() - cached.at < RESIDUAL_TTL) return cached.code
  let code = INDEX_SYMBOL
  try {
    const navSeries = await fetchNavSeries(symbol)
    const navReturns = navSeries
      .slice(-61)
      .map((p) => ({ date: cnDayKey(new Date(p.x)), ret: (p.equityReturn ?? 0) / 100 }))
    const indexReturnsByCode = new Map<string, { date: string; ret: number }[]>()
    await Promise.all(
      CANDIDATE_INDICES.map(async (c) => {
        try {
          indexReturnsByCode.set(c.code, closesToReturns(await indexHistory(c.code, 120)))
        } catch {
          /* 跳过取不到的指数 */
        }
      }),
    )
    const fit = bestFitIndex(navReturns, indexReturnsByCode)
    if (fit) code = fit.code
  } catch {
    /* 回落默认指数 */
  }
  residualIndexCache.set(symbol, { at: Date.now(), code })
  return code
}

/** 计算基金内部估值（60s 缓存） */
export async function fundEstimate(symbol: string): Promise<FundEstimateResult | null> {
  const cached = estimateCache.get(symbol)
  if (cached && Date.now() - cached.at < ESTIMATE_TTL) return cached.result
  try {
    const [profile, nav] = await Promise.all([fundProfile(symbol), latestNav(symbol)])

    // 联接基金：目标 ETF 驱动（单目标高置信）
    if (profile.etfCode) {
      const etfChange = await stockChangePct(profile.etfCode)
      const estimate = estimateLinkedFund({
        etfCode: profile.etfCode,
        etfName: profile.etfName ?? profile.etfCode,
        etfChangePct: etfChange,
        weightPct: profile.equityRatioPct,
        prevNav: nav.nav,
      })
      const result: FundEstimateResult = { estimate, prevNav: nav.nav, prevNavDate: nav.date, reportDate: profile.reportDate }
      estimateCache.set(symbol, { at: Date.now(), result })
      return result
    }

    const codes = profile.holdings.map((h) => h.code)
    const residIndex = await residualIndexFor(symbol)
    const changes = await stockChangesBatch([...codes, residIndex])
    const indexChange = changes.get(residIndex) ?? 0
    const estimate = estimateFund({
      holdings: profile.holdings,
      equityRatioPct: profile.equityRatioPct,
      indexChangePct: indexChange,
      stockChanges: changes,
      prevNav: nav.nav,
    })
    const result: FundEstimateResult = { estimate, prevNav: nav.nav, prevNavDate: nav.date, reportDate: profile.reportDate }
    estimateCache.set(symbol, { at: Date.now(), result })
    return result
  } catch {
    return null
  }
}

/** 分钟级估值序列：重仓股（A 股分钟线）+ 沪深300 分钟线合成 */
export async function fundEstimateMinuteSeries(symbol: string): Promise<{ points: IntradayPoint[]; prevClose: number | null; profile: FundProfile | null }> {
  const empty = { points: [], prevClose: null, profile: null }
  try {
    const [profile, nav] = await Promise.all([fundProfile(symbol), latestNav(symbol)])

    // 联接基金：目标 ETF 分钟线 × 仓位
    if (profile.etfCode) {
      const etfSeries = await intradaySeries(profile.etfCode)
      if (!etfSeries || etfSeries.points.length === 0) return empty
      const weight = profile.equityRatioPct / 100
      const etfPrevClose = etfSeries.prevClose ?? etfSeries.points[0].price
      const points = etfSeries.points.map((p) => ({
        t: p.t,
        price: nav.nav * (1 + (p.price / etfPrevClose - 1) * weight),
      }))
      return { points, prevClose: nav.nav, profile }
    }

    const residIndex = await residualIndexFor(symbol)
    const indexSeries = await tencentMinuteSeries(residIndex)
    if (!indexSeries || indexSeries.points.length === 0) return empty
    const indexPrevClose = indexSeries.prevClose ?? indexSeries.points[0].price

    const stockSeries = new Map<string, { points: IntradayPoint[]; prevClose: number | null }>()
    await Promise.all(
      profile.holdings.map(async (h) => {
        const s = await intradaySeries(h.code)
        if (s && s.points.length > 0) stockSeries.set(h.code, { points: s.points, prevClose: s.prevClose })
      }),
    )

    const points = estimateMinuteSeries(profile.holdings, profile.equityRatioPct, nav.nav, stockSeries, indexSeries, indexPrevClose)
    return { points, prevClose: nav.nav, profile }
  } catch {
    return empty
  }
}

export interface FundCalibrationResult {
  points: CalibrationPoint[]
  summary: CalibrationSummary
}

/** 校准：近 N 天每日最后一条估算 vs 官方净值涨幅，误差落库并返回统计 */
export async function calibrateFund(symbol: string, days = 30): Promise<FundCalibrationResult | null> {
  try {
    const navSeries = await fetchNavSeries(symbol)
    const officials = navSeries.map((p) => ({ date: new Date(p.x), officialReturn: (p.equityReturn ?? 0) / 100 }))
    const since = new Date(Date.now() - days * 86400000)
    const rows = await prisma.fundEstimate.findMany({
      where: { symbol, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    })
    // 每日最后一条估算
    const byDay = new Map<string, number>()
    for (const r of rows) {
      const k = `${r.createdAt.getFullYear()}-${String(r.createdAt.getMonth() + 1).padStart(2, '0')}-${String(r.createdAt.getDate()).padStart(2, '0')}`
      byDay.set(k, r.estimateReturn)
    }
    const estimates = [...byDay.entries()].map(([date, estReturn]) => ({ date, estReturn }))
    const points = buildCalibration(estimates, officials)
    const summary = summarizeCalibration(points)

    // 幂等落库
    for (const p of points) {
      await prisma.fundCalibration.upsert({
        where: { symbol_date: { symbol, date: new Date(`${p.date}T00:00:00Z`) } },
        create: { symbol, date: new Date(`${p.date}T00:00:00Z`), estReturn: p.estReturn, officialReturn: p.officialReturn, error: p.error },
        update: { estReturn: p.estReturn, officialReturn: p.officialReturn, error: p.error },
      })
    }
    return { points, summary }
  } catch {
    return null
  }
}
