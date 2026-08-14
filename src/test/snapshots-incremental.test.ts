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
