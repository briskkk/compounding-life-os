import { type NextRequest } from 'next/server'
import { quoteSmart, providerLabel } from '@/lib/market'
import { cachedQuote } from '@/lib/market/cache'
import { cnyRateFor, fxRates } from '@/lib/market/fx'
import { eastmoneyFundProvider } from '@/lib/market/eastmoney-fund'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { fundNavDayRange, fundNavQuoteOnDate } from '@/lib/market/fund-nav'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbols = (req.nextUrl.searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
  const requestedNavDate = req.nextUrl.searchParams.get('date')
  if (requestedNavDate != null && fundNavDayRange(requestedNavDate) == null) {
    return Response.json({ error: 'date 必须为有效的 YYYY-MM-DD 日期' }, { status: 400 })
  }

  // cls === 'FUND' 的资产统一走基金估值/净值通道，其余走行情链路
  const fundSymbols = new Set<string>()
  const ctx = await getSession()
  if (ctx) {
    const db = scopedDb(prisma, ctx)
    const rows = await db.asset.findMany({ where: { symbol: { in: symbols }, cls: 'FUND' } })
    for (const r of rows) fundSymbols.add(r.symbol)
  }

  const rates = await fxRates()
  const quotes = (
    await Promise.all(
      symbols.map(async (s) => {
        if (fundSymbols.has(s)) {
          if (requestedNavDate != null && requestedNavDate < dateKeyAt(new Date())) {
            const q = await fundNavQuoteOnDate(prisma, s, requestedNavDate)
            return q == null ? null : { ...q, rawPrice: q.price, rawPrevClose: q.prevClose }
          }
          // 基金通道失败：重试一次；仍失败则跳过该标的（绝不回落模拟价）；外层 30s 缓存
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const q = await cachedQuote(`fund|${s}`, () => eastmoneyFundProvider.quote(s))
              return { ...q, rawPrice: q.price, rawPrevClose: q.prevClose }
            } catch {
              if (attempt === 1) return null
              await new Promise((r) => setTimeout(r, 500))
            }
          }
        }
        try {
          const q = await quoteSmart(s)
          const rate = cnyRateFor(s, rates)
          return {
            ...q,
            rawPrice: q.price,
            rawPrevClose: q.prevClose,
            price: q.price * rate,
            prevClose: q.prevClose * rate,
          }
        } catch {
          return null
        }
      }),
    )
  ).filter((q) => q != null)
  return Response.json({ provider: providerLabel(), quotes })
}
