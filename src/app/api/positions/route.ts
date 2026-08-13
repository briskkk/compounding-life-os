// GET /api/positions — 持仓明细（不含现金，按市值降序；供移动端 APP 使用）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import type { FamilyCtx } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { buildPositionItem } from '@/lib/engine/position-view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // ── 获取家庭上下文 ────────────────────────────────────
  // 优先用户会话（Cookie 或 Bearer token），无会话时回落到全局 PORTFOLIO_API_KEY
  let ctx: FamilyCtx | null = await getSession()
  if (!ctx) {
    const apiKey = process.env.PORTFOLIO_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: 'PORTFOLIO_API_KEY not configured' },
        { status: 503 },
      )
    }

    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')
    if (token !== apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      )
    }

    const owner = await prisma.member.findFirst({
      where: { role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    })
    if (!owner) {
      return NextResponse.json(
        { error: 'No family space initialized' },
        { status: 500 },
      )
    }
    ctx = {
      familyId: owner.familyId,
      memberId: owner.id,
      memberName: owner.name,
      role: owner.role,
      userId: owner.userId ?? '',
    }
  }

  const state = await loadEngineState(ctx)
  const positions = mergePositionsByAsset(
    state.valued.filter((v) => isPortfolioAssetClass(v.asset.cls) && v.asset.cls !== 'CASH'),
  )
    .filter((v) => Math.abs(v.quantity) > 1e-9)
    .map((v) => buildPositionItem(v, state.quotes.get(v.asset.symbol)))
    .sort((a, b) => b.marketValue - a.marketValue)

  return NextResponse.json({ ok: true, positions })
}
