// GET /api/account/me — 当前登录账号与所属家庭（供移动端 APP 使用）
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })

  const [user, member, family] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.userId } }),
    prisma.member.findUnique({ where: { id: ctx.memberId } }),
    prisma.familySpace.findUnique({ where: { id: ctx.familyId } }),
  ])

  return NextResponse.json({
    ok: true,
    me: {
      email: user?.email ?? null,
      displayName: member?.name ?? ctx.memberName,
      familyId: ctx.familyId,
      familyName: family?.name ?? '家庭空间',
      role: member?.role ?? ctx.role,
    },
  })
}
