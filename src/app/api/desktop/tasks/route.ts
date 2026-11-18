// GET /api/desktop/tasks — 菜单栏待办只读接口。
// 认证与其它 APP 读接口相同：Cookie 会话（fw_session）或 Authorization: Bearer <登录会话>。
// 待办按总览页同一形状交给 buildOverviewTasks，不重放持仓、不取行情、不重建快照。
import { type NextRequest, NextResponse } from 'next/server'
import { apiReadAuthCtx } from '@/lib/services/api-auth'
import { loadOverviewTasks } from '@/lib/services/overview-tasks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  try {
    const tasks = await loadOverviewTasks(auth.ctx)
    const totalCount = tasks.reduce((sum, task) => sum + task.count, 0)
    return NextResponse.json({ ok: true, totalCount, tasks })
  } catch {
    return NextResponse.json({ ok: false, error: '待办读取失败' }, { status: 500 })
  }
}
