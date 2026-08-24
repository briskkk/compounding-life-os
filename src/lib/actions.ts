'use server'

// Server Actions：所有写操作入口 —— RLS 作用域 + 审计 + 快照重建
import { revalidatePath } from 'next/cache'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSessionOrThrow } from './session'
import { auditedTransaction, recordAudit } from './audit'
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
  portfolioReviewInputSchema,
  savingsEntryInputSchema,
  txInputSchema,
} from './schemas'
import { parseCsvRows, type CsvLookup, type ParsedTx } from './csv'
import { buildSettlementLegs } from './engine/settlement'
import { BENCHMARK_INDICES } from './engine/benchmark'
import { createsSettlementCycle } from './engine/settlement-account'
import { parseTags, serializeTags } from './engine/groups'
import { persistFundHistory, persistHistory } from './market/persist'
import { fxRates, persistDailyFx } from './market/fx'
import { type TransactionDraft } from './transaction-rules'
import { getReviewPageData } from './review-data'
import {
  cashSettlementOf,
  createTransactionRecord,
  rebuildSnapshotsForFamily,
  reverseTransactionRecord,
  routedAccountIdForAsset,
  validateTransaction,
} from './services/transactions'

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

async function refresh(ctx: FamilyCtx, affectedSince?: Date): Promise<string | undefined> {
  const warning = await rebuildSnapshotsForFamily(prisma, ctx.familyId, affectedSince)
  revalidatePath('/')
  return warning
}

// ---------- 组合复盘 ----------

export async function savePortfolioReview(input: unknown): Promise<ActionResult<{
  id: string
  status: 'DRAFT' | 'COMPLETED'
  updatedAt: string
}>> {
  try {
    const ctx = await requireWrite()
    const data = portfolioReviewInputSchema.parse(input)
    const startDate = new Date(`${data.startDate}T00:00:00Z`)
    const endDate = new Date(`${data.endDate}T00:00:00Z`)
    const evidence = await getReviewPageData({ period: data.period, benchmark: data.benchmarkSymbol })
    if (!evidence || evidence.range.startDate !== data.startDate || evidence.range.endDate !== data.endDate) {
      throw new Error('复盘区间已经变化，请刷新页面后重试')
    }
    const evidenceResult = evidence.result
    const metricsSnapshot = JSON.stringify({
      amount: evidenceResult.performance.amount,
      pct: evidenceResult.performance.pct,
      mwrPct: evidenceResult.performance.curve.at(-1)?.mwrPct ?? null,
      benchmarkSymbol: data.benchmarkSymbol,
      benchmarkPct: evidenceResult.benchmarkPct,
      alphaPct: evidenceResult.alphaPct,
      maxDrawdown: evidenceResult.maxDrawdown,
      valuationCoverage: evidenceResult.valuationCoverage,
      reconciliationAmount: evidenceResult.reconciliationAmount,
    })
    const saved = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const existing = await txDb.portfolioReview.findFirst({
        where: { familyId: ctx.familyId, period: data.period, startDate },
      })
      const values = {
        authorId: ctx.memberId,
        authorName: ctx.memberName,
        period: data.period,
        status: data.status,
        note: data.note.trim(),
        metricsSnapshot,
        endDate,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
      }
      const record = existing
        ? await txDb.portfolioReview.update({
            where: { id: existing.id },
            data: values,
          })
        : await txDb.portfolioReview.create({
            data: {
              familyId: ctx.familyId,
              startDate,
              ...values,
            },
          })
      await audit(
        ctx,
        data.status === 'COMPLETED' ? 'COMPLETE' : 'SAVE_DRAFT',
        'PortfolioReview',
        record.id,
        `${data.period} · ${data.startDate} 至 ${data.endDate}`,
        txDb,
      )
      return record
    })
    revalidatePath('/review')
    return {
      ok: true,
      data: { id: saved.id, status: saved.status, updatedAt: saved.updatedAt.toISOString() },
    }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 会话 ----------

// 成员切换已由「账号密码登录 + 会话」取代（见 context/PLAN_AUTH_MOBILE.md），不再支持无密码切换身份

// ---------- 流水 ----------

export async function createTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = txInputSchema.parse(input)
    const { id: txId, affectedSince } = await auditedTransaction(prisma, ctx.familyId, (txDb) => createTransactionRecord(txDb, ctx, data))
    const warning = await refresh(ctx, affectedSince)
    return { ok: true, data: { id: txId }, warning }
  } catch (e) {
    return fail(e)
  }
}

/** 冲正：作废原流水及其结算腿，并留下 REVERSAL 标记流水 */
export async function reverseTransaction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const { affectedSince } = await auditedTransaction(prisma, ctx.familyId, (txDb) => reverseTransactionRecord(txDb, ctx, id))
    const warning = await refresh(ctx, affectedSince)
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
      await auditedTransaction(
        prisma,
        ctx.familyId,
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
      const affectedSince = valid.reduce(
        (earliest, r) => (r.tx && r.tx.occurredAt.getTime() < earliest.getTime() ? r.tx.occurredAt : earliest),
        new Date(),
      )
      const warning = await refresh(ctx, affectedSince)
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
    const acc = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    const moved = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    const asset = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    const liab = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    const entry = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const liability = await txDb.liability.findFirst({ where: { id: data.liabilityId, familyId: ctx.familyId } })
      if (!liability) throw new Error('负债不存在或不属于当前家庭')
      const created = await txDb.liabilityEntry.create({ data: { ...data, familyId: ctx.familyId } })
      await audit(ctx, 'CREATE', 'LiabilityEntry', created.id, `${data.type} ${data.amount}`, txDb)
      return created
    })
    const warning = await refresh(ctx, data.occurredAt)
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
    const goal = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    const entry = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
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
    // 保存当日汇率到 RateBar，保证历史快照按当日汇率折算可复现
    const fxWritten = await persistDailyFx(prisma, await fxRates(prisma))
    await rebuildSnapshots(prisma, ctx.familyId)
    await audit(ctx, 'REFRESH', 'PriceBar', null, `清理模拟K线 ${purged.count} 条；汇率 ${fxWritten} 条；` + results.map((r) => `${r.symbol}:${r.count}@${r.source}`).join(' '))
    revalidatePath('/')
    return { ok: true, data: results }
  } catch (e) {
    return fail(e)
  }
}
