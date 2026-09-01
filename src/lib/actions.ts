'use server'

// Server Actions：所有写操作入口 —— RLS 作用域 + 审计 + 快照重建
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSessionOrThrow } from './session'
import { auditedTransaction, recordAudit } from './audit'
import { rebuildSnapshots } from './snapshots'
import {
  accountInputSchema,
  accountReconciliationSchema,
  accountSettlementSchema,
  allocationTargetsInputSchema,
  assetInputSchema,
  assetUpdateSchema,
  cashPlanInputSchema,
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
import {
  persistFundHistory,
  persistHistory,
  purgeMisroutedFundBars,
  type PersistHistoryResult,
} from './market/persist'
import { backfillHistoricalFx, fxRates, persistDailyFx } from './market/fx'
import { fundNavQuoteOnDate } from './market/fund-nav'
import { dateKeyAt, previousCloseOnPortfolioDay } from './engine/watch-market'
import { type TransactionDraft } from './transaction-rules'
import { getReviewPageData } from './review-data'
import {
  cashSettlementOf,
  createTransactionRecord,
  correctEstimatedFundTransactionRecord,
  rebuildSnapshotsForFamily,
  reverseTransactionRecord,
  routedAccountIdForAsset,
  validateTransaction,
} from './services/transactions'
import { loadEngineState } from './queries'
import { summarizeAccountPositions } from './engine/account-summary'

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; warning?: string }
  | { ok: false; error: string }

// ---------- 组合计划（不写入交易账本） ----------

export async function saveAllocationTargets(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const data = allocationTargetsInputSchema.parse(input)
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      await txDb.allocationTarget.deleteMany({ where: { familyId: ctx.familyId } })
      await txDb.allocationTarget.createMany({
        data: data.targets.map((target) => ({ familyId: ctx.familyId, ...target })),
      })
      await audit(ctx, 'UPDATE', 'AllocationTarget', ctx.familyId, '更新资产大类目标配置', txDb)
    })
    revalidatePath('/allocation')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function createCashPlan(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = cashPlanInputSchema.parse(input)
    const plan = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      if (data.accountId) {
        const account = await txDb.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } })
        if (!account) throw new Error('所选账户不存在或不属于当前家庭')
      }
      const created = await txDb.cashPlan.create({
        data: { familyId: ctx.familyId, ...data },
      })
      await audit(ctx, 'CREATE', 'CashPlan', created.id, `${created.title} · ${created.direction}`, txDb)
      return created
    })
    revalidatePath('/accounts')
    return { ok: true, data: { id: plan.id } }
  } catch (e) {
    return fail(e)
  }
}

export async function deleteCashPlan(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const plan = await txDb.cashPlan.findFirst({ where: { id, familyId: ctx.familyId } })
      if (!plan) throw new Error('计划事项不存在')
      await txDb.cashPlan.delete({ where: { id } })
      await audit(ctx, 'DELETE', 'CashPlan', id, plan.title, txDb)
    })
    revalidatePath('/accounts')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/**
 * 记录外部账单与当前账本的核对凭证。凭证只追加审计证据，不直接调整资产或流水。
 */
export async function recordAccountReconciliation(input: unknown): Promise<ActionResult<{
  ledgerValueCny: number
  differenceCny: number
}>> {
  try {
    const ctx = await requireWrite()
    const data = accountReconciliationSchema.parse(input)
    const account = await prisma.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } })
    if (!account) throw new Error('账户不存在或不属于当前家庭')
    const state = await loadEngineState(ctx)
    const todayKey = dateKeyAt(new Date())
    if (data.asOfDate !== todayKey) throw new Error('当前版本仅支持核对今日账本，历史账单需先补齐当日行情后再开放')
    const positions = state.valued.filter((position) => position.accountId === account.id)
    const summary = summarizeAccountPositions(positions, (symbol) => {
      const quote = state.quotes.get(symbol)
      return previousCloseOnPortfolioDay(quote?.prevCloseCny, quote?.tradingDate, todayKey)
    })
    const ledgerValueCny = Math.round(summary.valueCny * 100) / 100
    const differenceCny = Math.round((data.observedValueCny - ledgerValueCny) * 100) / 100
    const detail = JSON.stringify({
      version: 1,
      accountName: account.name,
      asOfDate: data.asOfDate,
      observedValueCny: data.observedValueCny,
      ledgerValueCny,
      differenceCny,
      sourceName: data.sourceName,
      note: data.note,
    })
    await audit(ctx, 'RECONCILE', 'Account', account.id, detail)
    revalidatePath('/reconciliation')
    revalidatePath('/health')
    return { ok: true, data: { ledgerValueCny, differenceCny } }
  } catch (e) {
    return fail(e)
  }
}

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

/** 以成交净值日的官方净值替换估算基金流水；原流水通过冲正保留。 */
export async function confirmFundOfficialNav(id: string): Promise<ActionResult<{
  id: string
  oldPrice: number
  newPrice: number
  oldQuantity: number
  newQuantity: number
}>> {
  try {
    const ctx = await requireWrite()
    const original = await prisma.transaction.findFirst({
      where: { id, familyId: ctx.familyId, voidedAt: null },
      include: { asset: true },
    })
    if (!original?.navDate || original.asset.cls !== 'FUND' || original.navSource !== 'ESTIMATE') {
      throw new Error('该流水没有待确认的基金估算净值')
    }
    const quote = await fundNavQuoteOnDate(prisma, original.asset.symbol, dateKeyAt(original.navDate))
    if (!quote || quote.source !== 'EASTMONEY-FUND' || quote.kind !== 'OFFICIAL_NAV') {
      throw new Error('该成交日官方净值尚未取得，请刷新行情后重试')
    }
    const corrected = await auditedTransaction(prisma, ctx.familyId, (txDb) =>
      correctEstimatedFundTransactionRecord(txDb, ctx, id, quote.price),
    )
    const warning = await refresh(ctx, corrected.affectedSince)
    revalidatePath('/transactions')
    return { ok: true, data: corrected, warning }
  } catch (e) {
    return fail(e)
  }
}

/** 标记基金赎回结算已由用户按外部账单核对；不修改账本金额。 */
export async function confirmFundSettlement(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const original = await prisma.transaction.findFirst({
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
    const today = dateKeyAt(new Date())
    if (dateKeyAt(original.settlementDate) > today) throw new Error('预计到账日尚未到达，暂不能确认')
    const existing = await prisma.auditLog.findFirst({
      where: {
        familyId: ctx.familyId,
        action: 'FUND_SETTLEMENT_CONFIRMED',
        entity: 'Transaction',
        entityId: id,
      },
    })
    if (existing) return { ok: true }
    const settlementLeg = await prisma.transaction.findFirst({
      where: { familyId: ctx.familyId, settleOfId: id, voidedAt: null },
    })
    await audit(ctx, 'FUND_SETTLEMENT_CONFIRMED', 'Transaction', id, JSON.stringify({
      version: 1,
      assetName: original.asset.name,
      accountName: original.account.name,
      settlementDate: dateKeyAt(original.settlementDate),
      expectedAmount: settlementLeg ? Number(settlementLeg.amount) : Number(original.amount) - Number(original.fee),
    }))
    revalidatePath('/health')
    revalidatePath('/accounts')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ---------- CSV 导入 ----------

export async function importTransactions(
  rows: Record<string, string>[],
  settle = false,
  meta?: { sourceName?: string },
): Promise<ActionResult<{
  batchId: string
  imported: number
  failed: number
  errors: { row: number; errors: string[] }[]
  duplicateBatch: boolean
  totalAmount: number
  totalFees: number
}>> {
  try {
    const ctx = await requireWrite()
    if (rows.length > 2000) return { ok: false, error: '单次最多导入 2000 行，请拆分文件后重试' }
    const canonicalRows = rows.map((row) => Object.fromEntries(
      Object.entries(row)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key.trim(), String(value ?? '').trim()]),
    ))
    const contentHash = createHash('sha256')
      .update(JSON.stringify({ version: 1, settle, rows: canonicalRows }))
      .digest('hex')
    const existingBatch = await prisma.importBatch.findUnique({
      where: { familyId_contentHash: { familyId: ctx.familyId, contentHash } },
    })
    if (existingBatch) {
      return {
        ok: true,
        data: {
          batchId: existingBatch.id,
          imported: 0,
          failed: existingBatch.failedCount,
          errors: [],
          duplicateBatch: true,
          totalAmount: Number(existingBatch.totalAmount),
          totalFees: Number(existingBatch.totalFees),
        },
      }
    }
    const db = scopedDb(prisma, ctx)
    const [accounts, assets] = await Promise.all([db.account.findMany(), db.asset.findMany()])
    const lookup: CsvLookup = {
      accountByName: new Map(accounts.map((a) => [a.name, a.id])),
      assetBySymbol: new Map(assets.map((a) => [a.symbol.toUpperCase(), a.id])),
    }
    const parsed = parseCsvRows(rows, lookup)
    const valid = parsed.filter((r) => r.ok && r.tx)
    const failed = parsed.filter((r) => !r.ok).map((r) => ({ row: r.row, errors: r.errors }))
    const toCreate = valid.map((r) => ({ ...r.tx!, note: r.tx!.note }))
    const totalAmount = toCreate.reduce((sum, tx) => sum + tx.amount, 0)
    const totalFees = toCreate.reduce((sum, tx) => sum + tx.fee, 0)
    const batchId = await auditedTransaction(
        prisma,
        ctx.familyId,
        async (txDb) => {
          const batch = await txDb.importBatch.create({
            data: {
              familyId: ctx.familyId,
              contentHash,
              sourceName: meta?.sourceName?.trim().slice(0, 160) || null,
              rowCount: rows.length,
              importedCount: valid.length,
              failedCount: failed.length,
              settleCash: settle,
              totalAmount,
              totalFees,
              createdBy: ctx.memberId,
            },
          })
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
                importBatchId: batch.id,
              },
            })
            const needsSettlement = settle && ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE'].includes(entry.type)
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
                    importBatchId: batch.id,
                  },
                })
              }
            }
          }
          await audit(
            ctx,
            'IMPORT',
            'ImportBatch',
            batch.id,
            `CSV 导入 ${valid.length} 条，失败 ${failed.length} 条；金额 ${totalAmount.toFixed(2)}，费用 ${totalFees.toFixed(2)}${settle ? '（含现金结算）' : ''}`,
            txDb,
          )
          return batch.id
        },
        { timeout: 30_000 },
      )
    if (valid.length > 0) {
      const affectedSince = valid.reduce(
        (earliest, r) => (r.tx && r.tx.occurredAt.getTime() < earliest.getTime() ? r.tx.occurredAt : earliest),
        new Date(),
      )
      const warning = await refresh(ctx, affectedSince)
      return {
        ok: true,
        data: { batchId, imported: valid.length, failed: failed.length, errors: failed, duplicateBatch: false, totalAmount, totalFees },
        warning,
      }
    }
    return {
      ok: true,
      data: { batchId, imported: 0, failed: failed.length, errors: failed, duplicateBatch: false, totalAmount, totalFees },
    }
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

/**
 * 更新资产。已有流水后代码、类别、币种与估值方式构成账本语义，不可改写；
 * 名称、标签、介绍与投资风格不改变历史计算，始终可维护。
 */
export async function updateAsset(id: string, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const data = assetUpdateSchema.parse(input)
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const asset = await txDb.asset.findFirst({ where: { id, familyId: ctx.familyId } })
      if (!asset) throw new Error('资产不存在或不属于当前家庭')
      const transactionCount = await txDb.transaction.count({ where: { assetId: id, familyId: ctx.familyId } })
      const identityChanged = (
        (data.symbol != null && data.symbol !== asset.symbol)
        || (data.cls != null && data.cls !== asset.cls)
        || (data.currency != null && data.currency !== asset.currency)
        || (data.manual != null && data.manual !== asset.manual)
      )
      if (transactionCount > 0 && identityChanged) {
        throw new Error('该资产已绑定流水，代码、类别、币种和估值方式已锁定。如录入错误，请新建正确资产并冲正相关流水')
      }
      if (transactionCount === 0 && data.symbol != null && data.symbol !== asset.symbol) {
        const duplicate = await txDb.asset.findFirst({
          where: { familyId: ctx.familyId, symbol: data.symbol, id: { not: id } },
          select: { name: true },
        })
        if (duplicate) throw new Error(`代码 ${data.symbol} 已由资产“${duplicate.name}”使用`)
      }

      const patch: Record<string, unknown> = {
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.tags != null ? { tags: serializeTags(parseTags(data.tags)) } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
        ...(data.style !== undefined ? { style: data.style } : {}),
      }
      if (transactionCount === 0) {
        if (data.symbol != null) patch.symbol = data.symbol
        if (data.cls != null) patch.cls = data.cls
        if (data.currency != null) patch.currency = data.currency

        const nextClass = data.cls ?? asset.cls
        if (nextClass === 'REAL_ESTATE' || nextClass === 'HUAWEI_STOCK') {
          patch.manual = true
        } else if (nextClass === 'CASH') {
          patch.manual = false
        } else if (data.manual != null) {
          patch.manual = data.manual
        }
        if (!['STOCK', 'FUND', 'ETF'].includes(nextClass)) patch.style = null
      }

      await txDb.asset.update({ where: { id }, data: patch })
      await audit(ctx, 'UPDATE', 'Asset', id, JSON.stringify(patch), txDb)
    })
    revalidatePath(`/positions/${id}`)
    revalidatePath('/positions')
    revalidatePath('/accounts')
    revalidatePath('/health')
    revalidatePath('/allocation')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** 仅删除尚未产生任何流水的误建资产，避免级联删除破坏账本审计链。 */
export async function deleteAsset(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const asset = await txDb.asset.findFirst({ where: { id, familyId: ctx.familyId } })
      if (!asset) throw new Error('资产不存在或不属于当前家庭')
      const transactionCount = await txDb.transaction.count({ where: { assetId: id, familyId: ctx.familyId } })
      if (transactionCount > 0) {
        throw new Error(`该资产已有 ${transactionCount} 条流水，为保留完整账本和审计记录，不能删除`)
      }
      await txDb.asset.delete({ where: { id } })
      await audit(ctx, 'DELETE', 'Asset', id, `${asset.symbol} ${asset.name}`, txDb)
    })
    revalidatePath('/positions')
    revalidatePath('/accounts')
    revalidatePath('/health')
    revalidatePath('/allocation')
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
export async function refreshPrices(): Promise<ActionResult<PersistHistoryResult[]>> {
  try {
    const ctx = await requireWrite()
    const db = scopedDb(prisma, ctx)
    const [assets, earliestTransaction] = await Promise.all([
      db.asset.findMany({ where: { manual: false, cls: { notIn: ['CASH', 'REAL_ESTATE'] } } }),
      db.transaction.findFirst({ orderBy: { occurredAt: 'asc' } }),
    ])
    const from = earliestTransaction?.occurredAt ?? new Date(Date.now() - 800 * 86400000)
    // 清理历史遗留的模拟源 K 线（确定性模拟序列可由价格函数按需重现，无需落库；
    // 避免真实链路下被旧模拟数据优先命中）
    const purged = await prisma.priceBar.deleteMany({ where: { source: 'SIMULATED' } })
    // 基金资产落官方净值历史，其余走行情链路
    const fundSymbols = assets.filter((a) => a.cls === 'FUND').map((a) => a.symbol)
    const marketSymbols = [
      ...assets.filter((a) => a.cls !== 'FUND').map((a) => a.symbol),
      ...BENCHMARK_INDICES.map((index) => index.symbol),
    ]
    const purgedMisrouted = await purgeMisroutedFundBars(prisma, marketSymbols)
    const results = [
      ...(await persistFundHistory(prisma, fundSymbols, from, new Date())),
      ...(await persistHistory(prisma, marketSymbols, from, new Date(), { route: 'EXCHANGE' })),
    ]
    // 只有外币组合才请求汇率：ECB 补历史，新浪保存当日实时值。
    const hasForeignCurrency = assets.some((asset) => asset.currency === 'USD' || asset.currency === 'HKD')
    let fxBackfilled = 0
    let fxBackfillWarning: string | undefined
    if (hasForeignCurrency) {
      try {
        fxBackfilled = await backfillHistoricalFx(prisma, from)
      } catch (error) {
        fxBackfillWarning = `历史汇率回填失败：${error instanceof Error ? error.message : String(error)}`
      }
    }
    const fxWritten = hasForeignCurrency ? await persistDailyFx(prisma, await fxRates(prisma)) : 0
    await rebuildSnapshots(prisma, ctx.familyId)
    const failed = results.filter((result) => result.status === 'FAILED')
    await audit(
      ctx,
      'REFRESH',
      'PriceBar',
      null,
      `清理模拟K线 ${purged.count} 条、误路由场内净值 ${purgedMisrouted} 条；汇率回填 ${fxBackfilled} 条，当日 ${fxWritten} 条；`
        + results.map((r) => `${r.symbol}:${r.status}:${r.count}@${r.source}`).join(' '),
    )
    revalidatePath('/')
    const warnings = [
      fxBackfillWarning,
      failed.length > 0
        ? `${failed.length} 个标的历史行情刷新失败：${failed.map((item) => item.symbol).join('、')}`
        : undefined,
    ].filter((item): item is string => item != null)
    return { ok: true, data: results, warning: warnings.join('；') || undefined }
  } catch (e) {
    return fail(e)
  }
}

/** 安全重建派生快照：只重放流水与行情，不改变任何流水。 */
export async function rebuildDerivedSnapshots(): Promise<ActionResult<{ days: number }>> {
  try {
    const ctx = await requireWrite()
    const days = await rebuildSnapshots(prisma, ctx.familyId)
    await audit(ctx, 'REBUILD', 'Snapshot', null, `按当前账本与行情重建 ${days} 天派生快照`)
    for (const path of ['/', '/watch', '/accounts', '/review', '/health']) revalidatePath(path)
    return { ok: true, data: { days } }
  } catch (e) {
    return fail(e)
  }
}
