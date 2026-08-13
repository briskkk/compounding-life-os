// PATCH /api/family/members/[id] — OWNER 修改成员角色（不能修改自己、不能降级最后一个 OWNER）
// DELETE /api/family/members/[id] — OWNER 移除成员（不能移除自己）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可修改成员角色' }, { status: 403 })
  if (id === ctx.memberId) return NextResponse.json({ ok: false, error: '不能修改自己的角色' }, { status: 400 })

  let body: { role?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const role = body.role
  if (!['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].includes(role ?? '')) {
    return NextResponse.json({ ok: false, error: '角色无效' }, { status: 400 })
  }

  const member = await prisma.member.findFirst({ where: { id, familyId: ctx.familyId } })
  if (!member) return NextResponse.json({ ok: false, error: '成员不存在' }, { status: 404 })

  // 不能把最后一个 OWNER 降级
  if (member.role === 'OWNER' && role !== 'OWNER') {
    const ownerCount = await prisma.member.count({ where: { familyId: ctx.familyId, role: 'OWNER' } })
    if (ownerCount <= 1) {
      return NextResponse.json({ ok: false, error: '家庭至少需要一位 OWNER' }, { status: 400 })
    }
  }

  await prisma.member.update({ where: { id: member.id }, data: { role: role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' } })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'MEMBER_ROLE',
    entity: 'Member',
    entityId: member.id,
    detail: `${member.name} 角色 ${member.role} → ${role}`,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可移除成员' }, { status: 403 })
  if (id === ctx.memberId) return NextResponse.json({ ok: false, error: '不能移除自己' }, { status: 400 })

  const member = await prisma.member.findFirst({ where: { id, familyId: ctx.familyId } })
  if (!member) return NextResponse.json({ ok: false, error: '成员不存在' }, { status: 404 })
  if (member.role === 'OWNER') {
    const ownerCount = await prisma.member.count({ where: { familyId: ctx.familyId, role: 'OWNER' } })
    if (ownerCount <= 1) return NextResponse.json({ ok: false, error: '家庭至少需要一位 OWNER' }, { status: 400 })
  }

  await prisma.member.delete({ where: { id: member.id } })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'MEMBER_REMOVE',
    entity: 'Member',
    entityId: member.id,
    detail: `移除成员 ${member.name}`,
  })
  return NextResponse.json({ ok: true })
}
