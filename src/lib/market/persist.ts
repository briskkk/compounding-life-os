// 行情历史落库：PriceBar 按 (symbol, date) 去重，重建快照时优先读库
import type { PrismaClient } from '@prisma/client'
import type { Bar } from './provider'
import { historySmart } from './index'
import { eastmoneyFundProvider } from './eastmoney-fund'
import { closeAt } from './simulated'
import { simulatedAllowed } from './index'
import { parseSymbol } from './symbols'
import { dateKeyAt } from '../engine/watch-market'

const DAY = 86400000
const REFRESH_OVERLAP_DAYS = 7

async function historyWindows(
  db: PrismaClient,
  symbol: string,
  from: Date,
  to: Date,
): Promise<{ from: Date; to: Date }[]> {
  const existing = await db.priceBar.aggregate({
    where: { symbol, source: { not: 'SIMULATED' } },
    _min: { date: true },
    _max: { date: true },
  })
  const earliest = existing._min.date
  const latest = existing._max.date
  if (!earliest || !latest) return [{ from, to }]

  const windows: { from: Date; to: Date }[] = []
  if (earliest.getTime() - from.getTime() > DAY) {
    windows.push({ from, to: new Date(earliest.getTime() - DAY) })
  }
  const tailFrom = new Date(Math.max(from.getTime(), latest.getTime() - REFRESH_OVERLAP_DAYS * DAY))
  if (tailFrom <= to) windows.push({ from: tailFrom, to })
  return windows
}

/** 将已经取得的行情直接落库，避免页面为持久化重复请求同一段历史。 */
export async function persistBars(
  db: PrismaClient,
  symbol: string,
  bars: Bar[],
  source: string,
): Promise<number> {
  if (bars.length === 0) return 0
  // 同一 (symbol, date) 去重（保留最后一条），防止 createMany 内部自撞唯一约束
  const byDay = new Map<number, Bar>()
  for (const bar of bars) byDay.set(bar.date.getTime(), bar)
  const sorted = [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
  // 删除 + 写入包在同一事务：并发自愈落库时两批操作不会交错，避免唯一约束竞争
  await db.$transaction([
    db.priceBar.deleteMany({
      where: {
        symbol,
        date: { gte: sorted[0].date, lte: sorted.at(-1)!.date },
      },
    }),
    db.priceBar.createMany({
      data: sorted.map((bar) => ({ symbol, date: bar.date, close: bar.close, source })),
    }),
  ])
  return sorted.length
}

/** 拉取并落库指定标的的历史日线（先清区间再批量写入，幂等） */
export async function persistHistory(
  db: PrismaClient,
  symbols: string[],
  from: Date,
  to: Date,
): Promise<{ symbol: string; count: number; source: string }[]> {
  const results: { symbol: string; count: number; source: string }[] = []
  for (const symbol of symbols) {
    let count = 0
    const sources = new Set<string>()
    for (const window of await historyWindows(db, symbol, from, to)) {
      const { bars, source } = await historySmart(symbol, window.from, window.to)
      if (bars.length === 0) continue
      count += await persistBars(db, symbol, bars, source)
      sources.add(source)
    }
    results.push({ symbol, count, source: [...sources].join('+') || 'CACHED' })
  }
  return results
}

/** 基金资产：官方净值历史落库（T-1 单位净值序列） */
export async function persistFundHistory(
  db: PrismaClient,
  symbols: string[],
  from: Date,
  to: Date,
): Promise<{ symbol: string; count: number; source: string }[]> {
  const results: { symbol: string; count: number; source: string }[] = []
  for (const symbol of symbols) {
    try {
      let count = 0
      for (const window of await historyWindows(db, symbol, from, to)) {
        const bars = await eastmoneyFundProvider.history(symbol, window.from, window.to)
        count += await persistBars(db, symbol, bars, 'EASTMONEY-FUND')
      }
      results.push({ symbol, count, source: count > 0 ? 'EASTMONEY-FUND' : 'CACHED' })
    } catch {
      results.push({ symbol, count: 0, source: 'EASTMONEY-FUND' })
    }
  }
  return results
}

export interface PriceSeries {
  times: number[] // 升序时间戳
  closes: number[]
  valuationDates: string[]
  sources: string[]
}

export interface PriceObservation {
  close: number
  valuationDate: string
  source: string
  nextValuationDate?: string | null
}

/** 从 PriceBar 读出内存价格表 */
export async function loadPriceSeries(db: PrismaClient, symbols: string[]): Promise<Map<string, PriceSeries>> {
  const rows = await db.priceBar.findMany({
    where: { symbol: { in: symbols } },
    orderBy: { date: 'asc' },
  })
  const map = new Map<string, PriceSeries>()
  for (const r of rows) {
    let s = map.get(r.symbol)
    if (!s) {
      s = { times: [], closes: [], valuationDates: [], sources: [] }
      map.set(r.symbol, s)
    }
    s.times.push(r.date.getTime())
    s.closes.push(Number(r.close))
    s.valuationDates.push(dateKeyAt(r.date))
    s.sources.push(r.source)
  }
  return map
}

function lastIndexAtOrBefore(s: PriceSeries, ms: number): number {
  let lo = 0
  let hi = s.times.length - 1
  let ans = -1
  const target = Math.floor(ms / DAY) * DAY
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (s.times[mid] <= target) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** 返回估值价格及其所属市场/基金估值日期，供快照判断是否沿用旧价格。 */
export function priceObservationAtFn(map: Map<string, PriceSeries>): (symbol: string, date: Date) => PriceObservation | undefined {
  return (symbol, date) => {
    const s = map.get(symbol)
    if (!s) return undefined
    const index = lastIndexAtOrBefore(s, date.getTime())
    if (index < 0) return undefined
    return {
      close: s.closes[index],
      valuationDate: s.valuationDates[index],
      source: s.sources[index],
      nextValuationDate: s.valuationDates[index + 1] ?? null,
    }
  }
}

/** 生成价格函数：库中历史优先；非标资产的模拟价格仅在显式模拟模式下允许回落。 */
export function priceAtFn(map: Map<string, PriceSeries>): (symbol: string, date: Date) => number | undefined {
  const observationAt = priceObservationAtFn(map)
  return (symbol, date) => {
    const observation = observationAt(symbol, date)
    if (observation) return observation.close
    return parseSymbol(symbol).market === 'OTHER' && simulatedAllowed() ? closeAt(symbol, date) : undefined
  }
}
