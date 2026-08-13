// GET /api/family/members — 当前家庭成员列表（名称 / 角色 / 是否绑定账号）
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  const members = await prisma.member.findMany({
    where: { familyId: ctx.familyId },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    ok: true,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      email: m.user?.email ?? null,
      current: m.id === ctx.memberId,
    })),
  })
}
