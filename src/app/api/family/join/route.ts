// POST /api/family/join — 登录用户凭邀请码加入家庭（码一次性消费；未加入家庭的账号也可用）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, hasSession, currentSessionToken } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await hasSession()
  if (!session) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  const ctx = await getSession()
  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const code = body.code?.trim().toUpperCase() ?? ''
  if (!code) return NextResponse.json({ ok: false, error: '请输入邀请码' }, { status: 400 })

  const invite = await prisma.invite.findUnique({ where: { code } })
  if (!invite || invite.expiresAt.getTime() <= Date.now()) {
    if (invite) await prisma.invite.delete({ where: { id: invite.id } }).catch(() => undefined)
    return NextResponse.json({ ok: false, error: '邀请码无效或已过期' }, { status: 400 })
  }

  const existing = await prisma.member.findFirst({ where: { familyId: invite.familyId, userId: session.userId } })
  if (existing) {
    await prisma.invite.delete({ where: { id: invite.id } })
    return NextResponse.json({ ok: false, error: '你已在该家庭中' }, { status: 409 })
  }

  const member = await prisma.member.create({
    data: { familyId: invite.familyId, userId: session.userId, name: ctx?.memberName ?? '新成员', role: invite.role },
  })
  await prisma.invite.delete({ where: { id: invite.id } })

  // 切换当前会话到新加入的家庭
  const token = await currentSessionToken()
  if (token) {
    await prisma.session.updateMany({ where: { token }, data: { familyId: invite.familyId } })
  }
  await recordAudit(prisma, {
    familyId: invite.familyId,
    actorId: member.id,
    actorName: member.name,
    action: 'MEMBER_JOIN',
    entity: 'Member',
    entityId: member.id,
    detail: `凭邀请码加入家庭，角色 ${invite.role}`,
  })
  return NextResponse.json({ ok: true, familyId: invite.familyId })
}
