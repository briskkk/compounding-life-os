// POST /api/auth/register — 注册新账号；带邀请码时自动加入对应家庭并登录
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword, randomToken } from '@/lib/auth/password'
import { SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INVITE_TTL_MS = 7 * 24 * 3600_000 // 7 天

async function consumeInvite(code: string, userId: string): Promise<{ familyId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' } | null> {
  const invite = await prisma.invite.findUnique({ where: { code } })
  if (!invite) return null
  if (invite.expiresAt.getTime() <= Date.now()) {
    await prisma.invite.delete({ where: { id: invite.id } }).catch(() => undefined)
    return null
  }
  // 已加入过该家庭的账号不再重复创建成员
  const existing = await prisma.member.findFirst({ where: { familyId: invite.familyId, userId } })
  if (!existing) {
    await prisma.member.create({
      data: { familyId: invite.familyId, userId, name: '新成员', role: invite.role },
    })
  }
  await prisma.invite.delete({ where: { id: invite.id } })
  return { familyId: invite.familyId, role: existing?.role ?? invite.role }
}

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; inviteCode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''
  const inviteCode = body.inviteCode?.trim() ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: '邮箱格式不正确' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ ok: false, error: '密码至少 8 位' }, { status: 400 })
  }
  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return NextResponse.json({ ok: false, error: '该邮箱已注册，请直接登录' }, { status: 409 })

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
  })

  // 带邀请码 → 加入家庭（码一次性消费）
  let joinedFamilyId: string | null = null
  if (inviteCode) {
    const joined = await consumeInvite(inviteCode, user.id)
    if (joined) {
      joinedFamilyId = joined.familyId
      await recordAudit(prisma, {
        familyId: joined.familyId,
        actorId: null,
        actorName: email,
        action: 'MEMBER_JOIN',
        entity: 'Member',
        detail: `凭邀请码加入家庭，角色 ${joined.role}`,
      })
    }
  }

  // 注册即登录：创建会话（家庭默认取邀请加入的家庭，否则后续加入家庭时更新）
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      familyId: joinedFamilyId ?? '',
      token: randomToken(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  })

  const res = NextResponse.json({ ok: true, token: session.token, joinedFamilyId })
  const secure = process.env.NODE_ENV === 'production' && process.env.DISABLE_SECURE_COOKIE !== 'true'
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
  return res
}

