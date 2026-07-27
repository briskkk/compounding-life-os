// 轻量会话：cookie 记录当前成员；缺省回落到 OWNER，保证开箱即用
import { cookies } from 'next/headers'
import { prisma } from './db'
import type { FamilyCtx } from './scoped'

export const MEMBER_COOKIE = 'fw_member'

export async function getSession(): Promise<FamilyCtx | null> {
  const store = await cookies()
  const memberId = store.get(MEMBER_COOKIE)?.value
  let member = memberId
    ? await prisma.member.findUnique({ where: { id: memberId } })
    : null
  if (!member) {
    member = await prisma.member.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } })
  }
  if (!member) return null
  return {
    familyId: member.familyId,
    memberId: member.id,
    memberName: member.name,
    role: member.role,
  }
}

export async function getSessionOrThrow(): Promise<FamilyCtx> {
  const ctx = await getSession()
  if (!ctx) throw new Error('尚未初始化家庭空间，请先运行 npm run db:seed')
  return ctx
}
