import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'

const routes = ['/api/desktop/glance', '/api/desktop/tasks']

test('桌面接口 Cookie 契约及禁止全局 Key', async ({ request, playwright }) => {
  for (const route of routes) {
    const response = await request.get(route)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    expect((await response.json()).scope).toEqual({
      userId: expect.any(String), familyId: expect.any(String), familyName: expect.any(String),
    })
  }
  const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
  const headerCases: Record<string, string>[] = [{}, { authorization: 'Bearer e2e-test-key' }, { authorization: 'Bearer invalid-session' }]
  try {
    for (const route of routes) {
      for (const headers of headerCases) {
        const response = await anonymous.get(route, { headers })
        expect(response.status()).toBe(401)
        expect(response.headers()['cache-control']).toBe('private, no-store')
      }
    }
  } finally { await anonymous.dispose() }
})

test('Bearer 会话独立待办、切换家庭与服务端注销', async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
  const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })
  const email = `desktop-e2e-${Date.now()}@test.local`
  const familyIds: string[] = []
  let userId: string | undefined
  try {
    const registration = await client.post('/api/auth/register', { data: { email, password: 'desktop-e2e-password' } })
    expect(registration.status()).toBe(200)
    const { token } = await registration.json()
    // 新上下文只发送 Bearer，避免注册返回的 Cookie 掩盖 Bearer 认证问题。
    const bearer = await playwright.request.newContext({
      baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { authorization: `Bearer ${token}` },
    })
    try {
      const first = await bearer.post('/api/family', { data: { name: '桌面契约甲家' } })
      expect(first.status()).toBe(200)
      familyIds.push((await first.json()).familyId)
      // tasks 在未调用 glance 时即可独立给出 scope。
      const tasksResponse = await bearer.get(routes[1])
      expect(tasksResponse.status()).toBe(200)
      const taskData = await tasksResponse.json()
      userId = taskData.scope.userId
      expect(taskData).toEqual({
        ok: true, scope: { userId, familyId: familyIds[0], familyName: '桌面契约甲家' }, totalCount: 0, tasks: [],
      })
      const glanceResponse = await bearer.get(`${routes[0]}?familyId=untrusted`)
      expect(glanceResponse.status()).toBe(200)
      const data = await glanceResponse.json()
      expect(data).toEqual({
        ok: true, scope: taskData.scope,
        netWorth: { netWorth: 0, investable: 0, dayPnl: null, dayPct: null },
        valuation: { status: 'UNAVAILABLE', asOfDate: null, quoteAsOf: null, syncedAt: expect.any(String), coveragePct: null },
      })
      const second = await bearer.post('/api/family', { data: { name: '桌面契约乙家' } })
      expect(second.status()).toBe(200)
      familyIds.push((await second.json()).familyId)
      expect((await (await bearer.get(routes[0])).json()).scope.familyId).toBe(familyIds[1])
      expect((await bearer.post('/api/family/switch', { data: { familyId: 'not-a-member' } })).status()).toBe(403)
      expect((await bearer.post('/api/family/switch', { data: { familyId: familyIds[0] } })).status()).toBe(200)
      for (const route of routes) expect((await (await bearer.get(route)).json()).scope).toEqual(taskData.scope)
      expect((await bearer.post('/api/auth/logout')).status()).toBe(200)
      for (const route of routes) expect((await bearer.get(route)).status()).toBe(401)
    } finally { await bearer.dispose() }
  } finally {
    const user = userId ? { id: userId } : await db.user.findUnique({ where: { email } })
    if (user) await db.session.deleteMany({ where: { userId: user.id } })
    await db.familySpace.deleteMany({ where: { id: { in: familyIds } } })
    if (user) await db.user.delete({ where: { id: user.id } })
    await db.$disconnect()
    await client.dispose()
  }
})
