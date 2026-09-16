// 写入幂等约束：同一家庭的相同提交键只能落一条流水（Web / APP 共用同一列）
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { createTransactionRecord } from '@/lib/services/transactions'
import { requestHashOf } from '@/lib/idempotency'
import type { FamilyCtx } from '@/lib/scoped'

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })

let familyId: string
let accountId: string
let cashAssetId: string

function ctxOf(id: string): FamilyCtx {
  return { familyId: id, memberId: 'm-idem', memberName: '幂等测试', role: 'OWNER', userId: 'u-idem' }
}

function depositData() {
  return {
    accountId,
    assetId: cashAssetId,
    type: 'DEPOSIT' as const,
    quantity: null,
    price: null,
    amount: 500,
    fee: 0,
    occurredAt: new Date('2026-09-16T04:00:00.000Z'),
    navDate: null,
    navSource: null,
    settlementDate: null,
    note: '幂等测试',
    settleCash: false,
  }
}

beforeAll(async () => {
  const family = await base.familySpace.create({ data: { name: `幂等测试家庭 ${Date.now()}` } })
  familyId = family.id
  accountId = (await base.account.create({ data: { familyId, name: '幂等测试账户', type: 'BANK' } })).id
  cashAssetId = (await base.asset.create({ data: { familyId, name: '人民币现金', symbol: 'CASH-IDEM', cls: 'CASH' } })).id
})

afterAll(async () => {
  await base.transaction.deleteMany({ where: { familyId } })
  await base.asset.deleteMany({ where: { familyId } })
  await base.account.deleteMany({ where: { familyId } })
  await base.familySpace.deleteMany({ where: { id: familyId } })
  await base.$disconnect()
})

describe('流水写入幂等', () => {
  it('同键写入两次只落一条；不同键可以再落一条', async () => {
    const ctx = ctxOf(familyId)
    const data = depositData()
    const key = `web:test-${Date.now()}`
    const hash = requestHashOf(data)

    const first = await createTransactionRecord(base, ctx, data, { clientRequestId: key, clientRequestHash: hash })
    expect(first.id).toBeTruthy()

    const stored = await base.transaction.findUniqueOrThrow({ where: { id: first.id } })
    expect(stored.clientRequestId).toBe(key)
    expect(stored.clientRequestHash).toBe(hash)

    // 第二次同键写入必须被唯一约束拦下（Server Action 依赖该约束处理并发重放）
    let code: string | undefined
    try {
      await createTransactionRecord(base, ctx, data, { clientRequestId: key, clientRequestHash: hash })
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe('P2002')

    const rows = await base.transaction.findMany({ where: { familyId, clientRequestId: key } })
    expect(rows).toHaveLength(1)

    const other = await createTransactionRecord(base, ctx, depositData(), {
      clientRequestId: `${key}-2`,
      clientRequestHash: hash,
    })
    expect(other.id).not.toBe(first.id)
    expect(await base.transaction.count({ where: { familyId } })).toBe(2)
  })

  it('不带幂等键的写入不受约束（历史行为保持）', async () => {
    const before = await base.transaction.count({ where: { familyId } })
    await createTransactionRecord(base, ctxOf(familyId), depositData())
    await createTransactionRecord(base, ctxOf(familyId), depositData())
    expect(await base.transaction.count({ where: { familyId } })).toBe(before + 2)
  })
})
