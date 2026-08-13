// POST /api/family — 创建新家庭（当前账号成为 OWNER），并把会话切换到新家庭
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, currentSessionToken } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  let body: { name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const name = body.name?.trim()
  if (!name || name.length > 30) {
    return NextResponse.json({ ok: false, error: '家庭名称不能为空且不超过 30 个字符' }, { status: 400 })
  }

  const family = await prisma.familySpace.create({ data: { name } })
  const member = await prisma.member.create({
    data: { familyId: family.id, userId: ctx.userId, name: ctx.memberName, role: 'OWNER' },
  })

  // 切换当前会话到新家庭
  const token = await currentSessionToken()
  if (token) {
    await prisma.session.updateMany({ where: { token }, data: { familyId: family.id } })
  }

  await recordAudit(prisma, {
    familyId: family.id,
    actorId: member.id,
    actorName: member.name,
    action: 'FAMILY_CREATE',
    entity: 'FamilySpace',
    entityId: family.id,
    detail: `创建家庭「${name}」`,
  })

  return NextResponse.json({ ok: true, familyId: family.id })
}

// PATCH /api/family — 修改当前家庭信息（名称 / 基础币种，OWNER 权限）
export async function PATCH(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ ok: false, error: '仅 OWNER 可修改家庭信息' }, { status: 403 })
  }
  let body: { name?: string; baseCurrency?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const name = body.name?.trim()
  const baseCurrency = body.baseCurrency?.trim().toUpperCase()
  if (name != null && (!name || name.length > 30)) {
    return NextResponse.json({ ok: false, error: '家庭名称不能为空且不超过 30 个字符' }, { status: 400 })
  }
  if (baseCurrency != null && !['CNY', 'USD', 'HKD'].includes(baseCurrency)) {
    return NextResponse.json({ ok: false, error: '基础币种仅支持 CNY / USD / HKD' }, { status: 400 })
  }
  const data: { name?: string; baseCurrency?: string } = {}
  if (name != null) data.name = name
  if (baseCurrency != null) data.baseCurrency = baseCurrency
  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true })

  const family = await prisma.familySpace.update({ where: { id: ctx.familyId }, data })
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'FAMILY_UPDATE',
    entity: 'FamilySpace',
    entityId: family.id,
    detail: `更新家庭信息：${JSON.stringify(data)}`,
  })
  return NextResponse.json({ ok: true })
}
