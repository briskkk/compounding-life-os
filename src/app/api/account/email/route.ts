// PATCH /api/account/email — 修改登录邮箱（验证当前密码）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { verifyPassword } from '@/lib/auth/password'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  let body: { email?: string; currentPassword?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase() ?? ''
  const currentPassword = body.currentPassword ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: '邮箱格式不正确' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: ctx.userId } })
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: '当前密码错误' }, { status: 400 })
  }
  if (email === user.email) return NextResponse.json({ ok: true }) // 未变更

  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return NextResponse.json({ ok: false, error: '该邮箱已被使用' }, { status: 409 })

  await prisma.user.update({ where: { id: user.id }, data: { email } })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'ACCOUNT_EMAIL_CHANGE',
    entity: 'User',
    entityId: user.id,
    detail: `邮箱 ${user.email} → ${email}`,
  })
  return NextResponse.json({ ok: true })
}
