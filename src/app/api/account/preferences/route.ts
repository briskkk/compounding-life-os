// GET /api/account/preferences — 读取当前账号偏好
// PATCH /api/account/preferences — 更新偏好（JSON merge）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { DEFAULT_RANGE_VALUES, parsePreferences, type UserPreferences } from '@/lib/preferences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { preferences: true } })
  return NextResponse.json({ ok: true, preferences: parsePreferences(user?.preferences ?? null) })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  let body: Partial<UserPreferences>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    (body.defaultRange !== undefined && !DEFAULT_RANGE_VALUES.includes(body.defaultRange as typeof DEFAULT_RANGE_VALUES[number]))) {
    return NextResponse.json({ ok: false, error: '默认收益区间无效' }, { status: 400 })
  }
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { preferences: true } })
  const merged: UserPreferences = { ...parsePreferences(user?.preferences ?? null), ...body }
  await prisma.user.update({ where: { id: ctx.userId }, data: { preferences: JSON.stringify(merged) } })
  return NextResponse.json({ ok: true, preferences: merged })
}
