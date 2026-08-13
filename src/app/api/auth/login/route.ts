// POST /api/auth/login — 账号密码登录
// 响应：设置 fw_session cookie（浏览器通道）+ 返回 token（APP 通道）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, randomToken } from '@/lib/auth/password'
import { SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''
  if (!email || !password) return NextResponse.json({ ok: false, error: '请输入邮箱和密码' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { email },
    include: { members: { include: { family: true } } },
  })
  // 统一报错文案，不泄露账号是否存在
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: '邮箱或密码错误' }, { status: 401 })
  }

  // Phase 1 单家庭：取该账号的成员身份（OWNER 优先）
  const member = user.members.find((m) => m.role === 'OWNER') ?? user.members[0]
  if (!member) return NextResponse.json({ ok: false, error: '该账号未加入任何家庭' }, { status: 403 })

  const token = randomToken()
  await prisma.session.create({
    data: { userId: user.id, familyId: member.familyId, token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  })
  await recordAudit(prisma, {
    familyId: member.familyId,
    actorId: member.id,
    actorName: member.name,
    action: 'AUTH_LOGIN',
    entity: 'User',
    entityId: user.id,
    detail: '账号密码登录',
  })

  const res = NextResponse.json({ ok: true, token })
  // 生产环境 https 下 Secure；e2e 走 http 需显式关闭（DISABLE_SECURE_COOKIE=true）
  const secure = process.env.NODE_ENV === 'production' && process.env.DISABLE_SECURE_COOKIE !== 'true'
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
  return res
}
