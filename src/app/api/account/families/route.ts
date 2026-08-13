// GET /api/account/families — 当前账号可访问的所有家庭（供移动端 APP 使用）
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })

  const members = await prisma.member.findMany({
    where: { userId: ctx.userId },
    include: { family: true },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    ok: true,
    families: members.map((m) => ({
      id: m.family.id,
      name: m.family.name,
      role: m.role,
      current: m.familyId === ctx.familyId,
    })),
  })
}
