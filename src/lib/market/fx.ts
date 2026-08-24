// 外汇折算：US/HK 标的报价 × 汇率 → 人民币口径
// 实时源：新浪 fx_susdcny / fx_shkdcny（1 小时缓存）；失败回落数据库最后一笔真实汇率并明确标记陈旧
// 历史源：RateBar 表按 (pair, date) 落库每日汇率，快照重建按当日汇率折算（缺失回落最近可用）
import type { PrismaClient } from '@prisma/client'
import { parseSymbol } from './symbols'
import { dateKeyAt } from '../engine/watch-market'
import { providerChain } from './index'

const TTL = 3600_000
const STALE_RETRY_TTL = 60_000
const SIMULATED_FX = { USDCNY: 7.1, HKDCNY: 0.91 }

interface FxRuntimeState {
  cached: (FxRates & { cachedAt: number }) | null
  lastError: string | null
  lastErrorAt: number | null
}

const globalForFx = globalThis as unknown as { __portfolioFxRuntime?: FxRuntimeState }
const fxRuntime = globalForFx.__portfolioFxRuntime ?? {
  cached: null,
  lastError: null,
  lastErrorAt: null,
}
globalForFx.__portfolioFxRuntime = fxRuntime

export interface FxRates {
  USDCNY: number
  HKDCNY: number
  source: 'SINA' | 'RATE_BAR' | 'SIMULATED'
  /** 汇率对应的数据时点；RATE_BAR 为两组汇率中较旧的日期。 */
  asOf: string
  /** true 表示实时源不可用，当前使用最后一笔真实历史汇率。 */
  stale: boolean
}

function parseSinaFx(text: string): { USDCNY: number; HKDCNY: number } | null {
  const usd = Number(text.match(/fx_susdcny="([^"]*)"/)?.[1].split(',')[1])
  const hkd = Number(text.match(/fx_shkdcny="([^"]*)"/)?.[1].split(',')[1])
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(hkd) || hkd <= 0) return null
  return { USDCNY: usd, HKDCNY: hkd }
}

async function lastRealRates(db: PrismaClient): Promise<FxRates | null> {
  const [usd, hkd] = await Promise.all(
    FX_PAIRS.map((pair) => db.rateBar.findFirst({
      where: { pair, source: { notIn: ['FALLBACK', 'SIMULATED'] } },
      orderBy: { date: 'desc' },
    })),
  )
  if (!usd || !hkd) return null
  const usdRate = Number(usd.rate)
  const hkdRate = Number(hkd.rate)
  if (!Number.isFinite(usdRate) || usdRate <= 0 || !Number.isFinite(hkdRate) || hkdRate <= 0) return null
  return {
    USDCNY: usdRate,
    HKDCNY: hkdRate,
    source: 'RATE_BAR',
    asOf: new Date(Math.min(usd.date.getTime(), hkd.date.getTime())).toISOString(),
    stale: true,
  }
}

export async function fxRates(db: PrismaClient): Promise<FxRates> {
  const simulatedOnly = providerChain().every((provider) => provider.label === 'SIMULATED')
  if (simulatedOnly) {
    const simulated: FxRates = {
      ...SIMULATED_FX,
      source: 'SIMULATED',
      asOf: new Date().toISOString(),
      stale: false,
    }
    fxRuntime.cached = { ...simulated, cachedAt: Date.now() }
    return simulated
  }
  const cached = fxRuntime.cached
  const cacheTtl = cached?.stale ? STALE_RETRY_TTL : TTL
  if (cached && Date.now() - cached.cachedAt < cacheTtl) {
    const { cachedAt: _cachedAt, ...rates } = cached
    return rates
  }
  try {
    const res = await fetch('https://hq.sinajs.cn/list=fx_susdcny,fx_shkdcny', {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`新浪汇率源响应异常 ${res.status}`)
    const text = await res.text()
    const parsed = parseSinaFx(text)
    if (!parsed) throw new Error('新浪汇率源报文解析失败')
    const live: FxRates = {
      ...parsed,
      source: 'SINA',
      asOf: new Date().toISOString(),
      stale: false,
    }
    fxRuntime.cached = { ...live, cachedAt: Date.now() }
    fxRuntime.lastError = null
    fxRuntime.lastErrorAt = null
    return live
  } catch (error) {
    fxRuntime.lastError = error instanceof Error ? error.message : String(error)
    fxRuntime.lastErrorAt = Date.now()
  }
  const historical = await lastRealRates(db)
  if (!historical) {
    throw new Error(`实时汇率不可用，且没有可回落的历史真实汇率：${fxRuntime.lastError ?? '未知错误'}`)
  }
  fxRuntime.cached = { ...historical, cachedAt: Date.now() }
  return historical
}

export function fxHealth(): {
  source: FxRates['source'] | null
  asOf: string | null
  stale: boolean | null
  lastError: string | null
  lastErrorAt: number | null
} {
  return {
    source: fxRuntime.cached?.source ?? null,
    asOf: fxRuntime.cached?.asOf ?? null,
    stale: fxRuntime.cached?.stale ?? null,
    lastError: fxRuntime.lastError,
    lastErrorAt: fxRuntime.lastErrorAt,
  }
}

/** 测试用：清空汇率缓存和诊断状态。 */
export function resetFxCache(): void {
  fxRuntime.cached = null
  fxRuntime.lastError = null
  fxRuntime.lastErrorAt = null
}

/** 该标的 1 单位外币 = 多少人民币（CN_A/FUND/OTHER = 1） */
export function cnyRateFor(symbol: string, rates: { USDCNY: number; HKDCNY: number }): number {
  const market = parseSymbol(symbol).market
  if (market === 'US') return rates.USDCNY
  if (market === 'HK') return rates.HKDCNY
  return 1
}

export const FX_PAIRS = ['USDCNY', 'HKDCNY'] as const
export type FxPair = (typeof FX_PAIRS)[number]

/** 内存中的历史汇率表：pair → 升序日期 → 汇率 */
export interface FxSeries {
  times: number[]
  rates: number[]
}

export type FxSeriesMap = Map<string, FxSeries>

/** 从 RateBar 读出全部历史汇率（升序） */
export async function loadFxSeries(db: PrismaClient): Promise<FxSeriesMap> {
  const rows = await db.rateBar.findMany({ orderBy: { date: 'asc' } })
  const map: FxSeriesMap = new Map()
  for (const r of rows) {
    let s = map.get(r.pair)
    if (!s) {
      s = { times: [], rates: [] }
      map.set(r.pair, s)
    }
    s.times.push(r.date.getTime())
    s.rates.push(Number(r.rate))
  }
  return map
}

/** 把当日实时汇率幂等写入 RateBar；历史回落值不复制成“今日汇率”。 */
export async function persistDailyFx(db: PrismaClient, rates: FxRates): Promise<number> {
  if (rates.source !== 'SINA' || rates.stale) return 0
  const today = new Date(`${dateKeyAt(new Date())}T00:00:00Z`)
  let written = 0
  for (const pair of FX_PAIRS) {
    const rate = pair === 'USDCNY' ? rates.USDCNY : rates.HKDCNY
    if (!Number.isFinite(rate) || rate <= 0) continue
    await db.rateBar.upsert({
      where: { pair_date: { pair, date: today } },
      create: { pair, date: today, rate, source: rates.source },
      update: { rate, source: rates.source },
    })
    written += 1
  }
  return written
}

/** 纯函数：某日某币种的折算汇率。RateBar 当日优先，缺失回落最近可用；再无回落实时/最后真实汇率。 */
export function fxRateAt(
  series: FxSeriesMap,
  live: { USDCNY: number; HKDCNY: number },
  currency: string,
  date?: Date,
): number {
  const pair = currency === 'USD' ? 'USDCNY' : currency === 'HKD' ? 'HKDCNY' : null
  if (!pair) return 1
  const s = series.get(pair)
  if (s && s.times.length > 0) {
    const target = date ? Math.floor(date.getTime() / 86400000) * 86400000 : Number.POSITIVE_INFINITY
    let lo = 0
    let hi = s.times.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (s.times[mid] <= target) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    if (ans >= 0) return s.rates[ans]
  }
  return pair === 'USDCNY' ? live.USDCNY : live.HKDCNY
}

/** 生成快照重建用的按日汇率函数：RateBar 当日优先，缺失回落最近可用，再无回落实时/最后真实汇率。 */
export async function fxRateAtFactory(
  db: PrismaClient,
): Promise<(currency: string, date?: Date) => number> {
  const series = await loadFxSeries(db)
  const live = await fxRates(db)
  return (currency: string, date?: Date) => fxRateAt(series, live, currency, date)
}
