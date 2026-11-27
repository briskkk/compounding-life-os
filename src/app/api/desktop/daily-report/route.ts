import { type NextRequest } from 'next/server'
import { loadEngineState } from '@/lib/queries'
import { buildDailyReport } from '@/lib/engine/daily-report'
import { dailyReportSeries } from '@/lib/services/daily-report-series'
import { apiWriteAuthCtx } from '@/lib/services/api-auth'
import { desktopJson, desktopScope } from '@/lib/services/desktop-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const auth = await apiWriteAuthCtx(req)
    if (!auth.ctx?.userId) return desktopJson({ ok: false, error: 'User session required' }, 401)
    const [state, scope] = await Promise.all([loadEngineState(auth.ctx), desktopScope(auth.ctx)])
    const now = new Date()
    const series = await dailyReportSeries(state, now)
    return desktopJson({ ok: true, scope, report: buildDailyReport(state, series, now) })
  } catch {
    return desktopJson({ ok: false, error: '投资日报读取失败，请稍后重试' }, 500)
  }
}
