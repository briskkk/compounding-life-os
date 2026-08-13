// POST /api/family/reset — OWNER 清空当前家庭全部业务数据（保留账号与家庭结构；自动备份；需确认）
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'
import { backupNow } from '@/lib/backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ ok: false, error: '仅 OWNER 可重置家庭数据' }, { status: 403 })

  let body: { confirm?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  // 二次确认：输入家庭名称
  const family = await prisma.familySpace.findUnique({ where: { id: ctx.familyId } })
  if (!family) return NextResponse.json({ ok: false, error: '家庭不存在' }, { status: 404 })
  if (body.confirm !== family.name) {
    return NextResponse.json({ ok: false, error: `请输入家庭名称「${family.name}」以确认` }, { status: 400 })
  }

  // 先备份（失败则中止重置）
  let backup: { file: string } | null = null
  try {
    backup = backupNow()
  } catch {
    return NextResponse.json({ ok: false, error: '备份失败，已中止重置' }, { status: 500 })
  }

  // 清空该家庭业务数据（保留 FamilySpace / Member / 审计链；审计记录保留并追加 RESET 事件）
  await prisma.$transaction([
    prisma.snapshot.deleteMany({ where: { familyId: ctx.familyId } }),
    prisma.transaction.deleteMany({ where: { familyId: ctx.familyId } }),
    prisma.liabilityEntry.deleteMany({ where: { familyId: ctx.familyId } }),
    prisma.liability.deleteMany({ where: { familyId: ctx.familyId } }),
    prisma.goal.deleteMany({ where: { familyId: ctx.familyId } }),
    prisma.savingsEntry.deleteMany({ where: { familyId: ctx.familyId } }),
    prisma.asset.deleteMany({ where: { familyId: ctx.familyId } }),
    prisma.account.deleteMany({ where: { familyId: ctx.familyId } }),
  ])

  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'FAMILY_RESET',
    entity: 'FamilySpace',
    entityId: family.id,
    detail: `清空家庭业务数据（备份：${backup?.file ?? '未知'}）`,
  })

  return NextResponse.json({ ok: true, backupFile: backup?.file ?? null })
}
