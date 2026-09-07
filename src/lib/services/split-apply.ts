import type { PrismaClient } from '@prisma/client'
import { auditedTransaction } from '@/lib/audit'
import type { FamilyCtx } from '@/lib/scoped'
import { historySmart } from '@/lib/market'
import { confirmSplitRecord, splitConfirmationSchema, type SplitConfirmation } from './split-discovery'
import { rebuildSnapshotsForFamily } from './transactions'

/** 拆分改变全部前复权历史：完整拉取后与份额事件原子提交，失败不留下半次调整。 */
export async function applyConfirmedSplit(db: PrismaClient, ctx: FamilyCtx, input: SplitConfirmation, history = historySmart) {
  if (ctx.role === 'VIEWER') throw new Error('只读成员不能入账')
  const data = splitConfirmationSchema.parse(input)
  const priorRequest = await db.transaction.findFirst({ where: { familyId: ctx.familyId, clientRequestId: `split:${data.accountId}:${data.assetId}:${data.recordDate}` } })
  if (priorRequest) {
    const result = await auditedTransaction(db, ctx.familyId, tx => confirmSplitRecord(tx, ctx, data))
    return { ...result, warning: await rebuildSnapshotsForFamily(db, ctx.familyId) }
  }
  const asset = await db.asset.findFirstOrThrow({ where: { familyId: ctx.familyId, id: data.assetId } })
  if (asset.cls !== 'ETF') throw new Error('当前自动核对入账仅支持境内 ETF；场外基金请走人工公司行动')
  const earliest = await db.transaction.findFirst({ where: { assetId: asset.id, familyId: ctx.familyId, voidedAt: null }, orderBy: { occurredAt: 'asc' } })
  if (!earliest) throw new Error('没有持仓流水')
  const firstPrice = await db.priceBar.findFirst({ where: { symbol: asset.symbol }, orderBy: { date: 'asc' } })
  const from = new Date(Math.min(earliest.occurredAt.getTime() - 10 * 86400000, firstPrice?.date.getTime() ?? Infinity))
  const result = await history(asset.symbol, from, new Date(), { route: 'EXCHANGE' })
  if (result.status === 'FAILED' || !['TENCENT', 'EASTMONEY-KLINE'].includes(result.source)) throw new Error('完整前复权历史行情未就绪，尚未入账')
  const bars = result.bars.slice().sort((a,b) => a.date.getTime()-b.date.getTime())
  const prior = await db.priceBar.findMany({ where: { symbol: asset.symbol, date: { gte: from } }, select: { date: true } })
  const days = new Set(bars.map(b => b.date.toISOString().slice(0,10)))
  if (!bars.length || bars[0].date > earliest.occurredAt || bars.at(-1)!.date < new Date(data.effectiveDate) || prior.some(p => !days.has(p.date.toISOString().slice(0,10)))) throw new Error('前复权历史覆盖不足，尚未入账')
  const created = await auditedTransaction(db, ctx.familyId, async tx => {
    const action = await confirmSplitRecord(tx, ctx, data)
    if (!action.duplicate) {
      await tx.priceBar.deleteMany({ where: { symbol: asset.symbol, date: { gte: from } } })
      await tx.priceBar.createMany({ data: bars.map(b => ({ symbol: asset.symbol, date: b.date, close: b.close, source: result.source })) })
    }
    return action
  }, { timeout: 30000 })
  // 全量重建：拆分日前的前复权价格和份额换算也变了。
  const warning = await rebuildSnapshotsForFamily(db, ctx.familyId)
  return { ...created, warning }
}
