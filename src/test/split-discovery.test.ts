import { afterAll, beforeAll, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { parseSplitEvents } from '@/lib/market/split-events'
import { scanSplitEvents, confirmSplitRecord, entitlementPosition, splitCandidates } from '@/lib/services/split-discovery'
import { auditedTransaction } from '@/lib/audit'
import type { FamilyCtx } from '@/lib/scoped'
import { applyConfirmedSplit } from '@/lib/services/split-apply'

const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })
let ctx: FamilyCtx
let accountId: string
let assetId: string
const html = '<table><tr><th>拆分折算日</th></tr><tr><td>2026年</td><td>2026-01-09</td><td>份额分拆</td><td>1:2.0000</td></tr></table>'
const input = () => ({ accountId, assetId, recordDate: '2026-01-09', effectiveDate: '2026-01-12', receivedQuantity: 100, sourceReference: 'https://example.com/official.pdf' })

beforeAll(async () => {
  const family = await db.familySpace.create({ data: { name: '拆分发现测试' } })
  ctx = { familyId: family.id, memberId: 'split-owner', memberName: '测试', userId: '', role: 'OWNER' }
  accountId = (await db.account.create({ data: { familyId: family.id, name: '证券', currency: 'CNY' } })).id
  assetId = (await db.asset.create({ data: { familyId: family.id, symbol: '159560', name: '芯片', cls: 'ETF', currency: 'CNY' } })).id
  await db.transaction.create({ data: { familyId: family.id, accountId, assetId, type: 'BUY', quantity: 100, price: 2, amount: 200, occurredAt: new Date('2026-01-08T04:00:00Z') } })
  // 除权日盘中新买入不能参加登记日拆分。
  await db.transaction.create({ data: { familyId: family.id, accountId, assetId, type: 'BUY', quantity: 20, price: 1, amount: 20, occurredAt: new Date('2026-01-12T00:00:00Z') } })
})
afterAll(async () => db.$disconnect())

it('提取折算日与比例；格式损坏不能伪装为无事件', () => {
  expect(parseSplitEvents('159560', html)[0]).toMatchObject({ recordDate: '2026-01-09', ratio: 2 })
  expect(() => parseSplitEvents('159560', '<html>error</html>')).toThrow()
  expect(() => parseSplitEvents('159560', html.replace('1:2.0000','unknown'))).toThrow()
})

it('发现不写交易，失败保留错误证据，VIEWER 禁止扫描', async () => {
  await expect(scanSplitEvents(db, { ...ctx, role: 'VIEWER' })).rejects.toThrow('只读')
  const failed = await scanSplitEvents(db, ctx, async () => { throw new Error('offline') })
  expect(failed.errors).toHaveLength(1)
  await scanSplitEvents(db, ctx, async symbol => parseSplitEvents(symbol, html))
  expect(await db.transaction.count({ where: { familyId: ctx.familyId } })).toBe(2)
  expect((await splitCandidates(db, ctx.familyId)).candidates[0].after).toBe(200)
})

it('差额、越权、无效除权日都不入账', async () => {
  await expect(auditedTransaction(db, ctx.familyId, tx => confirmSplitRecord(tx, ctx, { ...input(), receivedQuantity: 99 }))).rejects.toThrow('不符')
  await expect(auditedTransaction(db, ctx.familyId, tx => confirmSplitRecord(tx, { ...ctx, familyId: 'other' }, input()))).rejects.toThrow('当前家庭')
  await expect(auditedTransaction(db, ctx.familyId, tx => confirmSplitRecord(tx, { ...ctx, role: 'VIEWER' }, input()))).rejects.toThrow('只读')
  await expect(auditedTransaction(db, ctx.familyId, tx => confirmSplitRecord(tx, ctx, { ...input(), effectiveDate: '2026-01-09' }))).rejects.toThrow('除权日')
})

it('行情失败或覆盖不完整时不调整份额', async () => {
  await expect(applyConfirmedSplit(db, ctx, input(), async () => ({ status: 'FAILED', source: 'NONE', bars: [], errors: [] }))).rejects.toThrow('历史行情未就绪')
  await expect(applyConfirmedSplit(db, ctx, input(), async () => ({ status: 'OK', source: 'TENCENT', bars: [{ date: new Date('2026-01-12'), close: 1 }], errors: [] }))).rejects.toThrow('覆盖不足')
  expect(await db.transaction.count({ where: { familyId: ctx.familyId, type: 'SHARE_ADJUSTMENT' } })).toBe(0)
})

it('仅拆登记日100份，总成本不变；并发重放只追加一次', async () => {
  const results = await Promise.all([1,2].map(() => auditedTransaction(db, ctx.familyId, tx => confirmSplitRecord(tx, ctx, input()))))
  expect(results[0].id).toBe(results[1].id)
  expect(results.filter(r => r.duplicate)).toHaveLength(1)
  const position = await entitlementPosition(db, ctx.familyId, accountId, assetId, '2026-01-13')
  expect(position?.quantity).toBe(220)
  expect(position?.costBasis).toBe(220)
  expect(await db.transaction.count({ where: { familyId: ctx.familyId, type: 'SHARE_ADJUSTMENT' } })).toBe(1)
  expect(await db.transaction.count({ where: { familyId: ctx.familyId, type: { in: ['DEPOSIT','WITHDRAW'] } } })).toBe(0)
  expect((await splitCandidates(db, ctx.familyId)).candidates).toHaveLength(0)
  await expect(auditedTransaction(db, ctx.familyId, tx => confirmSplitRecord(tx, ctx, { ...input(), receivedQuantity: 101 }))).rejects.toThrow('发生变化')
})
