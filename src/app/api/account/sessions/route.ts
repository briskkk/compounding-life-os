// GET /api/account/sessions — 当前账号的活跃会话列表（不含 token）
// POST /api/account/sessions/revoke — 吊销指定会话（不能吊销当前会话）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, currentSessionToken, matchesSessionToken } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  const current = await currentSessionToken()
  const sessions = await prisma.session.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({
    ok: true,
    sessions: sessions.map((s) => ({
      id: s.id,
      familyId: s.familyId,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: matchesSessionToken(s.token, current),
    })),
  })
}

export async function POST(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  let body: { sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const sessionId = body.sessionId
  if (!sessionId) return NextResponse.json({ ok: false, error: '缺少会话' }, { status: 400 })

  const session = await prisma.session.findFirst({ where: { id: sessionId, userId: ctx.userId } })
  if (!session) return NextResponse.json({ ok: false, error: '会话不存在' }, { status: 404 })
  const current = await currentSessionToken()
  if (matchesSessionToken(session.token, current)) {
    return NextResponse.json({ ok: false, error: '不能吊销当前会话，请使用登出' }, { status: 400 })
  }
  await prisma.session.delete({ where: { id: session.id } })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'AUTH_SESSION_REVOKE',
    entity: 'Session',
    entityId: session.id,
    detail: '吊销登录会话',
  })
  return NextResponse.json({ ok: true })
}
