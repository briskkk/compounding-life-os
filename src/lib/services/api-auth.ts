// 共享 API 认证：读取端点可回落全局只读 Key；写入端点只接受真实用户会话。
import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import type { FamilyCtx } from '@/lib/scoped'

export interface ApiAuthResult {
  ctx: FamilyCtx | null
  status: number
  error?: string
}

/** 只读认证：用户会话优先，回落全局 PORTFOLIO_API_KEY。 */
export async function apiReadAuthCtx(req: NextRequest): Promise<ApiAuthResult> {
  const session = await getSession()
  if (session) return { ctx: session, status: 200 }
  const apiKey = process.env.PORTFOLIO_API_KEY
  if (!apiKey) return { ctx: null, status: 503, error: 'PORTFOLIO_API_KEY not configured' }
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (token !== apiKey) return { ctx: null, status: 401, error: 'Unauthorized' }
  const owner = await prisma.member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } })
  if (!owner) return { ctx: null, status: 500, error: 'No family space initialized' }
  return {
    ctx: { familyId: owner.familyId, memberId: owner.id, memberName: owner.name, role: owner.role, userId: owner.userId ?? '' },
    status: 200,
  }
}

/** 写入认证：必须是可定位到具体用户的 Cookie/Bearer Session，绝不接受全局只读 Key。 */
export async function apiWriteAuthCtx(_req: NextRequest): Promise<ApiAuthResult> {
  const session = await getSession()
  if (!session) return { ctx: null, status: 401, error: 'User session required' }
  return { ctx: session, status: 200 }
}
