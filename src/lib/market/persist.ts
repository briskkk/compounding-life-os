// 行情历史落库：PriceBar 按 (symbol, date) 去重，重建快照时优先读库
import type { PrismaClient } from '@prisma/client'
import { historySmart } from './index'
import { eastmoneyFundProvider } from './eastmoney-fund'
import { closeAt } from './simulated'
import { parseSymbol } from './symbols'

const DAY = 86400000

/** 拉取并落库指定标的的历史日线（先清区间再批量写入，幂等） */
export async function persistHistory(
  db: PrismaClient,
  symbols: string[],
  from: Date,
  to: Date,
): Promise<{ symbol: string; count: number; source: string }[]> {
  const results: { symbol: string; count: number; source: string }[] = []
  for (const symbol of symbols) {
    const { bars, source } = await historySmart(symbol, from, to)
    if (bars.length > 0) {
      await db.priceBar.deleteMany({ where: { symbol, date: { gte: from, lte: to } } })
      await db.priceBar.createMany({
        data: bars.map((b) => ({ symbol, date: b.date, close: b.close, source })),
      })
    }
    results.push({ symbol, count: bars.length, source })
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
      const bars = await eastmoneyFundProvider.history(symbol, from, to)
      await db.priceBar.deleteMany({ where: { symbol, date: { gte: from, lte: to } } })
      if (bars.length > 0) {
        await db.priceBar.createMany({
          data: bars.map((b) => ({ symbol, date: b.date, close: b.close, source: 'EASTMONEY-FUND' })),
        })
      }
      results.push({ symbol, count: bars.length, source: 'EASTMONEY-FUND' })
    } catch {
      results.push({ symbol, count: 0, source: 'EASTMONEY-FUND' })
    }
  }
  return results
}

export interface PriceSeries {
  times: number[] // 升序时间戳
  closes: number[]
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
      s = { times: [], closes: [] }
      map.set(r.symbol, s)
    }
    s.times.push(r.date.getTime())
    s.closes.push(Number(r.close))
  }
  return map
}

function lastAtOrBefore(s: PriceSeries, ms: number): number | undefined {
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
  return ans >= 0 ? s.closes[ans] : undefined
}

/** 生成价格函数：库中历史优先；仅非标准资产允许回落到其设计内的模拟价格。 */
export function priceAtFn(map: Map<string, PriceSeries>): (symbol: string, date: Date) => number | undefined {
  return (symbol, date) => {
    const s = map.get(symbol)
    const v = s ? lastAtOrBefore(s, date.getTime()) : undefined
    if (v != null) return v
    return parseSymbol(symbol).market === 'OTHER' ? closeAt(symbol, date) : undefined
  }
}
