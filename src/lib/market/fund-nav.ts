import type { PrismaClient } from '@prisma/client'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { fetchNavSeries } from './fund-holdings'
import type { Bar, QuoteData } from './provider'

const DAY = 86400000
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export function fundNavDayRange(date: string): { from: Date; to: Date } | null {
  if (!DATE_KEY.test(date)) return null
  const from = new Date(`${date}T00:00:00+08:00`)
  if (!Number.isFinite(from.getTime()) || dateKeyAt(from) !== date) return null
  return { from, to: new Date(from.getTime() + DAY) }
}

export function exactFundNavBar(bars: Bar[], date: string): Bar | null {
  return bars.find((bar) => dateKeyAt(bar.date) === date) ?? null
}

/**
 * 读取指定确认日的官方基金净值。历史补录必须精确匹配确认日，不能回落到“最新净值”，
 * 否则日期标签与实际写入单价会分属两个交易日。
 */
export async function fundNavQuoteOnDate(
  db: PrismaClient,
  symbol: string,
  date: string,
): Promise<QuoteData | null> {
  const range = fundNavDayRange(date)
  if (!range) return null

  const stored = await db.priceBar.findFirst({
    where: {
      symbol,
      date: { gte: range.from, lt: range.to },
    },
    orderBy: { date: 'desc' },
  })

  let bar = stored == null
    ? null
    : { date: stored.date, close: Number(stored.close) }
  let source = stored?.source ?? 'EASTMONEY-FUND'

  if (!bar) {
    try {
      const series = await fetchNavSeries(symbol)
      const fetched = series.map((point) => ({ date: new Date(point.x), close: point.y }))
      bar = exactFundNavBar(fetched, date)
      if (bar) {
        source = 'EASTMONEY-FUND'
        await db.priceBar.upsert({
          where: { symbol_date: { symbol, date: bar.date } },
          create: { symbol, date: bar.date, close: bar.close, source },
          update: { close: bar.close, source },
        })
      }
    } catch {
      return null
    }
  }

  if (!bar) return null
  return {
    symbol,
    price: bar.close,
    prevClose: bar.close,
    changePct: 0,
    asOf: bar.date.toISOString(),
    tradingDate: date,
    source,
  }
}
