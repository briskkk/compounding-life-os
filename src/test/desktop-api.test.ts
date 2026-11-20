import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const requestState = vi.hoisted(() => ({ req: null as NextRequest | null }))
vi.mock('next/headers', () => ({
  cookies: async () => requestState.req!.cookies,
  headers: async () => requestState.req!.headers,
}))
vi.mock('@/lib/db', () => ({ prisma: new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` }) }))

import { prisma } from '@/lib/db'
import { storedSessionToken } from '@/lib/session'
import { GET as glance } from '@/app/api/desktop/glance/route'
import { GET as tasks } from '@/app/api/desktop/tasks/route'
import { POST as logout } from '@/app/api/auth/logout/route'
import { POST as switchFamily } from '@/app/api/family/switch/route'

const familyIds: string[] = []
let userId: string
let viewerId: string
const token = 'desktop-contract-session'
const viewerToken = 'desktop-viewer-session'
async function call(handler: (req: NextRequest) => Promise<Response>, bearer?: string, cookie?: string, body?: unknown) {
  const headers = new Headers()
  if (bearer) headers.set('authorization', `Bearer ${bearer}`)
  if (cookie) headers.set('cookie', `fw_session=${cookie}`)
  requestState.req = new NextRequest('http://localhost/api/desktop/glance?familyId=untrusted', {
    method: body === undefined ? 'GET' : 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return handler(requestState.req)
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: 'desktop-contract@test.local', passwordHash: 'not-a-login' } })).id
  viewerId = (await prisma.user.create({ data: { email: 'desktop-viewer@test.local', passwordHash: 'not-a-login' } })).id
  for (const [index, name] of ['桌面甲家', '桌面乙家', '桌面不可访问家'].entries()) {
    const family = await prisma.familySpace.create({ data: { name } })
    familyIds.push(family.id)
    if (index < 2) await prisma.member.create({ data: { familyId: family.id, userId, name: '桌面测试', role: 'OWNER' } })
    const account = await prisma.account.create({ data: { familyId: family.id, name: '测试现金', type: 'BANK' } })
    const asset = await prisma.asset.create({ data: { familyId: family.id, name: '测试人民币', symbol: 'CASH-CNY', cls: 'CASH' } })
    await prisma.transaction.create({ data: {
      familyId: family.id, accountId: account.id, assetId: asset.id, type: 'DEPOSIT',
      quantity: (index + 1) * 100, amount: (index + 1) * 100, occurredAt: new Date('2026-11-01T02:00:00Z'),
    } })
  }
  await prisma.member.create({ data: { familyId: familyIds[0], userId: viewerId, name: '只读', role: 'VIEWER' } })
  for (const [raw, owner, expiresAt] of [
    [token, userId, new Date(Date.now() + 3600_000)],
    [viewerToken, viewerId, new Date(Date.now() + 3600_000)],
    ['desktop-expired', userId, new Date(Date.now() - 1000)],
  ] as const) {
    await prisma.session.create({ data: { userId: owner, familyId: familyIds[0], token: storedSessionToken(raw), expiresAt } })
  }
})

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: [userId, viewerId] } } })
  await prisma.familySpace.deleteMany({ where: { id: { in: familyIds } } })
  await prisma.user.deleteMany({ where: { id: { in: [userId, viewerId] } } })
  await prisma.$disconnect()
})

describe('桌面接口真实会话与家庭隔离', () => {
  it('两个路由在缺失、错误、过期和全局只读 Key 下统一 401 且不缓存', async () => {
    vi.stubEnv('PORTFOLIO_API_KEY', 'desktop-global-key')
    try {
      for (const handler of [glance, tasks]) {
        for (const credential of [undefined, 'wrong', 'desktop-expired', 'desktop-global-key']) {
          const response = await call(handler, credential)
          expect(response.status).toBe(401)
          expect(response.headers.get('cache-control')).toBe('private, no-store')
        }
      }
    } finally { vi.unstubAllEnvs() }
  })

  it('Cookie 和 Bearer 返回相同 scope；glance 只有契约字段、与权威现金账本一致', async () => {
    const response = await call(glance, token)
    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
    const data = await response.json()
    expect(Object.keys(data).sort()).toEqual(['netWorth', 'ok', 'scope', 'valuation'])
    expect(data.scope).toEqual({ userId, familyId: familyIds[0], familyName: '桌面甲家' })
    expect(data.netWorth).toEqual({ netWorth: 100, investable: 100, dayPnl: null, dayPct: null })
    expect(data.valuation).toEqual({
      asOfDate: null, quoteAsOf: null, syncedAt: expect.any(String), status: 'UNAVAILABLE', coveragePct: null,
    })
    expect(new Date(data.valuation.syncedAt).toISOString()).toBe(data.valuation.syncedAt)
    expect((await (await call(glance, undefined, token)).json()).scope).toEqual(data.scope)
    const independentTasks = await call(tasks, undefined, token)
    expect(independentTasks.status).toBe(200)
    expect(await independentTasks.json()).toMatchObject({ ok: true, scope: data.scope, totalCount: expect.any(Number), tasks: expect.any(Array) })
  })

  it('VIEWER 可以独立读取两个路由', async () => {
    for (const handler of [glance, tasks]) {
      expect((await (await call(handler, viewerToken)).json()).scope.userId).toBe(viewerId)
    }
  })

  it('Bearer 切换影响当前会话，两接口 scope 一起切换，其他会话保持隔离', async () => {
    expect((await call(switchFamily, token, undefined, { familyId: familyIds[2] })).status).toBe(403)
    expect((await call(switchFamily, token, undefined, { familyId: familyIds[1] })).status).toBe(200)
    const data = await (await call(glance, token)).json()
    expect(data.scope).toEqual({ userId, familyId: familyIds[1], familyName: '桌面乙家' })
    expect(data.netWorth.netWorth).toBe(200)
    expect((await (await call(tasks, token)).json()).scope).toEqual(data.scope)
    expect((await (await call(glance, viewerToken)).json()).netWorth.netWorth).toBe(100)
  })

  it('成员撤销后真实会话也被拒绝，Bearer logout 吊销服务器会话', async () => {
    await prisma.member.deleteMany({ where: { userId: viewerId } })
    for (const handler of [glance, tasks]) expect((await call(handler, viewerToken)).status).toBe(401)
    expect((await call(logout, token)).status).toBe(200)
    for (const handler of [glance, tasks]) expect((await call(handler, token)).status).toBe(401)
    expect(await prisma.session.count({ where: { token: storedSessionToken(token) } })).toBe(0)
  })
})
