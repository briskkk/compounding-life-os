import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { creatorConfigSchema } from '@/lib/creator-export-contract'
import { authenticateCreator } from '@/lib/services/creator-export'

// Long read transactions must not hold locks against other suites' shared SQLite writers.
const isolated = vi.hoisted(() => ({
  directory: `${process.env.TMPDIR ?? '/tmp'}/creator-api-${process.pid}-${Date.now()}`,
}))
vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: `file:${isolated.directory}/test.db` }) }
})
import { prisma } from '@/lib/db'
import { GET } from '@/app/api/creator/v1/daily-snapshots/route'

const token = 'creator-test-read-only-credential-00000001'
const otherToken = 'creator-test-read-only-credential-00000002'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const base = new PrismaClient({ datasourceUrl: `file:${isolated.directory}/test.db` })
const directory = isolated.directory
let familyId: string
let otherFamilyId: string
let userId: string
let memberId: string
let accountId: string
let config: ReturnType<typeof creatorConfigSchema.parse>
const originalConfigPath = process.env.CREATOR_EXPORT_CONFIG_PATH
async function save() { await writeFile(path.join(directory, 'config.json'), JSON.stringify(config)) }
async function get(query = 'profile=demo&date=2026-11-20', credential: string | null = token) {
  return GET(new NextRequest(`http://localhost/api/creator/v1/daily-snapshots?${query}`, {
    headers: credential == null ? {} : { authorization: `Bearer ${credential}` },
  }))
}

beforeAll(async () => {
  await mkdir(directory, { recursive: true })
  const schema = (await readFile('prisma/schema.prisma', 'utf8'))
    .replace('file:./dev.db', `file:${directory}/test.db`)
  const schemaPath = path.join(directory, 'schema.prisma')
  await writeFile(schemaPath, schema)
  await writeFile(path.join(directory, 'test.db'), '')
  execFileSync(process.execPath, [
    path.resolve('node_modules/prisma/build/index.js'), 'db', 'push', '--schema', schemaPath, '--skip-generate',
  ], { stdio: 'pipe', timeout: 30000 })
  process.env.CREATOR_EXPORT_CONFIG_PATH = path.join(directory, 'config.json')
  const family = await base.familySpace.create({ data: { name: 'creator 测试甲家' } })
  familyId = family.id
  otherFamilyId = (await base.familySpace.create({ data: { name: 'creator 测试乙家' } })).id
  userId = (await base.user.create({ data: { email: `creator-${familyId}@test.local`, passwordHash: 'not-a-real-password' } })).id
  memberId = (await base.member.create({ data: { familyId, userId, role: 'OWNER', name: '不可公开姓名' } })).id
  accountId = (await base.account.create({ data: { familyId, name: '不可公开账户' } })).id
  const otherAccount = await base.account.create({ data: { familyId: otherFamilyId, name: '另一家账户' } })
  const cash = await base.asset.create({ data: { familyId, symbol: 'CASH-CNY', name: '现金', cls: 'CASH' } })
  const otherCash = await base.asset.create({ data: { familyId: otherFamilyId, symbol: 'CASH-CNY', name: '现金', cls: 'CASH' } })
  await base.transaction.createMany({ data: [
    { familyId, accountId, assetId: cash.id, type: 'DEPOSIT', amount: 1234.56, occurredAt: new Date('2026-11-19T10:00:00+08:00') },
    { familyId: otherFamilyId, accountId: otherAccount.id, assetId: otherCash.id, type: 'DEPOSIT', amount: 999999, occurredAt: new Date('2026-11-19T10:00:00+08:00') },
  ] })
  config = creatorConfigSchema.parse({ version: 1, profiles: [{
    slug: 'demo', enabled: true, familyId, authorizedByUserId: userId,
    accountIds: [accountId], scope: 'INVESTABLE', accountScopeLabel: '可投资资产',
    startDate: '2026-11-19', cutoffTime: '23:59:59', calendar: { kind: 'CN_FUND' },
    publicFields: ['assetTotal', 'pnl', 'netContribution', 'operations'],
    operationLabels: {}, tokenHashes: [hash(token)],
  }] })
  await save()
})

afterAll(async () => {
  if (originalConfigPath == null) delete process.env.CREATOR_EXPORT_CONFIG_PATH
  else process.env.CREATOR_EXPORT_CONFIG_PATH = originalConfigPath
  await Promise.all([base.$disconnect(), prisma.$disconnect()])
  await rm(directory, { recursive: true, force: true })
})

describe('creator API 只读凭证与家庭边界', () => {
  it('按历史日期读出精确金额，事务与审计均无写入，只序列化公开字段', async () => {
    const where = { familyId: { in: [familyId, otherFamilyId] } }
    const counts = () => Promise.all([
      base.transaction.count({ where }), base.auditLog.count({ where }), base.snapshot.count({ where }),
    ])
    const before = await counts()
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.json()
    expect(body).toMatchObject({ profile: 'demo', date: '2026-11-20', status: 'ready', kind: 'daily', dayNumber: 2, assetTotal: '1234.56', pnl: '0.00', netContribution: '0.00', operations: [] })
    expect(JSON.stringify(body)).not.toMatch(/不可公开|999999|familyId|accountId|userId|token|quantity|cost/)
    expect((await (await get()).json()).snapshotId).toBe(body.snapshotId)
    expect(await counts()).toEqual(before)
    expect((await (await get('profile=demo&date=2026-11-19')).json()).kind).toBe('baseline')
    expect(await (await get('profile=demo&date=2026-11-21')).json()).toEqual({ profile: 'demo', date: '2026-11-21', status: 'no_session' })
  })

  it('匿名、全局 Key、会话形状、未知/撤销凭证拒绝为401，已认证越权为403', async () => {
    for (const credential of [null, 'e2e-test-key', 'invalid-session', otherToken]) {
      const response = await get(undefined, credential)
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
    expect((await get('profile=other&date=2026-11-20')).status).toBe(403)
    config.profiles[0].tokenHashes = [hash(otherToken)]
    await save()
    expect((await get()).status).toBe(401)
    expect((await get(undefined, otherToken)).status).toBe(200)
    config.profiles[0].tokenHashes = [hash(token)]
    config.profiles[0].enabled = false
    await save()
    expect((await get()).status).toBe(401)
    config.profiles[0].enabled = true
    await save()
  })

  it('非法日期、开始日之前、重复或注入查询拒绝，未来为pending', async () => {
    for (const query of [
      'profile=demo&date=2026-02-30', 'profile=demo&date=2026-11-18',
      'profile=demo', 'profile=demo&date=2026-11-20&date=2026-11-19',
      'profile=demo&date=2026-11-20&accountId=other',
    ]) expect((await get(query)).status).toBe(400)
    expect(await (await get('profile=demo&date=2026-12-31')).json()).toEqual({ profile: 'demo', date: '2026-12-31', status: 'pending' })
  })

  it('授权用户被降级、移除或配置跨家庭账户时不导出', async () => {
    await base.member.update({ where: { id: memberId }, data: { role: 'VIEWER' } })
    expect((await get()).status).toBe(403)
    await base.member.update({ where: { id: memberId }, data: { role: 'OWNER' } })
    const foreign = await base.account.findFirstOrThrow({ where: { familyId: otherFamilyId } })
    config.profiles[0].accountIds = [foreign.id]
    await save()
    expect((await get()).status).toBe(403)
    config.profiles[0].accountIds = [accountId]
    await save()
    await base.member.update({ where: { id: memberId }, data: { userId: null } })
    expect((await get()).status).toBe(403)
    await base.member.update({ where: { id: memberId }, data: { userId } })
  })

  it('未配置默认关闭，损坏配置503不反射路径或凭证；配置凭证不能复用到另一profile', async () => {
    delete process.env.CREATOR_EXPORT_CONFIG_PATH
    expect((await get()).status).toBe(401)
    process.env.CREATOR_EXPORT_CONFIG_PATH = path.join(directory, 'config.json')
    await writeFile(process.env.CREATOR_EXPORT_CONFIG_PATH, '{bad-private-config')
    const response = await get()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'snapshot_unavailable' })
    await save()
    expect(creatorConfigSchema.safeParse({ version: 1, profiles: [config.profiles[0], { ...config.profiles[0], slug: 'other' }] }).success).toBe(false)
    expect(authenticateCreator(config.profiles, `Bearer ${token}`)?.slug).toBe('demo')
  })
})
