import type { Prisma, PrismaClient } from '@prisma/client'
import { recordAudit } from '@/lib/audit'
import { foldTransactions, roundMoney, type LedgerTx } from '@/lib/engine/ledger'
import { fundConfirmationDate, isQdiiFund } from '@/lib/engine/fund-order'
import type { FamilyCtx } from '@/lib/scoped'
import type { CorporateActionInputData } from '@/lib/schemas'
import { assertTransactionTimeline } from '@/lib/transaction-rules'
import { createTransactionRecord, reverseTransactionRecord, type ServiceDb } from './transactions'

const EPSILON = 1e-8

function endOfToday(): Date {
  const value = new Date()
  value.setHours(23, 59, 59, 999)
  return value
}

async function positionAt(
  db: ServiceDb,
  familyId: string,
  accountId: string,
  assetId: string,
  at: Date,
) {
  const asset = await db.asset.findFirst({ where: { id: assetId, familyId } })
  if (!asset) throw new Error('资产不存在或不属于当前家庭')
  const rows = await db.transaction.findMany({
    where: { familyId, accountId, assetId },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  const qdii = asset.cls === 'FUND' && isQdiiFund(asset.symbol, asset.name)
  const ledger: LedgerTx[] = rows.map((tx) => ({
    id: tx.id,
    accountId: tx.accountId,
    assetId: tx.assetId,
    type: tx.type,
    quantity: tx.quantity == null ? null : Number(tx.quantity),
    price: tx.price == null ? null : Number(tx.price),
    amount: Number(tx.amount),
    fee: Number(tx.fee),
    occurredAt: tx.occurredAt,
    navDate: tx.navDate,
    confirmationDate: tx.navDate && asset.cls === 'FUND'
      ? fundConfirmationDate(tx.navDate, { qdii })
      : tx.navDate,
    internal: tx.internal,
    voidedAt: tx.voidedAt,
    assetClass: asset.cls,
    currency: asset.currency,
  }))
  return {
    asset,
    position: foldTransactions(ledger, at)[0] ?? null,
  }
}

async function assertTimeline(db: ServiceDb, familyId: string, accountId: string, assetId: string) {
  const asset = await db.asset.findFirst({ where: { id: assetId, familyId } })
  if (!asset) throw new Error('资产不存在或不属于当前家庭')
  const qdii = asset.cls === 'FUND' && isQdiiFund(asset.symbol, asset.name)
  const rows = await db.transaction.findMany({
    where: { familyId, accountId, assetId },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  assertTransactionTimeline(rows.map((tx, sequence) => ({
    type: tx.type,
    quantity: tx.quantity == null ? null : Number(tx.quantity),
    occurredAt: tx.occurredAt,
    navDate: tx.navDate,
    confirmationDate: tx.navDate && asset.cls === 'FUND'
      ? fundConfirmationDate(tx.navDate, { qdii })
      : tx.navDate,
    voidedAt: tx.voidedAt,
    sequence,
  })), asset)
}

function actionNote(data: CorporateActionInputData, suffix: string): string {
  return [suffix, data.sourceName, data.note].filter(Boolean).join(' · ').slice(0, 500)
}

/**
 * 创建公司行动证据包，并把实际影响展开为可重放的 Transaction。
 * CorporateAction 本身不参与估值或持仓计算。
 */
export async function createCorporateActionRecord(
  db: ServiceDb,
  ctx: FamilyCtx,
  data: CorporateActionInputData,
): Promise<{ id: string; affectedSince: Date }> {
  if (data.effectiveAt.getTime() > endOfToday().getTime()) throw new Error('公司行动生效日不能晚于今天')
  const [sourceAccount, sourceState, targetAccount, targetAsset] = await Promise.all([
    db.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } }),
    positionAt(db, ctx.familyId, data.accountId, data.assetId, data.effectiveAt),
    data.targetAccountId
      ? db.account.findFirst({ where: { id: data.targetAccountId, familyId: ctx.familyId } })
      : null,
    data.targetAssetId
      ? db.asset.findFirst({ where: { id: data.targetAssetId, familyId: ctx.familyId } })
      : null,
  ])
  if (!sourceAccount) throw new Error('来源账户不存在或不属于当前家庭')
  if (!['STOCK', 'ETF', 'FUND', 'HUAWEI_STOCK'].includes(sourceState.asset.cls)) {
    throw new Error('公司行动仅适用于股票、ETF、基金和长期股权资产')
  }
  if (sourceAccount.currency !== sourceState.asset.currency) throw new Error('来源账户与资产币种不一致')
  if (data.targetAccountId && !targetAccount) throw new Error('目标账户不存在或不属于当前家庭')
  if (data.targetAssetId && !targetAsset) throw new Error('目标资产不存在或不属于当前家庭')

  const before = sourceState.position?.quantity ?? 0
  const costBefore = sourceState.position?.costBasis ?? 0
  if (before <= EPSILON && !['RIGHTS_ISSUE', 'CASH_DISTRIBUTION'].includes(data.type)) {
    throw new Error('生效日没有可处理的来源持仓')
  }
  const ratio = data.ratioNumerator && data.ratioDenominator
    ? data.ratioNumerator / data.ratioDenominator
    : 1
  const quantityAfter = (() => {
    if (['SPLIT', 'REVERSE_SPLIT', 'STOCK_DIVIDEND'].includes(data.type)) return roundMoney(before * ratio)
    if (['SYMBOL_CHANGE', 'MERGER_EXCHANGE'].includes(data.type)) return roundMoney(before * ratio)
    if (data.type === 'RIGHTS_ISSUE' || data.type === 'FUND_REINVESTMENT') return roundMoney(before + (data.quantity ?? 0))
    return before
  })()

  if (['SYMBOL_CHANGE', 'MERGER_EXCHANGE', 'SPINOFF'].includes(data.type)) {
    if (!targetAsset) throw new Error('缺少目标资产')
    if (targetAsset.id === sourceState.asset.id) throw new Error('目标资产必须与来源资产不同')
    if (targetAsset.currency !== sourceState.asset.currency) throw new Error('跨币种换股暂不支持，请拆分为可核对的独立事件')
  }
  if (data.type === 'CUSTODY_TRANSFER') {
    if (!targetAccount || targetAccount.id === sourceAccount.id) throw new Error('请选择不同的转入账户')
    if (targetAccount.currency !== sourceAccount.currency) throw new Error('转托管账户币种必须一致')
  }
  if (data.type === 'FUND_REINVESTMENT' && sourceState.asset.cls !== 'FUND') {
    throw new Error('红利再投仅适用于场外基金')
  }

  const action = await db.corporateAction.create({
    data: {
      familyId: ctx.familyId,
      accountId: sourceAccount.id,
      targetAccountId: targetAccount?.id ?? null,
      assetId: sourceState.asset.id,
      targetAssetId: targetAsset?.id ?? null,
      type: data.type,
      effectiveAt: data.effectiveAt,
      ratioNumerator: data.ratioNumerator ?? null,
      ratioDenominator: data.ratioDenominator ?? null,
      quantityBefore: before,
      quantityAfter,
      cashAmount: data.cashAmount,
      fee: data.fee,
      costAllocation: data.costAllocation ?? null,
      sourceName: data.sourceName,
      sourceReference: data.sourceReference ?? null,
      note: data.note ?? null,
      createdBy: ctx.memberId,
    },
  })

  const createInternal = async (entry: {
    accountId: string
    assetId: string
    type: 'SHARE_ADJUSTMENT' | 'COST_ADJUSTMENT'
    quantity?: number | null
    price?: number | null
    amount?: number
    note: string
  }) => db.transaction.create({
    data: {
      familyId: ctx.familyId,
      accountId: entry.accountId,
      assetId: entry.assetId,
      type: entry.type,
      quantity: entry.quantity ?? null,
      price: entry.price ?? null,
      amount: entry.amount ?? 0,
      fee: 0,
      occurredAt: data.effectiveAt,
      note: entry.note,
      internal: true,
      corporateActionId: action.id,
    },
  })

  if (['SPLIT', 'REVERSE_SPLIT', 'STOCK_DIVIDEND'].includes(data.type)) {
    const delta = roundMoney(quantityAfter - before)
    if (Math.abs(delta) <= EPSILON) throw new Error('转换比例没有产生份额变化')
    await createInternal({
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'SHARE_ADJUSTMENT',
      quantity: delta,
      price: ratio,
      note: actionNote(data, `${before} → ${quantityAfter} 份`),
    })
    await assertTimeline(db, ctx.familyId, sourceAccount.id, sourceState.asset.id)
  }

  if (data.type === 'CUSTODY_TRANSFER') {
    await createTransactionRecord(db, ctx, {
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'TRANSFER_OUT',
      quantity: before,
      price: null,
      amount: costBefore,
      fee: 0,
      occurredAt: data.effectiveAt,
      note: actionNote(data, `转托管至 ${targetAccount!.name}`),
      settleCash: false,
    }, { corporateActionId: action.id })
    await createTransactionRecord(db, ctx, {
      accountId: targetAccount!.id,
      assetId: sourceState.asset.id,
      type: 'TRANSFER_IN',
      quantity: before,
      price: null,
      amount: costBefore,
      fee: 0,
      occurredAt: data.effectiveAt,
      note: actionNote(data, `由 ${sourceAccount.name} 转入`),
      settleCash: false,
    }, { corporateActionId: action.id })
  }

  if (['SYMBOL_CHANGE', 'MERGER_EXCHANGE'].includes(data.type)) {
    const targetAccountId = targetAccount?.id ?? sourceAccount.id
    await createTransactionRecord(db, ctx, {
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'TRANSFER_OUT',
      quantity: before,
      price: null,
      amount: costBefore,
      fee: 0,
      occurredAt: data.effectiveAt,
      note: actionNote(data, `转为 ${targetAsset!.symbol}`),
      settleCash: false,
    }, { corporateActionId: action.id })
    await createTransactionRecord(db, ctx, {
      accountId: targetAccountId,
      assetId: targetAsset!.id,
      type: 'TRANSFER_IN',
      quantity: quantityAfter,
      price: null,
      amount: costBefore,
      fee: 0,
      occurredAt: data.effectiveAt,
      note: actionNote(data, `承接 ${sourceState.asset.symbol} 成本`),
      settleCash: false,
    }, { corporateActionId: action.id })
  }

  if (data.type === 'SPINOFF') {
    const allocatedCost = roundMoney(costBefore * (data.costAllocation ?? 0))
    const targetQuantity = roundMoney(before * ratio)
    await createInternal({
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'COST_ADJUSTMENT',
      amount: -allocatedCost,
      note: actionNote(data, `成本转出 ${allocatedCost}`),
    })
    await createTransactionRecord(db, ctx, {
      accountId: targetAccount?.id ?? sourceAccount.id,
      assetId: targetAsset!.id,
      type: 'TRANSFER_IN',
      quantity: targetQuantity,
      price: null,
      amount: allocatedCost,
      fee: 0,
      occurredAt: data.effectiveAt,
      note: actionNote(data, `由 ${sourceState.asset.symbol} 分拆`),
      settleCash: false,
    }, { corporateActionId: action.id })
  }

  if (data.type === 'RIGHTS_ISSUE') {
    const amount = roundMoney((data.quantity ?? 0) * (data.price ?? 0))
    await createTransactionRecord(db, ctx, {
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'BUY',
      quantity: data.quantity ?? null,
      price: data.price ?? null,
      amount,
      fee: data.fee,
      occurredAt: data.effectiveAt,
      note: actionNote(data, '配股入账'),
      settleCash: true,
    }, { corporateActionId: action.id })
  }

  if (data.type === 'CASH_DISTRIBUTION') {
    await createTransactionRecord(db, ctx, {
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'DIVIDEND',
      quantity: null,
      price: null,
      amount: data.cashAmount,
      fee: data.fee,
      occurredAt: data.effectiveAt,
      note: actionNote(data, '现金分配'),
      settleCash: true,
    }, { corporateActionId: action.id })
  }

  if (data.type === 'FUND_REINVESTMENT') {
    await createTransactionRecord(db, ctx, {
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'DIVIDEND',
      quantity: null,
      price: null,
      amount: data.cashAmount,
      fee: data.fee,
      occurredAt: data.effectiveAt,
      note: actionNote(data, '红利再投 · 分红确认'),
      settleCash: true,
    }, { corporateActionId: action.id })
    await createTransactionRecord(db, ctx, {
      accountId: sourceAccount.id,
      assetId: sourceState.asset.id,
      type: 'BUY',
      quantity: data.quantity ?? null,
      price: data.price ?? null,
      amount: roundMoney((data.quantity ?? 0) * (data.price ?? 0)),
      fee: 0,
      occurredAt: data.effectiveAt,
      navDate: data.effectiveAt,
      navSource: 'OFFICIAL',
      note: actionNote(data, '红利再投 · 份额确认'),
      settleCash: true,
    }, { corporateActionId: action.id, allowSuspendedFundPurchase: true })
  }

  await recordAudit(db, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'CREATE',
    entity: 'CorporateAction',
    entityId: action.id,
    detail: JSON.stringify({
      version: 1,
      type: data.type,
      asset: sourceState.asset.symbol,
      targetAsset: targetAsset?.symbol ?? null,
      effectiveAt: data.effectiveAt.toISOString(),
      quantityBefore: before,
      quantityAfter,
      sourceName: data.sourceName,
    }),
  })
  return { id: action.id, affectedSince: data.effectiveAt }
}

export async function reverseCorporateActionRecord(
  db: PrismaClient | Prisma.TransactionClient,
  ctx: FamilyCtx,
  id: string,
): Promise<{ affectedSince: Date }> {
  const action = await db.corporateAction.findFirst({
    where: { id, familyId: ctx.familyId },
    include: { transactions: { orderBy: { createdAt: 'asc' } } },
  })
  if (!action) throw new Error('公司行动不存在')
  if (action.reversedAt) throw new Error('该公司行动已冲正')
  const primaries = action.transactions.filter((tx) => !tx.voidedAt && !tx.settleOfId && tx.type !== 'REVERSAL')
  for (const tx of primaries) await reverseTransactionRecord(db, ctx, tx.id)
  await db.corporateAction.updateMany({
    where: { id, familyId: ctx.familyId, reversedAt: null },
    data: { reversedAt: new Date() },
  })
  await recordAudit(db, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'REVERSE',
    entity: 'CorporateAction',
    entityId: id,
    detail: `${action.type} · ${primaries.length} 条账本流水已冲正`,
  })
  return { affectedSince: action.effectiveAt }
}
