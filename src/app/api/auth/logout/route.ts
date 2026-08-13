// POST /api/auth/logout — 注销当前会话（cookie 或 Bearer 通道均可）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { SESSION_COOKIE } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token =
    req.cookies.get(SESSION_COOKIE)?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim() ??
    null
  if (token) {
    const session = await prisma.session.findUnique({ where: { token } })
    if (session) {
      const member = await prisma.member.findFirst({ where: { familyId: session.familyId, userId: session.userId } })
      await prisma.session.delete({ where: { id: session.id } })
      await recordAudit(prisma, {
        familyId: session.familyId,
        actorId: member?.id ?? null,
        actorName: member?.name ?? 'unknown',
        action: 'AUTH_LOGOUT',
        entity: 'User',
        entityId: session.userId,
        detail: '注销会话',
      })
    }
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
