// 共享事务写服务：流水创建 / 冲正的唯一写路径
// 供 Server Actions（src/lib/actions.ts）与移动端 API（src/app/api/transactions/route.ts）复用，
// 保证 Web 与 APP 走同一套校验、结算联动、审计与快照刷新口径。
import type { Prisma, PrismaClient } from '@prisma/client'
import { recordAudit } from '@/lib/audit'
import { rebuildSnapshots } from '@/lib/snapshots'
import type { FamilyCtx } from '@/lib/scoped'
import { buildSettlementLegs } from '@/lib/engine/settlement'
import { foldTransactions, roundMoney, type LedgerTx } from '@/lib/engine/ledger'
import { estimateShares, fundConfirmationDate, fundNavDate, isQdiiFund } from '@/lib/engine/fund-order'
import { isFundPurchaseSuspended } from '@/lib/engine/fund-policy'
import { assertTransactionRules, assertTransactionTimeline, type TransactionDraft } from '@/lib/transaction-rules'
import type { TxInputData } from '@/lib/schemas'

export type ServiceDb = PrismaClient | Prisma.TransactionClient

/** 解析交易账户显式配置的资金账户及其同币种现金资产。 */
export async function cashSettlementOf(
  db: ServiceDb,
  familyId: string,
  tradingAccountId: string,
): Promise<{ accountId: string; cashAssetId: string } | null> {
  const tradingAccount = await db.account.findFirst({ where: { id: tradingAccountId, familyId } })
  if (!tradingAccount?.settlementAccountId) return null
  const settlementAccount = await db.account.findFirst({
    where: { id: tradingAccount.settlementAccountId, familyId },
  })
  if (!settlementAccount) throw new Error('关联的资金账户不存在，请在账户页重新配置')
  if (settlementAccount.currency !== tradingAccount.currency) {
    throw new Error('交易账户与资金账户币种不一致')
  }
  const cashAsset = await db.asset.findFirst({
    where: { familyId, cls: 'CASH', currency: settlementAccount.currency },
  })
  if (!cashAsset) throw new Error(`缺少 ${settlementAccount.currency} 现金资产，请先在资产目录登记`)
  return { accountId: settlementAccount.id, cashAssetId: cashAsset.id }
}

/** 显式配置资金账户后，直接现金流水也统一归入该账户。 */
export async function routedAccountIdForAsset(
  db: ServiceDb,
  familyId: string,
  requestedAccountId: string,
  assetId: string,
): Promise<string> {
  const [account, asset] = await Promise.all([
    db.account.findFirst({ where: { id: requestedAccountId, familyId } }),
    db.asset.findFirst({ where: { id: assetId, familyId } }),
  ])
  if (!account) throw new Error('账户不存在或不属于当前家庭')
  if (!asset) throw new Error('资产不存在或不属于当前家庭')
  if (account.currency !== asset.currency) throw new Error('账户与资产币种不一致')
  if (asset.cls !== 'CASH' || !account.settlementAccountId || account.settlementAccountId === account.id) {
    return account.id
  }
  const target = await db.account.findFirst({
    where: { id: account.settlementAccountId, familyId, currency: account.currency },
  })
  if (!target) throw new Error('关联的资金账户不存在或币种不一致')
  return target.id
}

/** 归属校验 + 交易规则 + 时间线（Web 与 APP 同口径，单一实现） */
export async function validateTransaction(
  db: ServiceDb,
  ctx: FamilyCtx,
  data: {
    accountId: string
    assetId: string
    type: TransactionDraft['type']
    quantity: number | null
    price: number | null
    amount: number
    occurredAt: Date
    navDate?: Date | null
    navSource?: string | null
  },
  options?: { allowSuspendedFundPurchase?: boolean },
) {
  const [account, asset] = await Promise.all([
    db.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } }),
    db.asset.findFirst({ where: { id: data.assetId, familyId: ctx.familyId } }),
  ])
  if (!account) throw new Error('账户不存在或不属于当前家庭')
  if (!asset) throw new Error('资产不存在或不属于当前家庭')
  if (account.currency !== asset.currency) throw new Error('账户与资产币种不一致')
  if (data.navSource === 'PENDING') {
    if (asset.cls !== 'FUND' || data.type !== 'BUY' || data.quantity != null || data.price != null || !data.navDate) {
      throw new Error('只有场外基金申购可以先记录金额、后确认净值与份额')
    }
  }
  const qdii = asset.cls === 'FUND' && isQdiiFund(asset.symbol, asset.name)
  if (asset.cls === 'FUND' && data.type === 'BUY' && !options?.allowSuspendedFundPurchase) {
    const policy = await db.fundTradePolicy.findFirst({ where: { familyId: ctx.familyId, assetId: asset.id } })
    if (policy && isFundPurchaseSuspended(data.occurredAt, policy)) {
      throw new Error('该基金在所选日期暂停申购；请核对基金公告，或通过“分红再投资”事件记录自动获得的份额')
    }
  }

  const rows = await db.transaction.findMany({
    where: { familyId: ctx.familyId, accountId: data.accountId, assetId: data.assetId },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  const ledger: LedgerTx[] = rows.map((t) => ({
    accountId: t.accountId,
    assetId: t.assetId,
    type: t.type,
    quantity: t.quantity == null ? null : Number(t.quantity),
    price: t.price == null ? null : Number(t.price),
    amount: Number(t.amount),
    fee: Number(t.fee),
    occurredAt: t.occurredAt,
    navDate: t.navDate,
    confirmationDate: t.navDate && asset.cls === 'FUND'
      ? fundConfirmationDate(t.navDate, { qdii })
      : t.navDate,
    assetClass: asset.cls,
    internal: t.internal,
    voidedAt: t.voidedAt,
    currency: asset.currency,
  }))
  const position = foldTransactions(ledger)[0] ?? { quantity: 0, unvestedQty: 0, availableQty: 0 }
  assertTransactionRules(data, asset, position)
  // 基金买卖未显式传净值日时（CSV 导入 / 旧客户端），按 occurredAt 时刻兜底推算（15:00 前=当日净值）
  const effectiveNavDate = data.navDate ?? (asset.cls === 'FUND' && (data.type === 'BUY' || data.type === 'SELL')
    ? fundNavDate(data.occurredAt, { qdii })
    : null)
  const effectiveConfirmationDate = effectiveNavDate && asset.cls === 'FUND'
    ? fundConfirmationDate(effectiveNavDate, { qdii })
    : effectiveNavDate
  assertTransactionTimeline(
    [
      ...rows.map((t, sequence) => ({
        type: t.type,
        quantity: t.quantity == null ? null : Number(t.quantity),
        occurredAt: t.occurredAt,
        navDate: t.navDate,
        confirmationDate: t.navDate && asset.cls === 'FUND'
          ? fundConfirmationDate(t.navDate, { qdii })
          : t.navDate,
        voidedAt: t.voidedAt,
        sequence,
      })),
      {
        type: data.type,
        quantity: data.quantity,
        occurredAt: data.occurredAt,
        navDate: effectiveNavDate,
        confirmationDate: effectiveConfirmationDate,
        sequence: Number.MAX_SAFE_INTEGER,
      },
    ],
    asset,
  )
  return { account, asset, navDate: effectiveNavDate }
}

/**
 * 在事务内创建一笔流水（含现金联动结算腿与审计）。
 * 调用方负责开启 $transaction 并在提交后重建快照。
 * settleCash 口径：未显式指定时，BUY/SELL 默认联动结算（Web 表单始终显式传值，不受影响）。
 * 分红、利息与费用也支持现金联动，但为了兼容旧 API 客户端，必须显式传 settleCash=true。
 */
export async function createTransactionRecord(
  db: ServiceDb,
  ctx: FamilyCtx,
  data: TxInputData,
  options?: {
    clientRequestId?: string
    clientRequestHash?: string
    corporateActionId?: string
    allowSuspendedFundPurchase?: boolean
  },
): Promise<{ id: string; affectedSince: Date }> {
  const settleCash = data.settleCash ?? (data.type === 'BUY' || data.type === 'SELL')
  const canSettleCash = ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE'].includes(data.type)
  if (data.navSource === 'PENDING' && !settleCash) {
    throw new Error('份额未知的基金申购必须联动资金账户，以保证账本资金守恒')
  }
  const accountId = await routedAccountIdForAsset(db, ctx.familyId, data.accountId, data.assetId)
  const entry = { ...data, accountId }
  const { navDate: effectiveNavDate } = await validateTransaction(db, ctx, entry, {
    allowSuspendedFundPurchase: options?.allowSuspendedFundPurchase,
  })
  const tx = await db.transaction.create({
    data: {
      familyId: ctx.familyId,
      accountId: entry.accountId,
      assetId: data.assetId,
      type: data.type,
      quantity: data.quantity,
      price: data.price,
      amount: data.amount,
      fee: data.fee,
      occurredAt: data.occurredAt,
      navDate: effectiveNavDate,
      navSource: data.navSource ?? null,
      settlementDate: data.settlementDate ?? null,
      note: data.note,
      clientRequestId: options?.clientRequestId ?? null,
      clientRequestHash: options?.clientRequestHash ?? null,
      corporateActionId: options?.corporateActionId ?? null,
    },
  })
  if (settleCash && canSettleCash) {
    const settlement = await cashSettlementOf(db, ctx.familyId, entry.accountId)
    if (!settlement) throw new Error('该交易账户未配置资金账户；请先配置，或关闭现金联动结算')
    // 基金赎回在途：现金结算腿发生在预计到账日（settlementDate），而非成交日
    const legs = buildSettlementLegs(
      { ...entry, internal: false },
      settlement.cashAssetId,
      settlement.accountId,
      { settleAt: data.settlementDate ?? undefined },
    )
    for (const leg of legs) {
      await db.transaction.create({
        data: {
          familyId: ctx.familyId,
          ...leg,
          note: `结算 · #${tx.id.slice(0, 8)}`,
          settleOfId: tx.id,
          corporateActionId: options?.corporateActionId ?? null,
        },
      })
    }
  }
  await recordAudit(db, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'CREATE',
    entity: 'Transaction',
    entityId: tx.id,
    detail: `${data.type} ${data.amount}${settleCash && canSettleCash ? '（含现金结算）' : ''}`,
  })
  return { id: tx.id, affectedSince: tx.occurredAt }
}

/** 冲正：作废原流水及其结算腿，并留下 REVERSAL 标记流水（调用方负责事务与快照重建）。
 * 返回被冲正流水的发生时间，供增量快照重建使用。 */
export async function reverseTransactionRecord(
  db: ServiceDb,
  ctx: FamilyCtx,
  id: string,
): Promise<{ affectedSince: Date }> {
  const original = await db.transaction.findFirst({ where: { id, familyId: ctx.familyId } })
  if (!original) throw new Error('流水不存在')
  if (original.voidedAt) throw new Error('该流水已被冲正')
  if (original.type === 'REVERSAL') throw new Error('冲正流水不可再冲正')

  const now = new Date()
  await db.transaction.updateMany({ where: { id, familyId: ctx.familyId }, data: { voidedAt: now } })
  await db.transaction.updateMany({ where: { settleOfId: id, familyId: ctx.familyId }, data: { voidedAt: now } })
  await db.transaction.create({
    data: {
      familyId: ctx.familyId,
      accountId: original.accountId,
      assetId: original.assetId,
      type: 'REVERSAL',
      amount: 0,
      fee: 0,
      occurredAt: now,
      note: `冲正 #${id.slice(0, 8)}`,
      reversalOfId: id,
    },
  })
  await recordAudit(db, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'REVERSE',
    entity: 'Transaction',
    entityId: id,
    detail: `${original.type} ${Number(original.amount)}`,
  })
  return { affectedSince: original.occurredAt }
}

/**
 * 把使用盘中估值确认的基金买卖替换为官方净值流水。
 * 原流水与结算腿只作废不删除；新流水重新走完整校验、结算与审计。
 */
export async function correctEstimatedFundTransactionRecord(
  db: ServiceDb,
  ctx: FamilyCtx,
  id: string,
  officialNav: number,
): Promise<{
  id: string
  affectedSince: Date
  oldPrice: number
  newPrice: number
  oldQuantity: number
  newQuantity: number
}> {
  if (!Number.isFinite(officialNav) || officialNav <= 0) throw new Error('官方净值无效')
  const original = await db.transaction.findFirst({
    where: { id, familyId: ctx.familyId },
    include: { asset: true },
  })
  if (!original) throw new Error('流水不存在')
  if (original.voidedAt) throw new Error('该流水已被冲正')
  if (original.asset.cls !== 'FUND' || (original.type !== 'BUY' && original.type !== 'SELL')) {
    throw new Error('只有基金申购或赎回可以确认官方净值')
  }
  if ((original.navSource !== 'ESTIMATE' && original.navSource !== 'PENDING') || !original.navDate) {
    throw new Error('该流水不属于待确认的基金申购或估算净值')
  }
  const oldQuantity = Number(original.quantity ?? 0)
  const oldPrice = Number(original.price ?? 0)
  const newQuantity = original.type === 'BUY'
    ? estimateShares(Number(original.amount), officialNav)
    : oldQuantity
  if (newQuantity <= 0) throw new Error('官方净值无法得到有效份额')
  const newAmount = original.type === 'BUY'
    ? Number(original.amount)
    : roundMoney(newQuantity * officialNav)
  const settlementCount = await db.transaction.count({ where: { familyId: ctx.familyId, settleOfId: id } })

  await reverseTransactionRecord(db, ctx, id)
  const corrected = await createTransactionRecord(db, ctx, {
    accountId: original.accountId,
    assetId: original.assetId,
    type: original.type,
    quantity: newQuantity,
    price: officialNav,
    amount: newAmount,
    fee: Number(original.fee),
    occurredAt: original.occurredAt,
    navDate: original.navDate,
    navSource: 'OFFICIAL',
    settlementDate: original.settlementDate,
    note: `${original.note ? `${original.note} · ` : ''}官方净值修正 #${original.id.slice(0, 8)}`.slice(0, 200),
    settleCash: settlementCount > 0,
  })
  await recordAudit(db, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action: 'FUND_NAV_CORRECT',
    entity: 'Transaction',
    entityId: corrected.id,
    detail: `${original.id}：${oldPrice} → ${officialNav}；${oldQuantity} → ${newQuantity}`,
  })
  return {
    id: corrected.id,
    affectedSince: original.occurredAt,
    oldPrice,
    newPrice: officialNav,
    oldQuantity,
    newQuantity,
  }
}

/** 提交后重建快照；失败时返回警告文案（revalidate 策略由调用方决定）。
 * affectedSince：受影响的最早日期，增量重建只重算该日之后；缺省全量。 */
export async function rebuildSnapshotsForFamily(
  db: PrismaClient,
  familyId: string,
  affectedSince?: Date,
): Promise<string | undefined> {
  try {
    await rebuildSnapshots(db, familyId, affectedSince ? { affectedSince } : undefined)
    return undefined
  } catch (error) {
    console.error('快照重建失败', error)
    return '账本已保存，但财富轨迹暂未更新；请稍后点击「↻ 行情」重试'
  }
}
