// POST /api/family/invites/revoke — OWNER 撤销邀请码
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可撤销邀请' }, { status: 403 })
  let body: { inviteId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const invite = await prisma.invite.findFirst({ where: { id: body.inviteId ?? '', familyId: ctx.familyId } })
  if (!invite) return NextResponse.json({ ok: false, error: '邀请不存在' }, { status: 404 })
  await prisma.invite.delete({ where: { id: invite.id } })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'MEMBER_INVITE_REVOKE',
    entity: 'Invite',
    entityId: invite.id,
    detail: `撤销邀请码 ${invite.code}`,
  })
  return NextResponse.json({ ok: true })
}
