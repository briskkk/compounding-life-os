// 外汇折算：US/HK 标的报价 × 汇率 → 人民币口径
// 实时源：新浪 fx_susdcny / fx_shkdcny（1 小时缓存）；失败回落固定汇率
// 历史源：RateBar 表按 (pair, date) 落库每日汇率，快照重建按当日汇率折算（缺失回落最近可用）
import type { PrismaClient } from '@prisma/client'
import { parseSymbol } from './symbols'
import { dateKeyAt } from '../engine/watch-market'

const FALLBACK = { USDCNY: 6.77, HKDCNY: 0.864 }
const TTL = 3600_000

let cache: { USDCNY: number; HKDCNY: number; at: number } | null = null

export interface FxRates {
  USDCNY: number
  HKDCNY: number
  source: 'SINA' | 'FALLBACK'
}

export async function fxRates(): Promise<FxRates> {
  if (cache && Date.now() - cache.at < TTL) {
    return { USDCNY: cache.USDCNY, HKDCNY: cache.HKDCNY, source: 'SINA' }
  }
  try {
    const res = await fetch('https://hq.sinajs.cn/list=fx_susdcny,fx_shkdcny', {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    const text = await res.text()
    const usd = Number(text.match(/fx_susdcny="([^"]*)"/)?.[1].split(',')[1])
    const hkd = Number(text.match(/fx_shkdcny="([^"]*)"/)?.[1].split(',')[1])
    if (Number.isFinite(usd) && usd > 0 && Number.isFinite(hkd) && hkd > 0) {
      cache = { USDCNY: usd, HKDCNY: hkd, at: Date.now() }
      return { USDCNY: usd, HKDCNY: hkd, source: 'SINA' }
    }
  } catch {
    /* 回落固定汇率 */
  }
  return { ...FALLBACK, source: 'FALLBACK' }
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

/** 把当日汇率幂等写入 RateBar（以北京日历日为准，同日覆盖） */
export async function persistDailyFx(db: PrismaClient, rates: { USDCNY: number; HKDCNY: number }): Promise<number> {
  const today = new Date(`${dateKeyAt(new Date())}T00:00:00Z`)
  let written = 0
  for (const pair of FX_PAIRS) {
    const rate = pair === 'USDCNY' ? rates.USDCNY : rates.HKDCNY
    if (!Number.isFinite(rate) || rate <= 0) continue
    await db.rateBar.upsert({
      where: { pair_date: { pair, date: today } },
      create: { pair, date: today, rate, source: 'SINA' },
      update: { rate, source: 'SINA' },
    })
    written += 1
  }
  return written
}

/** 纯函数：某日某币种的折算汇率。RateBar 当日优先，缺失回落最近可用；再无回落实时/固定汇率 */
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

/** 生成快照重建用的按日汇率函数：RateBar 当日优先，缺失回落最近可用，再无回落实时/固定汇率 */
export async function fxRateAtFactory(
  db: PrismaClient,
): Promise<(currency: string, date?: Date) => number> {
  const series = await loadFxSeries(db)
  const live = await fxRates()
  return (currency: string, date?: Date) => fxRateAt(series, live, currency, date)
}
