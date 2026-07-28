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
  assetInputSchema,
  assetUpdateSchema,
  goalInputSchema,
  goalUpdateSchema,
  liabilityEntryInputSchema,
  liabilityInputSchema,
  prefsInputSchema,
  txInputSchema,
} from './schemas'
import { parseCsvRows, type CsvLookup, type ParsedTx } from './csv'
import { buildSettlementLegs } from './engine/settlement'
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

/** 查找与账户币种匹配的现金资产（用于结算腿）；无匹配时退回任一现金资产 */
type ActionDb = PrismaClient | Prisma.TransactionClient

async function cashAssetIdOf(db: ActionDb, familyId: string, accountId?: string): Promise<string | null> {
  if (accountId) {
    const account = await db.account.findFirst({ where: { id: accountId, familyId } })
    if (account) {
      const matched = await db.asset.findFirst({ where: { familyId, cls: 'CASH', currency: account.currency } })
      if (matched) return matched.id
    }
  }
  const cash = await db.asset.findFirst({ where: { familyId, cls: 'CASH' } })
  return cash?.id ?? null
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
      await validateTransaction(txDb, ctx, data)
      const tx = await txDb.transaction.create({
        data: {
          familyId: ctx.familyId,
          accountId: data.accountId,
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
      // 现金联动结算腿（按账户币种匹配现金资产）
      if (settleCash) {
        const cashId = await cashAssetIdOf(txDb, ctx.familyId, data.accountId)
        if (cashId) {
          const legs = buildSettlementLegs({ ...data, internal: false }, cashId)
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
            await validateTransaction(txDb, ctx, { ...tx, type: tx.type as TransactionDraft['type'] })
            const created = await txDb.transaction.create({
              data: {
                familyId: ctx.familyId,
                accountId: tx.accountId,
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
            const cashId = settle ? await cashAssetIdOf(txDb, ctx.familyId, tx.accountId) : null
            if (cashId) {
              const legs = buildSettlementLegs(tx as ParsedTx, cashId)
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

export async function createAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = assetInputSchema.parse(input)
    const manual = data.cls === 'REAL_ESTATE' ? true : data.manual
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

/** 更新资产（名称 / 标签 / 介绍） */
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

// ---------- 目标 ----------

export async function createGoal(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = goalInputSchema.parse(input)
    // 支出流目标的名义金额 = 年支出 × 年数（用于展示与进度口径）
    const targetAmount = data.mode === 'STREAM' ? data.annualSpend * data.spendYears : data.targetAmount
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
    if (data.mode === 'STREAM' && data.annualSpend != null && data.spendYears != null) {
      patch.targetAmount = data.annualSpend * data.spendYears
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

// ---------- 洞察 / 行情 ----------

/** 更新家庭策略阈值并立即重算洞察 */
export async function updatePrefs(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const data = prefsInputSchema.parse(input)
    await prisma.$transaction(async (txDb) => {
      await txDb.familyPrefs.upsert({
        where: { familyId: ctx.familyId },
        create: { ...data, familyId: ctx.familyId },
        update: data,
      })
      await txDb.insight.deleteMany({ where: { familyId: ctx.familyId } })
      await audit(ctx, 'UPDATE', 'FamilyPrefs', ctx.familyId, JSON.stringify(data), txDb)
    })
    revalidatePath('/insights')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function regenerateInsights(): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await prisma.$transaction(async (txDb) => {
      await txDb.insight.deleteMany({ where: { familyId: ctx.familyId } })
      await audit(ctx, 'REGENERATE', 'Insight', null, null, txDb)
    })
    revalidatePath('/insights')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

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
    const marketSymbols = assets.filter((a) => a.cls !== 'FUND').map((a) => a.symbol)
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
