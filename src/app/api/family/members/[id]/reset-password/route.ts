// POST /api/family/members/[id]/reset-password — OWNER 重置成员登录密码
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { hashPassword } from '@/lib/auth/password'
import { auditedTransaction, recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可重置成员密码' }, { status: 403 })

  let body: { newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const newPassword = body.newPassword ?? ''
  if (newPassword.length < 8) return NextResponse.json({ ok: false, error: '新密码至少 8 位' }, { status: 400 })

  const member = await prisma.member.findFirst({ where: { id, familyId: ctx.familyId } })
  if (!member) return NextResponse.json({ ok: false, error: '成员不存在' }, { status: 404 })
  if (!member.userId) return NextResponse.json({ ok: false, error: '该成员未绑定登录账号' }, { status: 400 })

  // 重置密码并吊销该账号所有会话（需重新登录）
  await auditedTransaction(prisma, ctx.familyId, async (tx) => {
    await tx.user.update({ where: { id: member.userId! }, data: { passwordHash: await hashPassword(newPassword) } })
    await tx.session.deleteMany({ where: { userId: member.userId! } })
    await recordAudit(tx, {
      familyId: ctx.familyId,
      actorId: ctx.memberId,
      actorName: ctx.memberName,
      action: 'MEMBER_PASSWORD_RESET',
      entity: 'User',
      entityId: member.userId,
      detail: `重置 ${member.name} 的登录密码`,
    })
  })
  return NextResponse.json({ ok: true })
}
