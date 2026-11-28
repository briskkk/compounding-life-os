import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { creatorConfigSchema } from '../src/lib/creator-export-contract'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/e2e.db')}` })
const configPath = path.resolve('outputs/e2e-creator-export.json')
const token = 'creator-e2e-only-read-only-token-000000001'
let familyId: string
let userId: string
let config: ReturnType<typeof creatorConfigSchema.parse>
const url = (date: string, profile = 'fixture') => `/api/creator/v1/daily-snapshots?profile=${profile}&date=${date}`

test.beforeAll(async () => {
  familyId = (await db.familySpace.create({ data: { name: 'creator 独立夹具' } })).id
  userId = (await db.user.create({ data: { email: `creator-e2e-${familyId}@test.local`, passwordHash: 'fixture-only' } })).id
  await db.member.create({ data: { familyId, userId, name: '秘密姓名', role: 'OWNER' } })
  const account = await db.account.create({ data: { familyId, name: '秘密账户' } })
  const asset = await db.asset.create({ data: { familyId, symbol: 'CASH-CNY', name: '现金', cls: 'CASH' } })
  await db.transaction.create({ data: { familyId, accountId: account.id, assetId: asset.id, type: 'DEPOSIT', amount: 1234.56, occurredAt: new Date('2026-11-19T10:00:00+08:00') } })
  config = creatorConfigSchema.parse({ version: 1, profiles: [{
    slug: 'fixture', enabled: true, familyId, authorizedByUserId: userId,
    accountIds: [account.id], scope: 'INVESTABLE', accountScopeLabel: '可投资资产',
    startDate: '2026-11-19', cutoffTime: '23:59:59', calendar: { kind: 'CN_FUND' },
    publicFields: ['assetTotal', 'pnl', 'netContribution', 'operations'], operationLabels: {},
    tokenHashes: [createHash('sha256').update(token).digest('hex')],
  }] })
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config))
})

test.afterAll(async () => {
  await rm(configPath, { force: true })
  await db.familySpace.deleteMany({ where: { id: familyId } })
  await db.user.deleteMany({ where: { id: userId } })
  await db.$disconnect()
})

test('creator 凭证按日期只读，无会话依赖；基线、历史重发、休市与待结算', async ({ playwright }) => {
  const client = await playwright.request.newContext({
    baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  })
  try {
    const baseline = await client.get(url('2026-11-19'))
    expect(baseline.status()).toBe(200)
    expect(baseline.headers()['cache-control']).toBe('private, no-store')
    expect(await baseline.json()).toMatchObject({ kind: 'baseline', dayNumber: 1, assetTotal: '1234.56', pnl: null, netContribution: null })
    const response = await client.get(url('2026-11-20'))
    expect(response.status()).toBe(200)
    const daily = await response.json()
    expect(daily).toMatchObject({ status: 'ready', kind: 'daily', dayNumber: 2, pnl: '0.00', netContribution: '0.00', operations: [] })
    expect(JSON.stringify(daily)).not.toMatch(/秘密|userId|familyId|accountId|quantity|cost|token/)
    expect(await (await client.get(url('2026-11-20'))).json()).toEqual(daily)
    expect((await (await client.get(url('2026-11-21'))).json()).status).toBe('no_session')
    expect((await (await client.get(url('2026-12-31'))).json()).status).toBe('pending')
    // Official ledger correction changes the immutable version.
    const row = await db.transaction.findFirstOrThrow({ where: { familyId } })
    await db.transaction.update({ where: { id: row.id }, data: { amount: 1235.56 } })
    expect((await (await client.get(url('2026-11-20'))).json()).snapshotId).not.toBe(daily.snapshotId)
    expect((await client.get(url('2026-11-20', 'another'))).status()).toBe(403)
    expect((await client.get('/api/positions')).status()).toBe(401)
    expect((await client.post('/api/transactions', { data: {} })).status()).toBe(401)
    config.profiles[0].enabled = false
    await writeFile(configPath, JSON.stringify(config))
    expect((await client.get(url('2026-11-20'))).status()).toBe(401)
  } finally { await client.dispose() }
})

test('creator 不接受已有Web Cookie或全局只读Key，错误响应也禁止缓存', async ({ request, playwright }) => {
  // The logged-in browser fixture cannot substitute for a creator capability.
  expect((await request.get(url('2026-11-20'))).status()).toBe(401)
  const client = await playwright.request.newContext({ baseURL: 'http://localhost:3200', storageState: { cookies: [], origins: [] } })
  try {
    const headerCases: Record<string, string>[] = [{}, { authorization: 'Bearer e2e-test-key' }]
    for (const headers of headerCases) {
      const response = await client.get(url('2026-11-20'), { headers })
      expect(response.status()).toBe(401)
      expect(response.headers()['cache-control']).toBe('private, no-store')
    }
  } finally { await client.dispose() }
})
