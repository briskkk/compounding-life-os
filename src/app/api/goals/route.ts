// GET /api/goals — FIRE / 储蓄目标列表（投影结果 + 场景参数；供移动端 FIRE 页与多目标切换）
// 认证：用户会话（Cookie 或 Bearer token）优先，回落 PORTFOLIO_API_KEY
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { apiAuthCtx } from '@/lib/services/api-auth'
import { projectGoalViews } from '@/lib/engine/goal-views'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = auth.ctx
  const db = scopedDb(prisma, ctx)

  const [state, goals] = await Promise.all([
    loadEngineState(ctx),
    db.goal.findMany({ orderBy: { createdAt: 'asc' } }),
  ])

  return NextResponse.json({
    ok: true,
    goals: projectGoalViews(goals, state),
  })
}
