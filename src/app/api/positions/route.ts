// GET /api/positions — 持仓明细（不含现金，按市值降序；供移动端 APP 使用）
import { type NextRequest, NextResponse } from 'next/server'
import { loadEngineState } from '@/lib/queries'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { buildPositionItem } from '@/lib/engine/position-view'
import { apiAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = auth.ctx

  const state = await loadEngineState(ctx)
  const positions = mergePositionsByAsset(
    state.valued.filter((v) => isPortfolioAssetClass(v.asset.cls) && v.asset.cls !== 'CASH'),
  )
    .filter((v) => Math.abs(v.quantity) > 1e-9)
    .map((v) => buildPositionItem(v, state.quotes.get(v.asset.symbol)))
    .sort((a, b) => b.marketValue - a.marketValue)

  return NextResponse.json({ ok: true, positions })
}
