// GET /api/desktop/tasks — macOS 菜单栏待办。
// 只读，认证与其它 APP 读接口相同（Cookie 或 Bearer，可回落只读 Key）。
// 三条待办来自总览引擎 buildOverviewTasks，本路由不重算份额、定投或对账。
// 生产站点在部署此路由之前不会提供定投节点与账户对账；菜单栏届时只使用
// GET /api/mobile/summary 里已经返回的 pendingPurchases。
import { type NextRequest, NextResponse } from 'next/server'
import { loadEngineState } from '@/lib/queries'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { loadOverviewTasks } from '@/lib/services/overview-tasks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  try {
    const state = await loadEngineState(auth.ctx)
    const tasks = await loadOverviewTasks(
      auth.ctx,
      state.pendingFundPurchases,
      state.assets,
      state.currencyRates,
    )
    const totalCount = tasks.reduce((sum, task) => sum + task.count, 0)
    return NextResponse.json({ ok: true, totalCount, tasks })
  } catch {
    return NextResponse.json({ ok: false, error: '待办读取失败' }, { status: 500 })
  }
}
