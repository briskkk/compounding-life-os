// 快照增量重建测试：rebuildSnapshots 的 affectedSince 语义
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { rebuildSnapshots } from '@/lib/snapshots'

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })

let famId: string
let cashAcc: string
let cashAsset: string
let stockAcc: string
let stockAsset: string

const DAY = 86400000
const D = (s: string) => new Date(s)

beforeAll(async () => {
  const fam = await base.familySpace.create({ data: { name: '增量快照测试家' } })
  famId = fam.id
  const acc = await base.account.create({ data: { familyId: famId, name: '现金户', type: 'BANK', currency: 'CNY' } })
  cashAcc = acc.id
  const stock = await base.account.create({ data: { familyId: famId, name: '券商', type: 'BROKERAGE', currency: 'CNY' } })
  stockAcc = stock.id
  const cash = await base.asset.create({ data: { familyId: famId, symbol: 'INCCASH', name: '人民币现金', cls: 'CASH', currency: 'CNY' } })
  cashAsset = cash.id
  const stk = await base.asset.create({ data: { familyId: famId, symbol: 'INCTEST', name: '测试股', cls: 'STOCK', currency: 'CNY' } })
  stockAsset = stk.id
})

afterAll(async () => {
  await base.$disconnect()
})

async function seedTx(accountId: string, assetId: string, type: 'DEPOSIT' | 'BUY', quantity: number | null, price: number | null, amount: number, occurredAt: Date) {
  await base.transaction.create({
    data: { familyId: famId, accountId, assetId, type, quantity, price, amount, fee: 0, occurredAt },
  })
}

describe('rebuildSnapshots 增量重建', () => {
  it('全量重建后按受影响日期增量重算，早于该日的快照保留且值不变', async () => {
    await seedTx(cashAcc, cashAsset, 'DEPOSIT', null, null, 10000, D('2026-01-01T00:00:00Z'))
    // 全量：从最早流水日开始
    await rebuildSnapshots(base, famId)
    const afterFull = await base.snapshot.findMany({ where: { familyId: famId }, orderBy: { date: 'asc' } })
    expect(afterFull.length).toBeGreaterThan(1)
    const jan1 = afterFull.find((s) => s.date.getTime() === D('2026-01-01T00:00:00Z').getTime())
    expect(Number(jan1?.netWorth)).toBe(10000)

    // 1 月 10 日追加存款 → 增量重建（affectedSince = 1 月 10 日）
    await seedTx(cashAcc, cashAsset, 'DEPOSIT', null, null, 5000, D('2026-01-10T00:00:00Z'))
    await rebuildSnapshots(base, famId, { affectedSince: D('2026-01-10T00:00:00Z') })

    const afterIncremental = await base.snapshot.findMany({ where: { familyId: famId }, orderBy: { date: 'asc' } })
    // 快照总数不变（1/1..today 仍然覆盖）
    expect(afterIncremental.length).toBe(afterFull.length)
    // 1 月 1 日快照保持不变（早于 affectedSince，未重算，仍为 10000）
    const jan1After = afterIncremental.find((s) => s.date.getTime() === D('2026-01-01T00:00:00Z').getTime())
    expect(Number(jan1After?.netWorth)).toBe(10000)
    // 1 月 10 日及之后为 15000
    const jan10 = afterIncremental.find((s) => s.date.getTime() === D('2026-01-10T00:00:00Z').getTime())
    expect(Number(jan10?.netWorth)).toBe(15000)
    // 今天也是 15000
    expect(Number(afterIncremental.at(-1)?.netWorth)).toBe(15000)
  })

  it('未来日期的 affectedSince 被钳制到今日，不报错', async () => {
    await seedTx(stockAcc, stockAsset, 'BUY', 10, 10, 100, D('2026-02-01T00:00:00Z'))
    const future = new Date(Date.now() + 30 * DAY)
    const days = await rebuildSnapshots(base, famId, { affectedSince: future })
    expect(days).toBeGreaterThan(0)
    const latest = await base.snapshot.findFirst({ where: { familyId: famId }, orderBy: { date: 'desc' } })
    expect(Number(latest?.netWorth)).toBeGreaterThanOrEqual(100)
  })
})

describe('rebuildSnapshots 日界对齐与原子性', () => {
  async function seedFamily(name: string) {
    const fam = await base.familySpace.create({ data: { name } })
    const account = await base.account.create({ data: { familyId: fam.id, name: '现金户', type: 'BANK', currency: 'CNY' } })
    const asset = await base.asset.create({
      data: { familyId: fam.id, symbol: `CASH${fam.id.slice(-8)}`, name: '人民币现金', cls: 'CASH', currency: 'CNY' },
    })
    return { familyId: fam.id, accountId: account.id, assetId: asset.id }
  }

  async function seedDeposit(fixture: { familyId: string; accountId: string; assetId: string }, amount: number, occurredAt: Date) {
    await base.transaction.create({
      data: { familyId: fixture.familyId, accountId: fixture.accountId, assetId: fixture.assetId, type: 'DEPOSIT', amount, fee: 0, occurredAt },
    })
  }

  async function snapshotTimes(familyId: string): Promise<number[]> {
    const rows = await base.snapshot.findMany({ where: { familyId }, orderBy: { date: 'asc' }, select: { date: true } })
    return rows.map((row) => row.date.getTime())
  }

  it('affectedSince 落在北京凌晨时不再重写未删除的当日行，也不丢尾部', async () => {
    const fixture = await seedFamily('快照日界测试家')
    await seedDeposit(fixture, 10000, D('2026-01-01T00:00:00Z'))
    await rebuildSnapshots(base, fixture.familyId)
    const before = await snapshotTimes(fixture.familyId)
    expect(before.length).toBeGreaterThan(30)

    // 2026-01-10T17:00Z = 北京 2026-01-11 01:00：删除阈值是 01-11，写入起点按 UTC 取整会是 01-10，
    // 于是重写一条未被删除的 01-10 行并撞上 (familyId, date) 唯一约束，整批写入失败且尾部已被删掉。
    await rebuildSnapshots(base, fixture.familyId, { affectedSince: D('2026-01-10T17:00:00Z') })

    const after = await snapshotTimes(fixture.familyId)
    expect(after).toEqual(before)
    for (let index = 1; index < after.length; index++) {
      expect(after[index] - after[index - 1]).toBe(DAY)
    }
  })

  it('计算失败时保留原有快照，不再先清空后失败', async () => {
    const fixture = await seedFamily('快照原子性测试家')
    await seedDeposit(fixture, 10000, D('2026-01-01T00:00:00Z'))
    await rebuildSnapshots(base, fixture.familyId)
    const before = await snapshotTimes(fixture.familyId)
    expect(before.length).toBeGreaterThan(30)

    // 追加一笔把重放区间拉过 36525 天上限的流水
    await seedDeposit(fixture, 1, D('1900-01-01T00:00:00Z'))
    await expect(rebuildSnapshots(base, fixture.familyId)).rejects.toThrow(/快照区间超过/)
    expect(await snapshotTimes(fixture.familyId)).toEqual(before)
  })
})
