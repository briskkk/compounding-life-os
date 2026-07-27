// 模拟行情提供者：确定性几何布朗运动 —— 同一标的全天/全历史序列恒定
// 接口对齐真实行情源，切换实盘数据时替换 quoteAt/dailyCloses 实现即可
import { gaussian, hashSeed, mulberry32 } from '@/lib/engine/rng'

export interface Quote {
  symbol: string
  price: number
  prevClose: number
  changePct: number
  asOf: string // ISO
}

interface Profile {
  base: number // 锚定日价格
  mu: number // 年化漂移
  sigma: number // 年化波动
}

const PROFILES: Record<string, Profile> = {
  '600519': { base: 1520, mu: 0.08, sigma: 0.28 },
  '300750': { base: 187, mu: 0.12, sigma: 0.42 },
  '510300': { base: 3.9, mu: 0.05, sigma: 0.18 },
  '110022': { base: 2.4, mu: 0.06, sigma: 0.2 },
  AU9999: { base: 545, mu: 0.09, sigma: 0.13 },
  'RSU-ACME': { base: 46, mu: 0.15, sigma: 0.5 },
}

function profileOf(symbol: string): Profile {
  const p = PROFILES[symbol]
  if (p) return p
  const h = hashSeed(symbol)
  return { base: 10 + (h % 9900) / 10, mu: 0.06, sigma: 0.3 }
}

const ANCHOR = Date.UTC(2022, 0, 3) // 2022-01-03 周一
const DAY = 86400000

interface Series {
  dates: number[] // UTC 交易日午夜
  closes: number[]
}

const cache = new Map<string, Series>()

function buildSeries(symbol: string, toMs: number): Series {
  const prof = profileOf(symbol)
  const seed = hashSeed(`px:${symbol}`)
  const rand = mulberry32(seed)
  const dates: number[] = []
  const closes: number[] = []
  let price = prof.base
  let d = ANCHOR
  const step = Math.exp((prof.mu - (prof.sigma * prof.sigma) / 2) / 252)
  const vol = prof.sigma / Math.sqrt(252)
  while (d <= toMs) {
    const dow = new Date(d).getUTCDay()
    if (dow !== 0 && dow !== 6) {
      price = price * step * Math.exp(vol * gaussian(rand))
      dates.push(d)
      closes.push(price)
    }
    d += DAY
  }
  return { dates, closes }
}

function series(symbol: string, toMs: number): Series {
  const cached = cache.get(symbol)
  if (cached && cached.dates[cached.dates.length - 1] >= toMs) return cached
  const built = buildSeries(symbol, toMs)
  cache.set(symbol, built)
  return built
}

function dayFloor(ms: number): number {
  return Math.floor(ms / DAY) * DAY
}

/** 指定日期（含）之前最近一个交易日收盘价 */
export function closeAt(symbol: string, date: Date): number | undefined {
  const s = series(symbol, dayFloor(date.getTime()))
  let lo = 0
  let hi = s.dates.length - 1
  let ans = -1
  const target = dayFloor(date.getTime())
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (s.dates[mid] <= target) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans >= 0 ? s.closes[ans] : undefined
}

/** [from, to] 区间日线收盘 */
export function dailyCloses(symbol: string, from: Date, to: Date): { date: Date; close: number }[] {
  const s = series(symbol, dayFloor(to.getTime()))
  const f = dayFloor(from.getTime())
  const t = dayFloor(to.getTime())
  const out: { date: Date; close: number }[] = []
  for (let i = 0; i < s.dates.length; i++) {
    if (s.dates[i] >= f && s.dates[i] <= t) out.push({ date: new Date(s.dates[i]), close: s.closes[i] })
  }
  return out
}

/** 实时报价：最近收盘 × 日内微扰（每 5 秒一个确定性 tick） */
export function quoteAt(symbol: string, t: Date = new Date()): Quote {
  const today = dayFloor(t.getTime())
  const lastClose = closeAt(symbol, t) ?? profileOf(symbol).base
  const prevClose = closeAt(symbol, new Date(today - DAY)) ?? lastClose
  const bucket = Math.floor(t.getTime() / 5000)
  const rand = mulberry32((hashSeed(`tick:${symbol}`) ^ bucket) >>> 0)
  const jitter = (rand() - 0.5) * 0.008
  const price = round2(lastClose * (1 + jitter))
  return {
    symbol,
    price,
    prevClose: round2(prevClose),
    changePct: prevClose > 0 ? price / prevClose - 1 : 0,
    asOf: t.toISOString(),
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

/** 标记为模拟行情的来源标签 */
export const PROVIDER_LABEL = 'SIMULATED'
