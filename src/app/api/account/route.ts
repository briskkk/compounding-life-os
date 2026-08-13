// PATCH /api/account — 修改当前成员显示名（用户名）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  let body: { displayName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const displayName = body.displayName?.trim()
  if (!displayName || displayName.length > 20) {
    return NextResponse.json({ ok: false, error: '用户名不能为空且不超过 20 个字符' }, { status: 400 })
  }
  const member = await prisma.member.findFirst({ where: { id: ctx.memberId, familyId: ctx.familyId } })
  if (!member) return NextResponse.json({ ok: false, error: '成员不存在' }, { status: 404 })
  await prisma.member.update({ where: { id: member.id }, data: { name: displayName } })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: member.id,
    actorName: displayName,
    action: 'ACCOUNT_RENAME',
    entity: 'Member',
    entityId: member.id,
    detail: `用户名 ${member.name} → ${displayName}`,
  })
  return NextResponse.json({ ok: true })
}
