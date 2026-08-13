// GET /api/account/login-history — 最近登录记录（审计链 AUTH_LOGIN）
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  const rows = await prisma.auditLog.findMany({
    where: { entity: 'User', entityId: ctx.userId, action: 'AUTH_LOGIN' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  return NextResponse.json({
    ok: true,
    history: rows.map((r) => ({ at: r.createdAt.toISOString(), actorName: r.actorName, detail: r.detail })),
  })
}
