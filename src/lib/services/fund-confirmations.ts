import type { PrismaClient } from '@prisma/client'
import { auditedTransaction, recordAudit } from '@/lib/audit'
import type { FamilyCtx } from '@/lib/scoped'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { fundNavQuoteOnDate } from '@/lib/market/fund-nav'
import { correctEstimatedFundTransactionRecord, rebuildSnapshotsForFamily } from './transactions'

export interface FundNavConfirmationResult {
  id: string
  oldPrice: number
  newPrice: number
  oldQuantity: number
  newQuantity: number
  warning?: string
}

/** Web action 与 App REST 共用的官方净值确认闭环。 */
export async function confirmFundOfficialNavRecord(
  db: PrismaClient,
  ctx: FamilyCtx,
  id: string,
): Promise<FundNavConfirmationResult> {
  const original = await db.transaction.findFirst({
    where: { id, familyId: ctx.familyId, voidedAt: null },
    include: { asset: true },
  })
  if (!original?.navDate || original.asset.cls !== 'FUND'
    || (original.navSource !== 'ESTIMATE' && original.navSource !== 'PENDING')) {
    throw new Error('该流水没有待确认的基金净值或份额')
  }
  const quote = await fundNavQuoteOnDate(db, original.asset.symbol, dateKeyAt(original.navDate))
  if (!quote || quote.source !== 'EASTMONEY-FUND' || quote.kind !== 'OFFICIAL_NAV') {
    throw new Error('该成交日官方净值尚未取得，请刷新行情后重试')
  }
  const corrected = await auditedTransaction(db, ctx.familyId, (txDb) =>
    correctEstimatedFundTransactionRecord(txDb, ctx, id, quote.price),
  )
  const warning = await rebuildSnapshotsForFamily(db, ctx.familyId, corrected.affectedSince)
  return { ...corrected, warning }
}

/** 到账确认只追加审计证据，不修改预计结算腿或账户余额。 */
export async function confirmFundSettlementRecord(
  db: PrismaClient,
  ctx: FamilyCtx,
  id: string,
): Promise<{ replayed: boolean }> {
  const original = await db.transaction.findFirst({
    where: {
      id,
      familyId: ctx.familyId,
      type: 'SELL',
      internal: false,
      voidedAt: null,
      settlementDate: { not: null },
      asset: { cls: 'FUND' },
    },
    include: { asset: true, account: true },
  })
  if (!original?.settlementDate) throw new Error('该流水没有可确认的基金到账事件')
  if (dateKeyAt(original.settlementDate) > dateKeyAt(new Date())) {
    throw new Error('预计到账日尚未到达，暂不能确认')
  }
  const existing = await db.auditLog.findFirst({
    where: {
      familyId: ctx.familyId,
      action: 'FUND_SETTLEMENT_CONFIRMED',
      entity: 'Transaction',
      entityId: id,
    },
  })
  if (existing) return { replayed: true }
  const settlementLeg = await db.transaction.findFirst({
    where: { familyId: ctx.familyId, settleOfId: id, voidedAt: null },
  })
  await recordAudit(db, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'FUND_SETTLEMENT_CONFIRMED',
    entity: 'Transaction',
    entityId: id,
    detail: JSON.stringify({
      version: 1,
      assetName: original.asset.name,
      accountName: original.account.name,
      settlementDate: dateKeyAt(original.settlementDate),
      expectedAmount: settlementLeg ? Number(settlementLeg.amount) : Number(original.amount) - Number(original.fee),
    }),
  })
  return { replayed: false }
}
