// GET /api/positions/[assetId] — 资产详情（报价 / K 线 / 持仓 / 买卖点；供移动端 APP 使用）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { historySmart } from '@/lib/market'
import { eastmoneyFundProvider } from '@/lib/market/eastmoney-fund'
import { buildPositionItem, toOhlcBars, buildTradeMarks, type OhlcBar } from '@/lib/engine/position-view'
import { dateKeyAt } from '@/lib/engine/watch-market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = auth.ctx

  const { assetId } = await params
  const db = scopedDb(prisma, ctx)
  const asset = await db.asset.findFirst({ where: { id: assetId } })
  if (!asset) return NextResponse.json({ ok: false, error: '资产不存在' }, { status: 404 })

  const state = await loadEngineState(ctx)
  const todayKey = dateKeyAt(new Date())

  // 实时报价（人民币口径；loadEngineState 已按基金/行情链取数并折算，raw 字段保留原币）
  const engineQuote = state.quotes.get(asset.symbol)
  const quote = engineQuote
    ? {
        symbol: asset.symbol,
        price: engineQuote.priceCny,
        prevClose: engineQuote.prevCloseCny,
        changePct: engineQuote.changePct,
        asOf: engineQuote.asOf,
        tradingDate: engineQuote.tradingDate,
        source: engineQuote.source,
        confidencePct: engineQuote.confidencePct ?? null,
        rawPrice: engineQuote.price,
        rawPrevClose: engineQuote.prevClose,
      }
    : null

  // 近 120 个自然日 K 线；场外基金走官方净值历史（无 OHLC，用 close 补齐），失败返回空
  const to = new Date()
  const from = new Date(Date.now() - 120 * 86400000)
  let bars: OhlcBar[] = []
  if (asset.cls === 'FUND') {
    try {
      bars = toOhlcBars(await eastmoneyFundProvider.history(asset.symbol, from, to))
    } catch {
      bars = []
    }
  } else if (!asset.manual && asset.cls !== 'CASH' && asset.cls !== 'REAL_ESTATE') {
    try {
      bars = toOhlcBars((await historySmart(asset.symbol, from, to, { route: 'EXCHANGE' })).bars)
    } catch {
      bars = []
    }
  }

  // 该资产的合并持仓（与 /api/positions 单项结构一致；CASH/长期资产不计入持仓列表）
  const mergedPosition = mergePositionsByAsset(
    state.valued.filter((v) => isPortfolioAssetClass(v.asset.cls) && v.asset.cls !== 'CASH'),
  )
    .filter((v) => Math.abs(v.quantity) > 1e-9)
    .find((v) => v.assetId === asset.id)
  const position = mergedPosition ? buildPositionItem(mergedPosition, state.quotes.get(asset.symbol), todayKey) : null

  // 买卖点：有效 BUY/SELL 流水按日期升序
  const txs = await db.transaction.findMany({
    where: { assetId: asset.id, type: { in: ['BUY', 'SELL'] }, voidedAt: null },
    orderBy: { occurredAt: 'asc' },
  })
  const marks = buildTradeMarks(
    txs.map((t) => ({
      occurredAt: t.occurredAt,
      type: t.type as 'BUY' | 'SELL',
      price: t.price == null ? null : Number(t.price),
      quantity: t.quantity == null ? null : Number(t.quantity),
    })),
  )

  return NextResponse.json({
    ok: true,
    assetId: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    cls: asset.cls,
    quote,
    bars,
    position,
    marks,
  })
}
