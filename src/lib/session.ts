// 会话：网页走 httpOnly cookie，APP 走 Authorization: Bearer；两者共用 Session 表（token 字段）
// 未登录返回 null（调用方重定向 /login），不再回落第一个 OWNER
import { cookies, headers } from 'next/headers'
import { prisma } from './db'
import type { FamilyCtx } from './scoped'

export const SESSION_COOKIE = 'fw_session'
export const SESSION_TTL_MS = 30 * 24 * 3600_000 // 30 天

/** 从请求中提取会话 token：cookie 优先，其次 Bearer 头 */
async function sessionToken(): Promise<string | null> {
  const store = await cookies()
  const fromCookie = store.get(SESSION_COOKIE)?.value
  if (fromCookie) return fromCookie
  const h = await headers()
  const auth = h.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null
  return null
}

/** 供 API route 复用：获取当前会话 token（无则 null） */
export async function currentSessionToken(): Promise<string | null> {
  return sessionToken()
}

/** 供 API route 复用：按 token 查当前会话（含用户与家庭成员），未过期才返回 */
export async function findSessionByToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { members: true } } },
  })
  if (!session || session.expiresAt.getTime() <= Date.now()) return null
  return session
}

export async function getSession(): Promise<FamilyCtx | null> {
  const token = await sessionToken()
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { members: true } } },
  })
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  const member = session.user.members.find((m) => m.familyId === session.familyId)
  if (!member) return null
  return {
    familyId: member.familyId,
    memberId: member.id,
    memberName: member.name,
    role: member.role,
    userId: session.userId,
  }
}

/** 是否有有效会话（不校验家庭归属；用于"登录但未加入家庭"的引导） */
export async function hasSession(): Promise<{ userId: string; familyId: string } | null> {
  const token = await sessionToken()
  if (!token) return null
  const session = await prisma.session.findUnique({ where: { token } })
  if (!session || session.expiresAt.getTime() <= Date.now()) return null
  return { userId: session.userId, familyId: session.familyId }
}

export async function getSessionOrThrow(): Promise<FamilyCtx> {
  const ctx = await getSession()
  if (!ctx) throw new Error('未登录')
  return ctx
}
