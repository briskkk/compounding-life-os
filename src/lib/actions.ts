'use server'

// Server Actions：所有写操作入口 —— RLS 作用域 + 审计 + 快照重建
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSessionOrThrow, MEMBER_COOKIE } from './session'
import { recordAudit } from './audit'
import { rebuildSnapshots } from './snapshots'
import {
  accountInputSchema,
  accountSettlementSchema,
  assetInputSchema,
  assetUpdateSchema,
  goalInputSchema,
  goalScenarioSchema,
  goalUpdateSchema,
  liabilityEntryInputSchema,
  liabilityInputSchema,
  savingsEntryInputSchema,
  txInputSchema,
} from './schemas'
import { parseCsvRows, type CsvLookup, type ParsedTx } from './csv'
import { buildSettlementLegs } from './engine/settlement'
import { BENCHMARK_INDICES } from './engine/benchmark'
import { createsSettlementCycle } from './engine/settlement-account'
import { foldTransactions, type LedgerTx } from './engine/ledger'
import { parseTags, serializeTags } from './engine/groups'
import { persistFundHistory, persistHistory } from './market/persist'
import { assertTransactionRules, assertTransactionTimeline, type TransactionDraft } from './transaction-rules'

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; warning?: string }
  | { ok: false; error: string }

async function requireWrite(): Promise<FamilyCtx> {
  const ctx = await getSessionOrThrow()
  if (ctx.role === 'VIEWER') throw new Error('只读成员无权执行写操作')
  return ctx
}

function fail(e: unknown): ActionResult<never> {
  const msg = e instanceof Error ? e.message : String(e)
  return { ok: false, error: msg }
}

async function audit(
  ctx: FamilyCtx,
  action: string,
  entity: string,
  entityId?: string | null,
  detail?: string | null,
  base: PrismaClient | Prisma.TransactionClient = prisma,
) {
  await recordAudit(base, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action,
    entity,
    entityId,
    detail,
  })
}

async function refresh(ctx: FamilyCtx): Promise<string | undefined> {
  let warning: string | undefined
  try {
    await rebuildSnapshots(prisma, ctx.familyId)
  } catch (error) {
    console.error('快照重建失败', error)
    warning = '账本已保存，但财富轨迹暂未更新；请稍后点击「↻ 行情」重试'
  }
  revalidatePath('/')
  return warning
}

/** 解析交易账户显式配置的资金账户及其同币种现金资产。 */
type ActionDb = PrismaClient | Prisma.TransactionClient

async function cashSettlementOf(
  db: ActionDb,
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
async function routedAccountIdForAsset(
  db: ActionDb,
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

async function validateTransaction(
  db: ActionDb,
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

// ---------- 会话 ----------

export async function switchMember(memberId: string): Promise<ActionResult> {
  try {
    const current = await getSessionOrThrow()
    const member = await prisma.member.findFirst({ where: { id: memberId, familyId: current.familyId } })
    if (!member) return { ok: false, error: '成员不存在' }
    const store = await cookies()
    store.set(MEMBER_COOKIE, memberId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })
    await recordAudit(prisma, {
      familyId: member.familyId,
      actorId: current.memberId,
      actorName: current.memberName,
      action: 'SESSION_SWITCH',
      entity: 'Member',
      entityId: member.id,
      detail: `切换为 ${member.name}（${member.role}）`,
    })
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 流水 ----------

export async function createTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const { settleCash, ...data } = txInputSchema.parse(input)
    const txId = await prisma.$transaction(async (txDb) => {
      const accountId = await routedAccountIdForAsset(txDb, ctx.familyId, data.accountId, data.assetId)
      const entry = { ...data, accountId }
      await validateTransaction(txDb, ctx, entry)
      const tx = await txDb.transaction.create({
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
      // 现金联动结算腿（路由到账户显式配置的资金账户）
      if (settleCash && (data.type === 'BUY' || data.type === 'SELL')) {
        const settlement = await cashSettlementOf(txDb, ctx.familyId, entry.accountId)
        if (!settlement) throw new Error('该交易账户未配置资金账户；请先配置，或关闭现金联动结算')
        const legs = buildSettlementLegs(
          { ...entry, internal: false },
          settlement.cashAssetId,
          settlement.accountId,
        )
        for (const leg of legs) {
          await txDb.transaction.create({
            data: {
              familyId: ctx.familyId,
              ...leg,
              note: `结算 · #${tx.id.slice(0, 8)}`,
              settleOfId: tx.id,
            },
          })
        }
      }
      await audit(ctx, 'CREATE', 'Transaction', tx.id, `${data.type} ${data.amount}${settleCash ? '（含现金结算）' : ''}`, txDb)
      return tx.id
    })
    const warning = await refresh(ctx)
    return { ok: true, data: { id: txId }, warning }
  } catch (e) {
    return fail(e)
  }
}

/** 冲正：作废原流水及其结算腿，并留下 REVERSAL 标记流水 */
export async function reverseTransaction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await prisma.$transaction(async (txDb) => {
      const original = await txDb.transaction.findFirst({ where: { id, familyId: ctx.familyId } })
      if (!original) throw new Error('流水不存在')
      if (original.voidedAt) throw new Error('该流水已被冲正')
      if (original.type === 'REVERSAL') throw new Error('冲正流水不可再冲正')

      const now = new Date()
      await txDb.transaction.updateMany({ where: { id, familyId: ctx.familyId }, data: { voidedAt: now } })
      await txDb.transaction.updateMany({ where: { settleOfId: id, familyId: ctx.familyId }, data: { voidedAt: now } })
      await txDb.transaction.create({
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
      await audit(ctx, 'REVERSE', 'Transaction', id, `${original.type} ${Number(original.amount)}`, txDb)
    })
    const warning = await refresh(ctx)
    return { ok: true, warning }
  } catch (e) {
    return fail(e)
  }
}

// ---------- CSV 导入 ----------

export async function importTransactions(
  rows: Record<string, string>[],
  settle = false,
): Promise<ActionResult<{ imported: number; failed: number; errors: { row: number; errors: string[] }[] }>> {
  try {
    const ctx = await requireWrite()
    if (rows.length > 2000) return { ok: false, error: '单次最多导入 2000 行，请拆分文件后重试' }
    const db = scopedDb(prisma, ctx)
    const [accounts, assets] = await Promise.all([db.account.findMany(), db.asset.findMany()])
    const lookup: CsvLookup = {
      accountByName: new Map(accounts.map((a) => [a.name, a.id])),
      assetBySymbol: new Map(assets.map((a) => [a.symbol.toUpperCase(), a.id])),
    }
    const parsed = parseCsvRows(rows, lookup)
    const valid = parsed.filter((r) => r.ok && r.tx)
    const failed = parsed.filter((r) => !r.ok).map((r) => ({ row: r.row, errors: r.errors }))
    if (valid.length > 0) {
      const toCreate = valid.map((r) => ({ ...r.tx!, note: r.tx!.note }))
      await prisma.$transaction(
        async (txDb) => {
          for (const tx of toCreate) {
            const accountId = await routedAccountIdForAsset(txDb, ctx.familyId, tx.accountId, tx.assetId)
            const entry = { ...tx, accountId }
            await validateTransaction(txDb, ctx, { ...entry, type: entry.type as TransactionDraft['type'] })
            const created = await txDb.transaction.create({
              data: {
                familyId: ctx.familyId,
                accountId: entry.accountId,
                assetId: tx.assetId,
                type: tx.type,
                quantity: tx.quantity,
                price: tx.price,
                amount: tx.amount,
                fee: tx.fee,
                occurredAt: tx.occurredAt,
                note: tx.note,
              },
            })
            const needsSettlement = settle && (entry.type === 'BUY' || entry.type === 'SELL')
            const settlement = needsSettlement ? await cashSettlementOf(txDb, ctx.familyId, entry.accountId) : null
            if (needsSettlement && !settlement) {
              throw new Error('CSV 中存在未配置资金账户的交易账户；请先完成账户配置，或关闭现金联动结算')
            }
            if (settlement) {
              const legs = buildSettlementLegs(entry as ParsedTx, settlement.cashAssetId, settlement.accountId)
              for (const leg of legs) {
                await txDb.transaction.create({
                  data: {
                    familyId: ctx.familyId,
                    ...leg,
                    note: `结算 · CSV #${created.id.slice(0, 8)}`,
                    settleOfId: created.id,
                  },
                })
              }
            }
          }
          await audit(ctx, 'IMPORT', 'Transaction', null, `CSV 导入 ${valid.length} 条，失败 ${failed.length} 条${settle ? '（含现金结算）' : ''}`, txDb)
        },
        { timeout: 30_000 },
      )
      const warning = await refresh(ctx)
      return { ok: true, data: { imported: valid.length, failed: failed.length, errors: failed }, warning }
    }
    return { ok: true, data: { imported: valid.length, failed: failed.length, errors: failed } }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 账户 / 资产 ----------

export async function createAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = accountInputSchema.parse(input)
    const acc = await prisma.$transaction(async (txDb) => {
      const created = await txDb.account.create({ data: { ...data, familyId: ctx.familyId } })
      await audit(ctx, 'CREATE', 'Account', created.id, data.name, txDb)
      return created
    })
    revalidatePath('/accounts')
    return { ok: true, data: { id: acc.id } }
  } catch (e) {
    return fail(e)
  }
}

/** 配置交易账户的资金结算账户，并将其历史现金流水归集到新资金账户。 */
export async function updateAccountSettlement(
  accountId: string,
  input: unknown,
): Promise<ActionResult<{ moved: number }>> {
  try {
    const ctx = await requireWrite()
    const { settlementAccountId } = accountSettlementSchema.parse(input)
    const moved = await prisma.$transaction(async (txDb) => {
      const account = await txDb.account.findFirst({ where: { id: accountId, familyId: ctx.familyId } })
      if (!account) throw new Error('账户不存在或不属于当前家庭')

      let settlementName = '未关联'
      if (settlementAccountId) {
        const target = await txDb.account.findFirst({ where: { id: settlementAccountId, familyId: ctx.familyId } })
        if (!target) throw new Error('资金账户不存在或不属于当前家庭')
        if (target.currency !== account.currency) throw new Error('资金账户必须与交易账户币种一致')
        const familyAccounts = await txDb.account.findMany({
          where: { familyId: ctx.familyId },
          select: { id: true, settlementAccountId: true },
        })
        if (createsSettlementCycle(accountId, settlementAccountId, familyAccounts)) {
          throw new Error('资金结算关系不能形成循环')
        }
        settlementName = target.name
      }

      await txDb.account.updateMany({
        where: { id: accountId, familyId: ctx.familyId },
        data: { settlementAccountId },
      })

      let movedCount = 0
      if (settlementAccountId && settlementAccountId !== accountId) {
        const trades = await txDb.transaction.findMany({
          where: { familyId: ctx.familyId, accountId, type: { in: ['BUY', 'SELL'] } },
          select: { id: true },
        })
        for (let i = 0; i < trades.length; i += 500) {
          const ids = trades.slice(i, i + 500).map((trade) => trade.id)
          const result = await txDb.transaction.updateMany({
            where: {
              familyId: ctx.familyId,
              settleOfId: { in: ids },
              accountId: { not: settlementAccountId },
            },
            data: { accountId: settlementAccountId },
          })
          movedCount += result.count
        }
        const cashAssets = await txDb.asset.findMany({
          where: { familyId: ctx.familyId, cls: 'CASH', currency: account.currency },
          select: { id: true },
        })
        for (let i = 0; i < cashAssets.length; i += 500) {
          const ids = cashAssets.slice(i, i + 500).map((asset) => asset.id)
          const result = await txDb.transaction.updateMany({
            where: {
              familyId: ctx.familyId,
              accountId,
              assetId: { in: ids },
            },
            data: { accountId: settlementAccountId },
          })
          movedCount += result.count
        }
      }

      await audit(
        ctx,
        'UPDATE',
        'Account',
        accountId,
        `资金账户：${settlementName}；归集历史现金流水 ${movedCount} 条`,
        txDb,
      )
      return movedCount
    })
    revalidatePath('/accounts')
    revalidatePath(`/accounts/${accountId}`)
    revalidatePath('/transactions')
    revalidatePath('/positions')
    revalidatePath('/')
    return { ok: true, data: { moved } }
  } catch (e) {
    return fail(e)
  }
}

export async function createAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = assetInputSchema.parse(input)
    const manual = data.cls === 'REAL_ESTATE' || data.cls === 'HUAWEI_STOCK' ? true : data.manual
    const tags = serializeTags(parseTags(data.tags))
    const asset = await prisma.$transaction(async (txDb) => {
      const created = await txDb.asset.create({ data: { ...data, tags, manual, familyId: ctx.familyId } })
      await audit(ctx, 'CREATE', 'Asset', created.id, `${data.symbol} ${data.name}`, txDb)
      return created
    })
    revalidatePath('/accounts')
    return { ok: true, data: { id: asset.id } }
  } catch (e) {
    return fail(e)
  }
}

/** 更新资产（名称 / 标签 / 介绍 / 投资风格） */
export async function updateAsset(id: string, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const data = assetUpdateSchema.parse(input)
    const patch: Record<string, unknown> = { ...data }
    if (data.tags != null) patch.tags = serializeTags(parseTags(data.tags))
    await prisma.$transaction(async (txDb) => {
      const updated = await txDb.asset.updateMany({ where: { id, familyId: ctx.familyId }, data: patch })
      if (updated.count === 0) throw new Error('资产不存在或不属于当前家庭')
      await audit(ctx, 'UPDATE', 'Asset', id, JSON.stringify(patch), txDb)
    })
    revalidatePath('/positions')
    revalidatePath('/accounts')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 负债 ----------

export async function createLiability(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = liabilityInputSchema.parse(input)
    const liab = await prisma.$transaction(async (txDb) => {
      const created = await txDb.liability.create({ data: { ...data, familyId: ctx.familyId } })
      await audit(ctx, 'CREATE', 'Liability', created.id, data.name, txDb)
      return created
    })
    const warning = await refresh(ctx)
    return { ok: true, data: { id: liab.id }, warning }
  } catch (e) {
    return fail(e)
  }
}

export async function addLiabilityEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = liabilityEntryInputSchema.parse(input)
    const entry = await prisma.$transaction(async (txDb) => {
      const liability = await txDb.liability.findFirst({ where: { id: data.liabilityId, familyId: ctx.familyId } })
      if (!liability) throw new Error('负债不存在或不属于当前家庭')
      const created = await txDb.liabilityEntry.create({ data: { ...data, familyId: ctx.familyId } })
      await audit(ctx, 'CREATE', 'LiabilityEntry', created.id, `${data.type} ${data.amount}`, txDb)
      return created
    })
    const warning = await refresh(ctx)
    return { ok: true, data: { id: entry.id }, warning }
  } catch (e) {
    return fail(e)
  }
}

// ---------- FIRE 计划 ----------

export async function createGoal(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = goalInputSchema.parse(input)
    // 支出反推模式：FIRE Number = 需要由组合承担的年度支出 / 安全提取率。
    const targetAmount = data.mode === 'STREAM'
      ? Math.max(0, data.annualSpend - data.retirementIncome) / data.withdrawalRate
      : data.targetAmount
    const goal = await prisma.$transaction(async (txDb) => {
      const created = await txDb.goal.create({ data: { ...data, targetAmount, familyId: ctx.familyId } })
      await audit(ctx, 'CREATE', 'Goal', created.id, `${data.name} ${data.targetAmount}`, txDb)
      return created
    })
    revalidatePath('/goals')
    revalidatePath('/')
    return { ok: true, data: { id: goal.id } }
  } catch (e) {
    return fail(e)
  }
}

export async function updateGoal(id: string, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const data = goalUpdateSchema.parse(input)
    const patch: Record<string, unknown> = { ...data }
    if (
      data.mode === 'STREAM'
      && data.annualSpend != null
      && data.retirementIncome != null
      && data.withdrawalRate != null
    ) {
      patch.targetAmount = Math.max(0, data.annualSpend - data.retirementIncome) / data.withdrawalRate
    }
    await prisma.$transaction(async (txDb) => {
      const updated = await txDb.goal.updateMany({ where: { id, familyId: ctx.familyId }, data: patch })
      if (updated.count === 0) throw new Error('目标不存在或不属于当前家庭')
      await audit(ctx, 'UPDATE', 'Goal', id, JSON.stringify(data), txDb)
    })
    revalidatePath('/goals')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await prisma.$transaction(async (txDb) => {
      const deleted = await txDb.goal.deleteMany({ where: { id, familyId: ctx.familyId } })
      if (deleted.count === 0) throw new Error('目标不存在或不属于当前家庭')
      await audit(ctx, 'DELETE', 'Goal', id, null, txDb)
    })
    revalidatePath('/goals')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function applyGoalScenario(id: string, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const data = goalScenarioSchema.parse(input)
    await prisma.$transaction(async (txDb) => {
      const goal = await txDb.goal.findFirst({ where: { id, familyId: ctx.familyId } })
      if (!goal) throw new Error('目标不存在或不属于当前家庭')
      const targetDate = new Date(goal.targetDate)
      targetDate.setUTCMonth(targetDate.getUTCMonth() + data.delayMonths)
      const targetAmount = goal.mode === 'LUMP_SUM'
        ? Number(goal.targetAmount) * (1 - data.targetReduction)
        : Number(goal.targetAmount)
      await txDb.goal.updateMany({
        where: { id, familyId: ctx.familyId },
        data: {
          monthlyContribution: data.monthlyContribution,
          targetDate,
          targetAmount,
        },
      })
      await audit(
        ctx,
        'UPDATE',
        'Goal',
        id,
        `情景方案：月投入 ${data.monthlyContribution}，延后 ${data.delayMonths} 月，目标调整 ${(data.targetReduction * 100).toFixed(0)}%`,
        txDb,
      )
    })
    revalidatePath('/goals')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

function canonicalSavingsPeriod(periodType: 'WEEK' | 'MONTH', value: Date): Date {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  if (periodType === 'MONTH') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)
  return date
}

export async function upsertSavingsEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = savingsEntryInputSchema.parse(input)
    const periodStart = canonicalSavingsPeriod(data.periodType, data.periodStart)
    const entry = await prisma.$transaction(async (txDb) => {
      const saved = await txDb.savingsEntry.upsert({
        where: {
          familyId_periodType_periodStart: {
            familyId: ctx.familyId,
            periodType: data.periodType,
            periodStart,
          },
        },
        create: { ...data, periodStart, familyId: ctx.familyId },
        update: {
          income: data.income,
          spending: data.spending,
          savedAmount: data.savedAmount,
          note: data.note,
        },
      })
      await audit(
        ctx,
        'UPSERT',
        'SavingsEntry',
        saved.id,
        `${data.periodType} ${periodStart.toISOString().slice(0, 10)} 收入 ${data.income} 消费 ${data.spending} 储蓄 ${data.savedAmount}`,
        txDb,
      )
      return saved
    })
    revalidatePath('/goals')
    revalidatePath('/')
    return { ok: true, data: { id: entry.id } }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 行情 ----------

/** 刷新行情：历史日线落库 + 重建快照 */
export async function refreshPrices(): Promise<ActionResult<{ symbol: string; count: number; source: string }[]>> {
  try {
    const ctx = await requireWrite()
    const db = scopedDb(prisma, ctx)
    const assets = await db.asset.findMany({ where: { manual: false, cls: { notIn: ['CASH', 'REAL_ESTATE'] } } })
    const from = new Date(Date.now() - 800 * 86400000)
    // 清理历史遗留的模拟源 K 线（确定性模拟序列可由价格函数按需重现，无需落库；
    // 避免真实链路下被旧模拟数据优先命中）
    const purged = await prisma.priceBar.deleteMany({ where: { source: 'SIMULATED' } })
    // 基金资产落官方净值历史，其余走行情链路
    const fundSymbols = assets.filter((a) => a.cls === 'FUND').map((a) => a.symbol)
    const marketSymbols = [
      ...assets.filter((a) => a.cls !== 'FUND').map((a) => a.symbol),
      ...BENCHMARK_INDICES.map((index) => index.symbol),
    ]
    const results = [
      ...(await persistFundHistory(prisma, fundSymbols, from, new Date())),
      ...(await persistHistory(prisma, marketSymbols, from, new Date())),
    ]
    await rebuildSnapshots(prisma, ctx.familyId)
    await audit(ctx, 'REFRESH', 'PriceBar', null, `清理模拟K线 ${purged.count} 条；` + results.map((r) => `${r.symbol}:${r.count}@${r.source}`).join(' '))
    revalidatePath('/')
    return { ok: true, data: results }
  } catch (e) {
    return fail(e)
  }
}
