import { type NextRequest } from 'next/server'
import { quoteSmart, providerLabel } from '@/lib/market'
import { cnyRateFor, fxRates } from '@/lib/market/fx'
import { eastmoneyFundProvider } from '@/lib/market/eastmoney-fund'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbols = (req.nextUrl.searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)

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
          // 基金通道失败：重试一次；仍失败则跳过该标的（绝不回落模拟价）
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const q = await eastmoneyFundProvider.quote(s)
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
