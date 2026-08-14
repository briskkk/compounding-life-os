// 共享事务写服务：流水创建 / 冲正的唯一写路径
// 供 Server Actions（src/lib/actions.ts）与移动端 API（src/app/api/transactions/route.ts）复用，
// 保证 Web 与 APP 走同一套校验、结算联动、审计与快照刷新口径。
import type { Prisma, PrismaClient } from '@prisma/client'
import { recordAudit } from '@/lib/audit'
import { rebuildSnapshots } from '@/lib/snapshots'
import type { FamilyCtx } from '@/lib/scoped'
import { buildSettlementLegs } from '@/lib/engine/settlement'
import { foldTransactions, type LedgerTx } from '@/lib/engine/ledger'
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
  },
) {
  const [account, asset] = await Promise.all([
    db.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } }),
    db.asset.findFirst({ where: { id: data.assetId, familyId: ctx.familyId } }),
  ])
  if (!account) throw new Error('账户不存在或不属于当前家庭')
  if (!asset) throw new Error('资产不存在或不属于当前家庭')
  if (account.currency !== asset.currency) throw new Error('账户与资产币种不一致')

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
    assetClass: asset.cls,
    internal: t.internal,
    voidedAt: t.voidedAt,
    currency: asset.currency,
  }))
  const position = foldTransactions(ledger)[0] ?? { quantity: 0, unvestedQty: 0 }
  assertTransactionRules(data, asset, position)
  assertTransactionTimeline(
    [
      ...rows.map((t, sequence) => ({
        type: t.type,
        quantity: t.quantity == null ? null : Number(t.quantity),
        occurredAt: t.occurredAt,
        voidedAt: t.voidedAt,
        sequence,
      })),
      { type: data.type, quantity: data.quantity, occurredAt: data.occurredAt, sequence: Number.MAX_SAFE_INTEGER },
    ],
    asset,
  )
  return { account, asset }
}

/**
 * 在事务内创建一笔流水（含现金联动结算腿与审计）。
 * 调用方负责开启 $transaction 并在提交后重建快照。
 * settleCash 口径：未显式指定时，BUY/SELL 默认联动结算（Web 表单始终显式传值，不受影响）。
 */
export async function createTransactionRecord(
  db: ServiceDb,
  ctx: FamilyCtx,
  data: TxInputData,
): Promise<{ id: string; affectedSince: Date }> {
  const settleCash = data.settleCash ?? (data.type === 'BUY' || data.type === 'SELL')
  const accountId = await routedAccountIdForAsset(db, ctx.familyId, data.accountId, data.assetId)
  const entry = { ...data, accountId }
  await validateTransaction(db, ctx, entry)
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
      note: data.note,
    },
  })
  if (settleCash && (data.type === 'BUY' || data.type === 'SELL')) {
    const settlement = await cashSettlementOf(db, ctx.familyId, entry.accountId)
    if (!settlement) throw new Error('该交易账户未配置资金账户；请先配置，或关闭现金联动结算')
    const legs = buildSettlementLegs(
      { ...entry, internal: false },
      settlement.cashAssetId,
      settlement.accountId,
    )
    for (const leg of legs) {
      await db.transaction.create({
        data: {
          familyId: ctx.familyId,
          ...leg,
          note: `结算 · #${tx.id.slice(0, 8)}`,
          settleOfId: tx.id,
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
    detail: `${data.type} ${data.amount}${settleCash && (data.type === 'BUY' || data.type === 'SELL') ? '（含现金结算）' : ''}`,
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
