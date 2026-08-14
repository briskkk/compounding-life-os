// 共享 API 认证：用户会话（Cookie 或 Bearer token）优先，回落全局 PORTFOLIO_API_KEY
// 所有移动端/外部 APP 端点统一走这里，避免各路由重复实现
import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import type { FamilyCtx } from '@/lib/scoped'

export interface ApiAuthResult {
  ctx: FamilyCtx | null
  status: number
  error?: string
}

/** 认证：用户会话优先，回落全局 API Key（与 /api/positions 同一策略） */
export async function apiAuthCtx(req: NextRequest): Promise<ApiAuthResult> {
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
