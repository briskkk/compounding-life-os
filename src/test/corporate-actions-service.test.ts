import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import type { FamilyCtx } from '@/lib/scoped'
import { createCorporateActionRecord, reverseCorporateActionRecord } from '@/lib/services/corporate-actions'
import { createTransactionRecord } from '@/lib/services/transactions'
import { foldTransactions, type LedgerTx } from '@/lib/engine/ledger'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })
const ctx: FamilyCtx = { familyId: '', memberId: 'm-action', memberName: '公司行动测试', role: 'OWNER', userId: 'u-action' }
let brokerId: string
let bankId: string
let stockId: string
let targetId: string

beforeAll(async () => {
  const family = await db.familySpace.create({ data: { name: '公司行动测试家庭' } })
  ctx.familyId = family.id
  const bank = await db.account.create({ data: { familyId: family.id, name: '行动资金户', type: 'BANK', currency: 'CNY' } })
  bankId = bank.id
  const broker = await db.account.create({ data: { familyId: family.id, name: '行动证券户', type: 'BROKERAGE', currency: 'CNY', settlementAccountId: bank.id } })
  brokerId = broker.id
  const stock = await db.asset.create({ data: { familyId: family.id, symbol: 'ACT01', name: '行动股票', cls: 'STOCK', currency: 'CNY' } })
  stockId = stock.id
  const target = await db.asset.create({ data: { familyId: family.id, symbol: 'ACT02', name: '换股目标', cls: 'STOCK', currency: 'CNY' } })
  targetId = target.id
  await db.asset.create({ data: { familyId: family.id, symbol: 'ACT-CASH', name: '行动现金', cls: 'CASH', currency: 'CNY' } })
  await db.$transaction((tx) => createTransactionRecord(tx, ctx, {
    accountId: broker.id,
    assetId: stock.id,
    type: 'BUY',
    quantity: 10,
    price: 100,
    amount: 1000,
    fee: 0,
    occurredAt: new Date('2026-01-05T00:00:00Z'),
    note: null,
    settleCash: false,
  }))
})

afterAll(async () => db.$disconnect())

async function position(accountId: string, assetId: string) {
  const [asset, rows] = await Promise.all([
    db.asset.findUniqueOrThrow({ where: { id: assetId } }),
    db.transaction.findMany({ where: { familyId: ctx.familyId, accountId, assetId }, orderBy: { occurredAt: 'asc' } }),
  ])
  return foldTransactions(rows.map((tx): LedgerTx => ({
    accountId: tx.accountId,
    assetId: tx.assetId,
    type: tx.type,
    quantity: tx.quantity == null ? null : Number(tx.quantity),
    price: tx.price == null ? null : Number(tx.price),
    amount: Number(tx.amount),
    fee: Number(tx.fee),
    occurredAt: tx.occurredAt,
    assetClass: asset.cls,
    internal: tx.internal,
    voidedAt: tx.voidedAt,
  })))[0]
}

describe('公司行动写入服务', () => {
  it('1:8 拆股生成份额调整，数量变为 80 且成本保持 1000', async () => {
    const created = await db.$transaction((tx) => createCorporateActionRecord(tx, ctx, {
      type: 'SPLIT',
      accountId: brokerId,
      assetId: stockId,
      effectiveAt: new Date('2026-04-21T00:00:00Z'),
      ratioNumerator: 8,
      ratioDenominator: 1,
      cashAmount: 0,
      fee: 0,
      sourceName: '发行方公告',
    }))
    const action = await db.corporateAction.findUniqueOrThrow({ where: { id: created.id }, include: { transactions: true } })
    expect(action.transactions.some((tx) => tx.type === 'SHARE_ADJUSTMENT')).toBe(true)
    expect((await position(brokerId, stockId)).quantity).toBe(80)
    expect((await position(brokerId, stockId)).costBasis).toBe(1000)
  })

  it('现金分配同时生成分红流水和资金账户入账', async () => {
    const created = await db.$transaction((tx) => createCorporateActionRecord(tx, ctx, {
      type: 'CASH_DISTRIBUTION',
      accountId: brokerId,
      assetId: stockId,
      effectiveAt: new Date('2026-06-30T00:00:00Z'),
      cashAmount: 20,
      fee: 2,
      sourceName: '券商月结单',
    }))
    const rows = await db.transaction.findMany({ where: { corporateActionId: created.id } })
    expect(rows.find((tx) => tx.type === 'DIVIDEND')).toBeTruthy()
    const cashLeg = rows.find((tx) => tx.type === 'DEPOSIT' && tx.accountId === bankId)
    expect(Number(cashLeg?.amount)).toBe(18)
  })

  it('代码变更把全部数量和成本迁移到目标资产，冲正后恢复', async () => {
    const created = await db.$transaction((tx) => createCorporateActionRecord(tx, ctx, {
      type: 'SYMBOL_CHANGE',
      accountId: brokerId,
      assetId: stockId,
      targetAssetId: targetId,
      effectiveAt: new Date('2026-07-01T00:00:00Z'),
      ratioNumerator: 1,
      ratioDenominator: 1,
      cashAmount: 0,
      fee: 0,
      sourceName: '交易所公告',
    }))
    expect((await position(brokerId, stockId)).quantity).toBe(0)
    expect((await position(brokerId, targetId)).quantity).toBe(80)
    expect((await position(brokerId, targetId)).costBasis).toBe(1000)

    await db.$transaction((tx) => reverseCorporateActionRecord(tx, ctx, created.id))
    expect((await position(brokerId, stockId)).quantity).toBe(80)
    const target = await position(brokerId, targetId)
    expect(target?.quantity ?? 0).toBe(0)
  })
})
