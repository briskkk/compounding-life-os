// 共享事务写服务测试：Web 与 APP 共用的流水创建 / 冲正路径
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import type { FamilyCtx } from '@/lib/scoped'
import {
  correctEstimatedFundTransactionRecord,
  createTransactionRecord,
  reverseTransactionRecord,
  routedAccountIdForAsset,
} from '@/lib/services/transactions'
import {
  confirmFundOfficialNavRecord,
  confirmFundSettlementRecord,
  previewFundOfficialNavRecord,
} from '@/lib/services/fund-confirmations'

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })

let famId: string
let brokerId: string // 券商账户（配置了资金账户）
let bankId: string // 资金账户
let stockId: string // 股票资产
let cashId: string // 现金资产
let fundId: string // 场外基金

const ctx: FamilyCtx = { familyId: '', memberId: 'm-svc', memberName: '服务测试', role: 'OWNER', userId: 'u-svc' }

beforeAll(async () => {
  const fam = await base.familySpace.create({ data: { name: '事务服务测试家' } })
  famId = fam.id
  ctx.familyId = famId
  const bank = await base.account.create({ data: { familyId: famId, name: '资金户', type: 'BANK', currency: 'CNY' } })
  bankId = bank.id
  const broker = await base.account.create({
    data: { familyId: famId, name: '券商户', type: 'BROKERAGE', currency: 'CNY', settlementAccountId: bank.id },
  })
  brokerId = broker.id
  const stock = await base.asset.create({ data: { familyId: famId, symbol: 'SVC01', name: '测试股票', cls: 'STOCK', currency: 'CNY' } })
  stockId = stock.id
  const cash = await base.asset.create({ data: { familyId: famId, symbol: 'CASH01', name: '人民币现金', cls: 'CASH', currency: 'CNY' } })
  cashId = cash.id
  const fund = await base.asset.create({ data: { familyId: famId, symbol: 'SVCF01', name: '测试基金', cls: 'FUND', currency: 'CNY' } })
  fundId = fund.id
})

afterAll(async () => {
  await base.$disconnect()
})

describe('createTransactionRecord（共享写服务）', () => {
  it('BUY 写入主流水并生成现金结算腿（WITHDRAW、internal、settleOfId 关联）', async () => {
    const { id } = await base.$transaction((tx) =>
      createTransactionRecord(tx, ctx, {
        accountId: brokerId,
        assetId: stockId,
        type: 'BUY',
        quantity: 100,
        price: 10,
        amount: 1000,
        fee: 5,
        occurredAt: new Date('2026-01-05T00:00:00Z'),
        note: '买入测试',
        settleCash: true,
      }),
    )
    const main = await base.transaction.findUnique({ where: { id } })
    expect(main?.accountId).toBe(brokerId)
    expect(Number(main?.amount)).toBe(1000)

    const leg = await base.transaction.findFirst({ where: { settleOfId: id } })
    expect(leg).not.toBeNull()
    expect(leg?.type).toBe('WITHDRAW')
    expect(Number(leg?.amount)).toBe(1005) // 金额 + 费用
    expect(leg?.accountId).toBe(bankId)
    expect(leg?.assetId).toBe(cashId)
    expect(leg?.internal).toBe(true)
  })

  it('未配置资金账户时 BUY 默认不结算，不报错', async () => {
    // 单独建一个无资金账户的账户与资产
    const plain = await base.account.create({ data: { familyId: famId, name: '独立账户', type: 'BROKERAGE', currency: 'CNY' } })
    const plainAsset = await base.asset.create({ data: { familyId: famId, symbol: 'SVC02', name: '无结算股票', cls: 'STOCK', currency: 'CNY' } })
    const { id } = await base.$transaction((tx) =>
      createTransactionRecord(tx, ctx, {
        accountId: plain.id,
        assetId: plainAsset.id,
        type: 'BUY',
        quantity: 10,
        price: 5,
        amount: 50,
        fee: 0,
        occurredAt: new Date('2026-01-06T00:00:00Z'),
        note: null,
        settleCash: false,
      }),
    )
    const legs = await base.transaction.findMany({ where: { settleOfId: id } })
    expect(legs).toHaveLength(0)
  })

  it('超卖被拒绝：SELL 数量大于可用数量抛错', async () => {
    await expect(
      base.$transaction((tx) =>
        createTransactionRecord(tx, ctx, {
          accountId: brokerId,
          assetId: stockId,
          type: 'SELL',
          quantity: 9999,
          price: 10,
          amount: 99990,
          fee: 0,
          occurredAt: new Date('2026-01-07T00:00:00Z'),
        note: null,
          settleCash: false,
        }),
      ),
    ).rejects.toThrow(/数量不足/)
  })

  it('DEPOSIT 只能记在现金资产：非现金资产被拒绝', async () => {
    await expect(
      base.$transaction((tx) =>
        createTransactionRecord(tx, ctx, {
          accountId: brokerId,
          assetId: stockId,
          type: 'DEPOSIT',
          quantity: null,
          price: null,
          amount: 100,
          fee: 0,
          occurredAt: new Date('2026-01-08T00:00:00Z'),
        note: null,
          settleCash: false,
        }),
      ),
    ).rejects.toThrow(/现金资产/)
  })

  it('routedAccountIdForAsset：现金流水路由到资金账户', async () => {
    const routed = await routedAccountIdForAsset(base, famId, brokerId, cashId)
    expect(routed).toBe(bankId)
  })

  it('基金暂停申购窗口拦截普通 BUY，但允许有证据的红利再投份额', async () => {
    await base.fundTradePolicy.create({
      data: {
        familyId: famId,
        assetId: fundId,
        purchaseFeeRate: 0,
        redemptionFeeRules: '[]',
        purchaseSuspendedFrom: new Date('2026-08-20T00:00:00Z'),
        purchaseSuspendedUntil: new Date('2026-08-27T00:00:00Z'),
        sourceName: '测试公告',
      },
    })
    const input = {
      accountId: brokerId,
      assetId: fundId,
      type: 'BUY' as const,
      quantity: 100,
      price: 1,
      amount: 100,
      fee: 0,
      occurredAt: new Date('2026-08-25T10:00:00Z'),
      navDate: new Date('2026-08-25T00:00:00Z'),
      navSource: 'OFFICIAL' as const,
      note: '暂停期申购',
      settleCash: false,
    }
    await expect(base.$transaction((tx) => createTransactionRecord(tx, ctx, input))).rejects.toThrow(/暂停申购/)
    await expect(base.$transaction((tx) => createTransactionRecord(tx, ctx, input, {
      allowSuspendedFundPurchase: true,
    }))).resolves.toMatchObject({ id: expect.any(String) })
  })
})

describe('reverseTransactionRecord（共享冲正服务）', () => {
  it('冲正作废主流水与结算腿，并留下 REVERSAL', async () => {
    const { id } = await base.$transaction((tx) =>
      createTransactionRecord(tx, ctx, {
        accountId: brokerId,
        assetId: stockId,
        type: 'BUY',
        quantity: 5,
        price: 20,
        amount: 100,
        fee: 1,
        occurredAt: new Date('2026-02-01T00:00:00Z'),
        note: null,
        settleCash: true,
      }),
    )
    await base.$transaction((tx) => reverseTransactionRecord(tx, ctx, id))

    const main = await base.transaction.findUnique({ where: { id } })
    expect(main?.voidedAt).not.toBeNull()
    const leg = await base.transaction.findFirst({ where: { settleOfId: id } })
    expect(leg?.voidedAt).not.toBeNull()
    const reversal = await base.transaction.findFirst({ where: { reversalOfId: id } })
    expect(reversal?.type).toBe('REVERSAL')

    // 重复冲正被拒绝
    await expect(base.$transaction((tx) => reverseTransactionRecord(tx, ctx, id))).rejects.toThrow(/已被冲正/)
  })
})

describe('correctEstimatedFundTransactionRecord（官方净值修正）', () => {
  it('冲正估算流水及结算腿，再按官方净值建立替代流水', async () => {
    const original = await base.$transaction((tx) =>
      createTransactionRecord(tx, ctx, {
        accountId: brokerId,
        assetId: fundId,
        type: 'BUY',
        quantity: 1000,
        price: 1,
        amount: 1000,
        fee: 2,
        occurredAt: new Date('2026-03-02T10:00:00Z'),
        navDate: new Date('2026-03-02T00:00:00Z'),
        navSource: 'ESTIMATE',
        note: '盘中估算申购',
        settleCash: true,
      }),
    )
    const corrected = await base.$transaction((tx) =>
      correctEstimatedFundTransactionRecord(tx, ctx, original.id, 1.25),
    )

    expect(corrected).toMatchObject({ oldPrice: 1, newPrice: 1.25, oldQuantity: 1000, newQuantity: 800 })
    const oldRow = await base.transaction.findUnique({ where: { id: original.id } })
    const newRow = await base.transaction.findUnique({ where: { id: corrected.id } })
    expect(oldRow?.voidedAt).not.toBeNull()
    expect(newRow?.navSource).toBe('OFFICIAL')
    expect(Number(newRow?.quantity)).toBe(800)
    expect(Number(newRow?.amount)).toBe(1000)
    expect(await base.transaction.findFirst({ where: { settleOfId: original.id, voidedAt: { not: null } } })).not.toBeNull()
    expect(Number((await base.transaction.findFirst({ where: { settleOfId: corrected.id } }))?.amount)).toBe(1002)
  })

  it('份额未知的申购可先联动扣减现金，再按官方净值替换', async () => {
    const original = await base.$transaction((tx) =>
      createTransactionRecord(tx, ctx, {
        accountId: brokerId,
        assetId: fundId,
        type: 'BUY',
        quantity: null,
        price: null,
        amount: 1000,
        fee: 2,
        occurredAt: new Date('2026-04-01T10:00:00Z'),
        navDate: new Date('2026-04-01T00:00:00Z'),
        navSource: 'PENDING',
        note: '申购份额待确认',
        settleCash: true,
      }),
    )
    const pendingRow = await base.transaction.findUnique({ where: { id: original.id } })
    expect(pendingRow?.quantity).toBeNull()
    expect(pendingRow?.price).toBeNull()
    expect(Number((await base.transaction.findFirst({ where: { settleOfId: original.id } }))?.amount)).toBe(1002)

    const corrected = await base.$transaction((tx) =>
      correctEstimatedFundTransactionRecord(tx, ctx, original.id, 1.25),
    )
    const newRow = await base.transaction.findUnique({ where: { id: corrected.id } })
    expect(corrected).toMatchObject({ oldPrice: 0, oldQuantity: 0, newPrice: 1.25, newQuantity: 800 })
    expect(Number(newRow?.amount)).toBe(1000)
    expect(Number(newRow?.quantity)).toBe(800)
  })
})

describe('基金确认共享服务（Web Action / App REST 同源）', () => {
  it('从已落库官方净值确认 PENDING 申购并重建为 OFFICIAL 流水', async () => {
    const navDate = new Date('2026-05-06T00:00:00+08:00')
    const original = await base.$transaction((tx) => createTransactionRecord(tx, ctx, {
      accountId: brokerId,
      assetId: fundId,
      type: 'BUY',
      quantity: null,
      price: null,
      amount: 500,
      fee: 0,
      occurredAt: new Date('2026-05-06T10:00:00+08:00'),
      navDate,
      navSource: 'PENDING',
      note: 'REST 确认测试',
      settleCash: true,
    }))
    await base.priceBar.create({
      data: { symbol: 'SVCF01', date: navDate, close: 1.25, source: 'EASTMONEY-FUND' },
    })

    const preview = await previewFundOfficialNavRecord(base, ctx, original.id)
    expect(preview).toMatchObject({
      assetSymbol: 'SVCF01',
      amount: 500,
      officialNav: 1.25,
      calculatedQuantity: 400,
      source: 'EASTMONEY-FUND',
    })
    await expect(confirmFundOfficialNavRecord(base, ctx, original.id, 399.99)).rejects.toThrow(/平台份额与账本推算不一致/)
    expect((await base.transaction.findUnique({ where: { id: original.id } }))?.voidedAt).toBeNull()

    const result = await confirmFundOfficialNavRecord(base, ctx, original.id, 400)
    expect(result).toMatchObject({ oldQuantity: 0, newQuantity: 400, newPrice: 1.25 })
    expect((await base.transaction.findUnique({ where: { id: original.id } }))?.voidedAt).not.toBeNull()
    expect((await base.transaction.findUnique({ where: { id: result.id } }))?.navSource).toBe('OFFICIAL')
  })

  it('赎回到账确认只追加一次审计证据', async () => {
    const sell = await base.$transaction((tx) => createTransactionRecord(tx, ctx, {
      accountId: brokerId,
      assetId: fundId,
      type: 'SELL',
      quantity: 10,
      price: 1.3,
      amount: 13,
      fee: 0,
      occurredAt: new Date('2026-06-01T10:00:00+08:00'),
      navDate: new Date('2026-06-01T00:00:00+08:00'),
      navSource: 'OFFICIAL',
      settlementDate: new Date('2026-06-03T00:00:00+08:00'),
      note: '到账确认测试',
      settleCash: true,
    }))
    expect(await confirmFundSettlementRecord(base, ctx, sell.id)).toEqual({ replayed: false })
    expect(await confirmFundSettlementRecord(base, ctx, sell.id)).toEqual({ replayed: true })
    expect(await base.auditLog.count({
      where: { familyId: famId, action: 'FUND_SETTLEMENT_CONFIRMED', entityId: sell.id },
    })).toBe(1)
  })
})
