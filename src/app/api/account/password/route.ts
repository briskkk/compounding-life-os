// POST /api/account/password — 修改密码（验证当前密码，改后吊销其他会话）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, SESSION_COOKIE } from '@/lib/session'
import { verifyPassword, hashPassword } from '@/lib/auth/password'
import { auditedTransaction, recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  let body: { currentPassword?: string; newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const currentPassword = body.currentPassword ?? ''
  const newPassword = body.newPassword ?? ''
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: '新密码至少 8 位' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: ctx.userId } })
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: '当前密码错误' }, { status: 400 })
  }

  // 更新密码并吊销该账号的其他会话（保留当前登录）
  const currentToken =
    req.cookies.get(SESSION_COOKIE)?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim() ??
    null
  await auditedTransaction(prisma, ctx.familyId, async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } })
    await tx.session.deleteMany({
      where: { userId: user.id, ...(currentToken ? { token: { not: currentToken } } : {}) },
    })
    await recordAudit(tx, {
      familyId: ctx.familyId,
      actorId: ctx.memberId,
      actorName: ctx.memberName,
      action: 'AUTH_PASSWORD_CHANGE',
      entity: 'User',
      entityId: user.id,
      detail: '修改登录密码',
    })
  })
  return NextResponse.json({ ok: true })
}
