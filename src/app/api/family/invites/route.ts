// POST /api/family/invites — OWNER 生成邀请码（7 天有效）
// GET /api/family/invites — OWNER 查看有效邀请
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { randomToken } from '@/lib/auth/password'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INVITE_TTL_MS = 7 * 24 * 3600_000

export async function POST(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可邀请成员' }, { status: 403 })
  let body: { role?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const role = (['MEMBER', 'ADMIN', 'VIEWER'] as const).includes(body.role as never) ? (body.role as 'MEMBER' | 'ADMIN' | 'VIEWER') : 'MEMBER'
  const code = randomToken(6).slice(0, 8).toUpperCase()
  const invite = await prisma.invite.create({
    data: { familyId: ctx.familyId, code, role, expiresAt: new Date(Date.now() + INVITE_TTL_MS), createdBy: ctx.memberId },
  })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'MEMBER_INVITE',
    entity: 'Invite',
    entityId: invite.id,
    detail: `生成邀请码 ${code}，角色 ${role}`,
  })
  return NextResponse.json({ ok: true, invite: { id: invite.id, code, role, expiresAt: invite.expiresAt.toISOString() } })
}

export async function GET() {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可查看邀请' }, { status: 403 })
  const invites = await prisma.invite.findMany({
    where: { familyId: ctx.familyId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    ok: true,
    invites: invites.map((i) => ({ id: i.id, code: i.code, role: i.role, expiresAt: i.expiresAt.toISOString() })),
  })
}
