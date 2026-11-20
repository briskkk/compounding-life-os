import { type NextRequest } from 'next/server'
import { loadEngineState } from '@/lib/queries'
import { buildDesktopGlance } from '@/lib/engine/desktop-glance'
import { apiWriteAuthCtx } from '@/lib/services/api-auth'
import { desktopJson, desktopScope } from '@/lib/services/desktop-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    // 身份要求与写 API 相同；接口本身只读，不允许全局 Key 回落。
    const auth = await apiWriteAuthCtx(req)
    if (!auth.ctx?.userId) return desktopJson({ ok: false, error: 'User session required' }, 401)
    const [state, scope] = await Promise.all([loadEngineState(auth.ctx), desktopScope(auth.ctx)])
    return desktopJson({ ok: true, scope, ...buildDesktopGlance(state, new Date()) })
  } catch {
    return desktopJson({ ok: false, error: '摘要读取失败' }, 500)
  }
}
