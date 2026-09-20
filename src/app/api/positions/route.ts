// GET /api/positions — 持仓明细（不含现金，按市值降序；供移动端 APP 使用）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { buildPositionItem } from '@/lib/engine/position-view'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { parseTags } from '@/lib/engine/groups'
import { marketGroupOf } from '@/lib/engine/market-group'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = auth.ctx

  const db = scopedDb(prisma, ctx)
  const [state, assets] = await Promise.all([
    loadEngineState(ctx),
    db.asset.findMany({ select: { id: true, symbol: true, name: true, cls: true, currency: true, style: true, tags: true } }),
  ])
  const metaById = new Map(assets.map((asset) => [asset.id, asset]))
  const now = new Date()
  const positions = mergePositionsByAsset(
    state.valued.filter((v) => isPortfolioAssetClass(v.asset.cls) && v.asset.cls !== 'CASH'),
  )
    .filter((v) => Math.abs(v.quantity) > 1e-9)
    .map((v) => {
      const item = buildPositionItem(v, state.quotes.get(v.asset.symbol), now)
      const meta = metaById.get(v.assetId)
      return {
        ...item,
        style: meta?.style ?? null,
        marketGroup: marketGroupOf(meta ?? v.asset),
        tags: parseTags(meta?.tags ?? ''),
      }
    })
    .sort((a, b) => b.marketValue - a.marketValue)

  return NextResponse.json({ ok: true, positions })
}
