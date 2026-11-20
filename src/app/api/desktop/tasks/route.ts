// GET /api/desktop/tasks — macOS 菜单栏待办。
// 只读，必须真实 Cookie / Bearer 用户会话，不回落全局只读 Key。
// 三条待办来自总览引擎 buildOverviewTasks，本路由不重算份额、定投或对账。
import { type NextRequest } from 'next/server'
import { apiWriteAuthCtx } from '@/lib/services/api-auth'
import { loadOverviewTasks } from '@/lib/services/overview-tasks'
import { desktopJson, desktopScope } from '@/lib/services/desktop-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const auth = await apiWriteAuthCtx(req)
    if (!auth.ctx?.userId) return desktopJson({ ok: false, error: 'User session required' }, 401)
    const [tasks, scope] = await Promise.all([loadOverviewTasks(auth.ctx), desktopScope(auth.ctx)])
    const totalCount = tasks.reduce((sum, task) => sum + task.count, 0)
    return desktopJson({ ok: true, scope, totalCount, tasks })
  } catch {
    return desktopJson({ ok: false, error: '待办读取失败' }, 500)
  }
}
