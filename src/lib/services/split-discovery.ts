import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import type { FamilyCtx } from '@/lib/scoped'
import { foldTransactions, roundMoney } from '@/lib/engine/ledger'
import { fetchSplitEvents, splitEventSchema, type SplitEvent } from '@/lib/market/split-events'
import { createCorporateActionRecord } from './corporate-actions'
import type { ServiceDb } from './transactions'

const scanSchema = z.object({ events: z.array(splitEventSchema), errors: z.array(z.string()), unsupported: z.array(z.string()) })
export const splitConfirmationSchema = z.object({
  accountId: z.string().min(1), assetId: z.string().min(1),
  recordDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receivedQuantity: z.number().positive().finite(),
  sourceReference: z.string().url().max(500).refine(s => /^https?:\/\//.test(s)),
})
export type SplitConfirmation = z.infer<typeof splitConfirmationSchema>
const dayEnd = (date: string) => new Date(`${date}T15:59:59.999Z`)
const keyOf = (accountId: string, assetId: string, recordDate: string) => `split:${accountId}:${assetId}:${recordDate}`

export async function latestSplitScan(db: ServiceDb, familyId: string) {
  const log = await db.auditLog.findFirst({ where: { familyId, action: 'SPLIT_SCAN', entity: 'CorporateAction' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const parsed = log?.detail ? scanSchema.safeParse(JSON.parse(log.detail)) : null
  return { checkedAt: log?.createdAt.toISOString() ?? null, ...(parsed?.success ? parsed.data : { events: [], errors: [], unsupported: [] }) }
}

export async function scanSplitEvents(db: PrismaClient, ctx: FamilyCtx, fetcher = fetchSplitEvents) {
  if (ctx.role === 'VIEWER') throw new Error('只读成员不能执行检查')
  const assets = await db.asset.findMany({ where: { familyId: ctx.familyId, cls: { in: ['ETF', 'FUND', 'STOCK'] }, transactions: { some: { voidedAt: null, type: { not: 'REVERSAL' } } } } })
  const events: SplitEvent[] = []
  const errors: string[] = []
  const unsupported: string[] = []
  // 串行检查，避免公开页面对批量并发请求限流；失败不升级为“无事件”。
  for (let i = 0; i < assets.length; i++) {
    await Promise.all(assets.slice(i, i + 1).map(async asset => {
      if (!['ETF', 'FUND'].includes(asset.cls) || !/^\d{6}$/.test(asset.symbol)) { unsupported.push(asset.symbol); return }
      try { events.push(...(await fetcher(asset.symbol)).map(e => splitEventSchema.parse(e))) }
      catch (error) { errors.push(`${asset.symbol}：${error instanceof Error ? error.message : String(error)}`) }
    }))
  }
  await recordAudit(db, { familyId: ctx.familyId, actorId: ctx.memberId, actorName: ctx.memberName, action: 'SPLIT_SCAN', entity: 'CorporateAction', detail: JSON.stringify({ events, errors, unsupported }) })
  return { events, errors, unsupported }
}

/** 原始登记日份额：先截断流水，避免历史图表的前复权份额换算污染权益计算。 */
export async function entitlementPosition(db: ServiceDb, familyId: string, accountId: string, assetId: string, recordDate: string) {
  const rows = await db.transaction.findMany({ where: { familyId, accountId, assetId, occurredAt: { lte: dayEnd(recordDate) } }, include: { asset: true } })
  return foldTransactions(rows.map(t => ({ ...t, assetClass: t.asset.cls, quantity: t.quantity == null ? null : Number(t.quantity), price: t.price == null ? null : Number(t.price), amount: Number(t.amount), fee: Number(t.fee) })))[0]
}

export async function splitCandidates(db: ServiceDb, familyId: string) {
  const scan = await latestSplitScan(db, familyId)
  const candidates = []
  for (const event of scan.events) {
    const asset = await db.asset.findFirst({ where: { familyId, symbol: event.symbol } })
    if (!asset) continue
    const accounts = await db.account.findMany({ where: { familyId, transactions: { some: { assetId: asset.id, voidedAt: null } } } })
    for (const account of accounts) {
      const recorded = await db.transaction.findFirst({ where: { familyId, clientRequestId: keyOf(account.id, asset.id, event.recordDate) } })
      if (recorded) continue // 冲正后不自动重放，必须重新人工核对。
      const position = await entitlementPosition(db, familyId, account.id, asset.id, event.recordDate)
      if (!position || position.quantity <= 0) continue
      candidates.push({ ...event, accountId: account.id, accountName: account.name, assetId: asset.id, assetName: asset.name, assetClass: asset.cls, before: position.quantity, after: roundMoney(position.quantity * event.ratio) })
    }
  }
  return { ...scan, candidates }
}

/** 调用方在 auditedTransaction 内执行；唯一请求键封住重复提交和并发重复入账。 */
export async function confirmSplitRecord(db: ServiceDb, ctx: FamilyCtx, raw: SplitConfirmation) {
  if (ctx.role === 'VIEWER') throw new Error('只读成员不能入账')
  const data = splitConfirmationSchema.parse(raw)
  const key = keyOf(data.accountId, data.assetId, data.recordDate)
  const requestHash = createHash('sha256').update(JSON.stringify(data)).digest('hex')
  const existing = await db.transaction.findFirst({ where: { familyId: ctx.familyId, clientRequestId: key } })
  if (existing) {
    if (existing.voidedAt) throw new Error('事件已冲正，请人工核对，不能自动重放')
    if (existing.clientRequestHash !== requestHash) throw new Error('同一事件核对内容发生变化，请先核对原事件')
    return { id: existing.corporateActionId!, duplicate: true }
  }
  const candidate = (await splitCandidates(db, ctx.familyId)).candidates.find(c => c.assetId === data.assetId && c.accountId === data.accountId && c.recordDate === data.recordDate)
  if (!candidate) throw new Error('没有当前家庭可核对的拆分事件，请先检查公告')
  const effectiveAt = new Date(`${data.effectiveDate}T00:00:00Z`)
  if (!Number.isFinite(effectiveAt.getTime()) || effectiveAt.toISOString().slice(0,10) !== data.effectiveDate || data.effectiveDate <= data.recordDate || effectiveAt > new Date()) throw new Error('除权日必须晚于登记日，且不能晚于今天')
  if (Math.abs(data.receivedQuantity - (candidate.after - candidate.before)) > 1e-6) throw new Error('券商新增份额与拆分比例不符，不能自动入账')
  const between = await db.transaction.count({ where: { familyId: ctx.familyId, accountId: data.accountId, assetId: data.assetId, voidedAt: null, occurredAt: { gt: dayEnd(data.recordDate), lt: effectiveAt }, type: { not: 'REVERSAL' } } })
  if (between) throw new Error('登记日与除权日之间存在交易，需要人工核对权益')
  const manual = await db.corporateAction.findFirst({ where: { familyId: ctx.familyId, accountId: data.accountId, assetId: data.assetId, reversedAt: null, type: { in: ['SPLIT', 'REVERSE_SPLIT', 'STOCK_DIVIDEND'] }, effectiveAt: { gte: new Date(`${data.recordDate}T00:00:00Z`), lte: dayEnd(data.effectiveDate) } } })
  if (manual) throw new Error('该日期范围已有份额事件，请核对，避免重复调整')
  const created = await createCorporateActionRecord(db, ctx, { type: candidate.ratio > 1 ? 'SPLIT' : 'REVERSE_SPLIT', accountId: data.accountId, assetId: data.assetId, effectiveAt, ratioNumerator: candidate.ratio, ratioDenominator: 1, cashAmount: 0, fee: 0, sourceName: '官方公告与券商份额核对', sourceReference: data.sourceReference, note: `登记日 ${data.recordDate}；除权日 ${data.effectiveDate}；确认新增 ${data.receivedQuantity} 份；线索 ${candidate.sourceReference}` })
  await db.transaction.updateMany({ where: { familyId: ctx.familyId, corporateActionId: created.id, type: 'SHARE_ADJUSTMENT' }, data: { clientRequestId: key, clientRequestHash: requestHash } })
  return { id: created.id, duplicate: false }
}
