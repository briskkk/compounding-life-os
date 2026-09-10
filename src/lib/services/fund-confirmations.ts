import type { PrismaClient } from '@prisma/client'
import { auditedTransaction, recordAudit } from '@/lib/audit'
import type { FamilyCtx } from '@/lib/scoped'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { estimateShares } from '@/lib/engine/fund-order'
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

export interface FundNavConfirmationPreview {
  id: string
  type: 'BUY' | 'SELL'
  assetName: string
  assetSymbol: string
  accountName: string
  navDate: string
  amount: number
  fee: number
  currentPrice: number
  currentQuantity: number
  officialNav: number
  calculatedQuantity: number
  source: string
}

/** 只读核对：取得成交日官方净值并计算应确认份额，不改写流水。 */
export async function previewFundOfficialNavRecord(
  db: PrismaClient,
  ctx: FamilyCtx,
  id: string,
): Promise<FundNavConfirmationPreview> {
  const original = await db.transaction.findFirst({
    where: { id, familyId: ctx.familyId, voidedAt: null },
    include: { asset: true, account: true },
  })
  if (!original?.navDate || original.asset.cls !== 'FUND'
    || (original.type !== 'BUY' && original.type !== 'SELL')
    || (original.navSource !== 'ESTIMATE' && original.navSource !== 'PENDING')) {
    throw new Error('该流水没有待确认的基金净值或份额')
  }
  const navDate = dateKeyAt(original.navDate)
  const quote = await fundNavQuoteOnDate(db, original.asset.symbol, navDate)
  if (!quote || quote.source !== 'EASTMONEY-FUND' || quote.kind !== 'OFFICIAL_NAV') {
    throw new Error('该成交日官方净值尚未取得，请刷新行情后重试')
  }
  const currentQuantity = Number(original.quantity ?? 0)
  return {
    id: original.id,
    type: original.type,
    assetName: original.asset.name,
    assetSymbol: original.asset.symbol,
    accountName: original.account.name,
    navDate,
    amount: Number(original.amount),
    fee: Number(original.fee),
    currentPrice: Number(original.price ?? 0),
    currentQuantity,
    officialNav: quote.price,
    calculatedQuantity: original.type === 'BUY'
      ? estimateShares(Number(original.amount), quote.price)
      : currentQuantity,
    source: quote.source,
  }
}

/** Web action 与 App REST 共用的官方净值确认闭环。 */
export async function confirmFundOfficialNavRecord(
  db: PrismaClient,
  ctx: FamilyCtx,
  id: string,
  confirmedQuantity?: number,
): Promise<FundNavConfirmationResult> {
  const preview = await previewFundOfficialNavRecord(db, ctx, id)
  if (confirmedQuantity != null) {
    if (!Number.isFinite(confirmedQuantity) || confirmedQuantity <= 0) {
      throw new Error('平台确认份额必须为正数')
    }
    const normalized = Math.round(confirmedQuantity * 100) / 100
    if (Math.abs(normalized - preview.calculatedQuantity) > 0.005) {
      throw new Error(`平台份额与账本推算不一致：平台 ${normalized.toFixed(2)} 份，账本 ${preview.calculatedQuantity.toFixed(2)} 份`)
    }
  }
  const corrected = await auditedTransaction(db, ctx.familyId, (txDb) =>
    correctEstimatedFundTransactionRecord(txDb, ctx, id, preview.officialNav),
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
