// POST /api/family/switch — 切换当前会话到账号所属的另一个家庭
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, currentSessionToken } from '@/lib/session'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await getSession()
  if (!ctx || !ctx.userId) return NextResponse.json({ ok: false, error: '未登录' }, { status: 401 })
  let body: { familyId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 })
  }
  const familyId = body.familyId
  if (!familyId) return NextResponse.json({ ok: false, error: '缺少家庭' }, { status: 400 })

  // 只能切换到当前账号有成员身份的家庭
  const member = await prisma.member.findFirst({ where: { familyId, userId: ctx.userId } })
  if (!member) return NextResponse.json({ ok: false, error: '无权访问该家庭' }, { status: 403 })

  const token = await currentSessionToken()
  if (token) {
    await prisma.session.updateMany({ where: { token }, data: { familyId } })
  }
  await recordAudit(prisma, {
    familyId,
    actorId: member.id,
    actorName: member.name,
    action: 'FAMILY_SWITCH',
    entity: 'FamilySpace',
    entityId: familyId,
    detail: `切换到家庭「${member.familyId}」`,
  })

  return NextResponse.json({ ok: true, familyId })
}
