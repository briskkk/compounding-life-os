'use server'

// Server Actions：所有写操作入口 —— RLS 作用域 + 审计 + 快照重建
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
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
import { parseTags, serializeTags } from './engine/groups'
import { persistFundHistory, persistHistory } from './market/persist'

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
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

async function audit(ctx: FamilyCtx, action: string, entity: string, entityId?: string | null, detail?: string | null) {
  await recordAudit(prisma, {
    familyId: ctx.familyId,
    actorId: ctx.memberId,
    actorName: ctx.memberName,
    action,
    entity,
    entityId,
    detail,
  })
}

async function refresh(ctx: FamilyCtx) {
  await rebuildSnapshots(prisma, ctx.familyId)
  revalidatePath('/')
}

/** 查找与账户币种匹配的现金资产（用于结算腿）；无匹配时退回任一现金资产 */
async function cashAssetIdOf(db: ReturnType<typeof scopedDb>, accountId?: string): Promise<string | null> {
  if (accountId) {
    const account = await db.account.findFirst({ where: { id: accountId } })
    if (account) {
      const matched = await db.asset.findFirst({ where: { cls: 'CASH', currency: account.currency } })
      if (matched) return matched.id
    }
  }
  const cash = await db.asset.findFirst({ where: { cls: 'CASH' } })
  return cash?.id ?? null
}

// ---------- 会话 ----------

export async function switchMember(memberId: string): Promise<ActionResult> {
  try {
    const member = await prisma.member.findUnique({ where: { id: memberId } })
    if (!member) return { ok: false, error: '成员不存在' }
    const store = await cookies()
    store.set(MEMBER_COOKIE, memberId, { httpOnly: true, sameSite: 'lax', path: '/' })
    await recordAudit(prisma, {
      familyId: member.familyId,
      actorId: member.id,
      actorName: member.name,
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
    const db = scopedDb(prisma, ctx)
    const tx = await db.transaction.create({
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
      const cashId = await cashAssetIdOf(db, data.accountId)
      if (cashId) {
        const legs = buildSettlementLegs({ ...data, internal: false }, cashId)
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
    }
    await audit(ctx, 'CREATE', 'Transaction', tx.id, `${data.type} ${data.amount}${settleCash ? '（含现金结算）' : ''}`)
    await refresh(ctx)
    return { ok: true, data: { id: tx.id } }
  } catch (e) {
    return fail(e)
  }
}

/** 冲正：作废原流水及其结算腿，并留下 REVERSAL 标记流水 */
export async function reverseTransaction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const db = scopedDb(prisma, ctx)
    const original = await db.transaction.findFirst({ where: { id } })
    if (!original) return { ok: false, error: '流水不存在' }
    if (original.voidedAt) return { ok: false, error: '该流水已被冲正' }
    if (original.type === 'REVERSAL') return { ok: false, error: '冲正流水不可再冲正' }

    const now = new Date()
    await db.transaction.update({ where: { id }, data: { voidedAt: now } })
    await db.transaction.updateMany({ where: { settleOfId: id }, data: { voidedAt: now } })
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
    await audit(ctx, 'REVERSE', 'Transaction', id, `${original.type} ${Number(original.amount)}`)
    await refresh(ctx)
    return { ok: true }
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
      for (const tx of toCreate) {
        const created = await db.transaction.create({
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
        const cashId = settle ? await cashAssetIdOf(db, tx.accountId) : null
        if (cashId) {
          const legs = buildSettlementLegs(tx as ParsedTx, cashId)
          for (const leg of legs) {
            await db.transaction.create({
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
      await audit(ctx, 'IMPORT', 'Transaction', null, `CSV 导入 ${valid.length} 条，失败 ${failed.length} 条${settle ? '（含现金结算）' : ''}`)
      await refresh(ctx)
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
    const db = scopedDb(prisma, ctx)
    const acc = await db.account.create({ data: { ...data, familyId: ctx.familyId } })
    await audit(ctx, 'CREATE', 'Account', acc.id, data.name)
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
    const db = scopedDb(prisma, ctx)
    const manual = data.cls === 'REAL_ESTATE' ? true : data.manual
    const tags = serializeTags(parseTags(data.tags))
    const asset = await db.asset.create({ data: { ...data, tags, manual, familyId: ctx.familyId } })
    await audit(ctx, 'CREATE', 'Asset', asset.id, `${data.symbol} ${data.name}`)
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
    const db = scopedDb(prisma, ctx)
    const patch: Record<string, unknown> = { ...data }
    if (data.tags != null) patch.tags = serializeTags(parseTags(data.tags))
    await db.asset.update({ where: { id }, data: patch })
    await audit(ctx, 'UPDATE', 'Asset', id, JSON.stringify(patch))
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
    const db = scopedDb(prisma, ctx)
    const liab = await db.liability.create({ data: { ...data, familyId: ctx.familyId } })
    await audit(ctx, 'CREATE', 'Liability', liab.id, data.name)
    await refresh(ctx)
    return { ok: true, data: { id: liab.id } }
  } catch (e) {
    return fail(e)
  }
}

export async function addLiabilityEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = liabilityEntryInputSchema.parse(input)
    const db = scopedDb(prisma, ctx)
    const entry = await db.liabilityEntry.create({ data: { ...data, familyId: ctx.familyId } })
    await audit(ctx, 'CREATE', 'LiabilityEntry', entry.id, `${data.type} ${data.amount}`)
    await refresh(ctx)
    return { ok: true, data: { id: entry.id } }
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
    const db = scopedDb(prisma, ctx)
    const goal = await db.goal.create({ data: { ...data, targetAmount, familyId: ctx.familyId } })
    await audit(ctx, 'CREATE', 'Goal', goal.id, `${data.name} ${data.targetAmount}`)
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
    const db = scopedDb(prisma, ctx)
    const patch: Record<string, unknown> = { ...data }
    if (data.mode === 'STREAM' && data.annualSpend != null && data.spendYears != null) {
      patch.targetAmount = data.annualSpend * data.spendYears
    }
    await db.goal.update({ where: { id }, data: patch })
    await audit(ctx, 'UPDATE', 'Goal', id, JSON.stringify(data))
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
    const db = scopedDb(prisma, ctx)
    await db.goal.delete({ where: { id } })
    await audit(ctx, 'DELETE', 'Goal', id)
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
    const db = scopedDb(prisma, ctx)
    await db.familyPrefs.upsert({
      where: { familyId: ctx.familyId },
      create: { ...data, familyId: ctx.familyId },
      update: data,
    })
    await db.insight.deleteMany({})
    await audit(ctx, 'UPDATE', 'FamilyPrefs', ctx.familyId, JSON.stringify(data))
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
    const db = scopedDb(prisma, ctx)
    await db.insight.deleteMany({})
    await audit(ctx, 'REGENERATE', 'Insight')
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
