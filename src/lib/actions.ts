'use server'

// Server Actions：所有写操作入口 —— RLS 作用域 + 审计 + 快照重建
import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { ZodError } from 'zod'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSessionOrThrow } from './session'
import { describeZodError } from './validation-message'
import { isUniqueViolation, normalizeRequestKey, requestHashOf } from './idempotency'
import { auditedTransaction, recordAudit } from './audit'
import { rebuildSnapshots } from './snapshots'
import { scanSplitEvents } from './services/split-discovery'
import { applyConfirmedSplit } from './services/split-apply'
import type { SplitConfirmation } from './services/split-discovery'
import {
  accountInputSchema,
  accountReconciliationSchema,
  accountSettlementSchema,
  allocationTargetsInputSchema,
  assetInputSchema,
  assetUpdateSchema,
  cashPlanInputSchema,
  corporateActionInputSchema,
  goalInputSchema,
  goalScenarioSchema,
  goalScenarioPreviewSchema,
  goalUpdateSchema,
  fundTradePolicyInputSchema,
  investmentPlanInputSchema,
  investmentPlanBuysInputSchema,
  investmentPlanEditSchema,
  investmentPlanNoBuyWindowSchema,
  liabilityEntryInputSchema,
  liabilityInputSchema,
  portfolioReviewInputSchema,
  savingsEntryInputSchema,
  txInputSchema,
} from './schemas'
import { parseCsvRows, parsedTxKey, type CsvColumnMapping, type CsvLookup, type ParsedTx } from './csv'
import { buildSettlementLegs } from './engine/settlement'
import { createsSettlementCycle } from './engine/settlement-account'
import { parseTags, serializeTags } from './engine/groups'
import {
  persistFundHistory,
  persistHistory,
  purgeMisroutedFundBars,
  type PersistHistoryResult,
} from './market/persist'
import { backfillHistoricalFx, fxRates, persistDailyFx } from './market/fx'
import { dateKeyAt } from './engine/watch-market'
import { scheduledDatesInMonth } from './engine/investment-plan'
import { projectFireGoal } from './engine/projection'
import type { ClassWeights } from './engine/covariance'
import { fundSettlementDate, isQdiiFund } from './engine/fund-order'
import { type LedgerTx } from './engine/ledger'
import type { AssetInfo } from './engine/types'
import { compareProviderQuotes } from './market'
import { activeAssetIdsFromLedger, buildMarketRefreshPlan, type RefreshSlot } from './market/refresh-plan'
import { type TransactionDraft } from './transaction-rules'
import {
  cashSettlementOf,
  createTransactionRecord,
  rebuildSnapshotsForFamily,
  reverseTransactionRecord,
  routedAccountIdForAsset,
  validateTransaction,
} from './services/transactions'
import {
  confirmFundOfficialNavRecord,
  confirmFundSettlementRecord,
  previewFundOfficialNavRecord,
  type FundNavConfirmationPreview,
} from './services/fund-confirmations'
import { savePortfolioReviewRecord } from './services/reviews'
import { recordAccountReconciliationEvidence } from './services/reconciliation'
import { createCorporateActionRecord, reverseCorporateActionRecord } from './services/corporate-actions'
import { loadEngineState } from './queries'

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

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

export async function createInvestmentPlan(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = investmentPlanInputSchema.parse(input)
    const plan = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const assets = await txDb.asset.findMany({
        where: { familyId: ctx.familyId, id: { in: data.assetIds } },
        orderBy: { symbol: 'asc' },
      })
      if (assets.length !== data.assetIds.length) throw new Error('部分执行资产不存在或不属于当前家庭')
      const invalid = assets.filter((asset) => !['STOCK', 'FUND', 'ETF', 'GOLD'].includes(asset.cls))
      if (invalid.length > 0) throw new Error('定投计划只支持股票、基金、ETF 或黄金')
      const currencies = new Set(assets.map((asset) => asset.currency))
      if (currencies.size !== 1) throw new Error('同一计划的候选资产必须使用相同币种')
      const currency = assets[0].currency

      let accountName = '全部账户'
      if (data.accountId) {
        const account = await txDb.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } })
        if (!account) throw new Error('所选账户不存在或不属于当前家庭')
        if (account.currency !== currency) throw new Error('计划账户与候选资产的币种必须一致')
        accountName = account.name
      }

      const occupied = await txDb.investmentPlanAsset.findMany({
        where: {
          familyId: ctx.familyId,
          assetId: { in: data.assetIds },
          plan: {
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
          },
        },
        include: { asset: true, plan: true },
      })
      if (occupied.length > 0) {
        const conflict = occupied[0]
        throw new Error(`${conflict.asset.symbol} 已属于有效计划「${conflict.plan.name}」，请先结束原计划`)
      }

      const created = await txDb.investmentPlan.create({
        data: {
          familyId: ctx.familyId,
          accountId: data.accountId,
          name: data.name,
          amount: data.amount,
          currency,
          cadence: data.cadence,
          scheduleDay: data.scheduleDay,
          startDate: data.startDate,
          endDate: data.endDate,
          note: data.note,
        },
      })
      await txDb.investmentPlanAsset.createMany({
        data: assets.map((asset) => ({
          familyId: ctx.familyId,
          planId: created.id,
          assetId: asset.id,
        })),
      })
      await audit(
        ctx,
        'CREATE',
        'InvestmentPlan',
        created.id,
        `${created.name} · ${created.cadence} · ${created.amount} ${currency} · ${accountName} · ${assets.map((asset) => asset.symbol).join(',')}`,
        txDb,
      )
      return created
    })
    revalidatePath('/investment-plans')
    revalidatePath('/accounts')
    return { ok: true, data: { id: plan.id } }
  } catch (e) {
    return fail(e)
  }
}

/** 编辑计划：ADR-028 —— 只影响未来计划节点，历史流水与未买证据不动。 */
export async function updateInvestmentPlan(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = investmentPlanEditSchema.parse(input)
    const summary = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const plan = await txDb.investmentPlan.findFirst({
        where: { id: data.id, familyId: ctx.familyId },
        include: { assets: true, account: true },
      })
      if (!plan) throw new Error('定投计划不存在')

      const assets = await txDb.asset.findMany({
        where: { familyId: ctx.familyId, id: { in: data.assetIds } },
        orderBy: { symbol: 'asc' },
      })
      if (assets.length !== data.assetIds.length) throw new Error('部分执行资产不存在或不属于当前家庭')
      const invalid = assets.filter((asset) => !['STOCK', 'FUND', 'ETF', 'GOLD'].includes(asset.cls))
      if (invalid.length > 0) throw new Error('定投计划只支持股票、基金、ETF 或黄金')
      const currencies = new Set(assets.map((asset) => asset.currency))
      if (currencies.size !== 1) throw new Error('同一计划的候选资产必须使用相同币种')
      const currency = assets[0].currency

      let accountName = '全部账户'
      if (data.accountId) {
        const account = await txDb.account.findFirst({ where: { id: data.accountId, familyId: ctx.familyId } })
        if (!account) throw new Error('所选账户不存在或不属于当前家庭')
        if (account.currency !== currency) throw new Error('计划账户与候选资产的币种必须一致')
        accountName = account.name
      }

      // 资产占用冲突：排除本计划自身
      const occupied = await txDb.investmentPlanAsset.findMany({
        where: {
          familyId: ctx.familyId,
          assetId: { in: data.assetIds },
          planId: { not: plan.id },
          plan: { status: 'ACTIVE', OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
        },
        include: { asset: true, plan: true },
      })
      if (occupied.length > 0) {
        const conflict = occupied[0]
        throw new Error(`${conflict.asset.symbol} 已属于有效计划「${conflict.plan.name}」，请先结束原计划`)
      }

      const changes = [
        plan.name !== data.name ? `名称 ${plan.name} → ${data.name}` : null,
        Number(plan.amount) !== data.amount ? `每期 ${Number(plan.amount)} → ${data.amount}` : null,
        plan.cadence !== data.cadence ? `节奏 ${plan.cadence} → ${data.cadence}` : null,
        plan.scheduleDay !== data.scheduleDay ? `执行日 ${plan.scheduleDay ?? '—'} → ${data.scheduleDay ?? '—'}` : null,
        plan.accountId !== data.accountId ? `账户 ${plan.account?.name ?? '全部'} → ${accountName}` : null,
      ].filter((item): item is string => item != null)
      const assetChanged = plan.assets.map((item) => item.assetId).sort().join(',') !== assets.map((asset) => asset.id).sort().join(',')
      const detail = `${data.name} · ${changes.length > 0 ? changes.join('；') : '仅更新说明'}${assetChanged ? '；候选资产已更新' : ''}`
        + `\n历史流水与已核对证据不变；新节奏自 ${data.startDate.toISOString().slice(0, 10)} 起生效`

      await txDb.investmentPlan.update({
        where: { id: plan.id },
        data: {
          name: data.name,
          amount: data.amount,
          currency,
          cadence: data.cadence,
          scheduleDay: data.scheduleDay,
          startDate: data.startDate,
          endDate: data.endDate,
          accountId: data.accountId,
          note: data.note,
        },
      })
      if (assetChanged) {
        await txDb.investmentPlanAsset.deleteMany({ where: { planId: plan.id } })
        await txDb.investmentPlanAsset.createMany({
          data: assets.map((asset) => ({ familyId: ctx.familyId, planId: plan.id, assetId: asset.id })),
        })
      }
      await audit(ctx, 'UPDATE', 'InvestmentPlan', plan.id, detail, txDb)
      return detail
    })
    void summary
    revalidatePath('/investment-plans')
    revalidatePath('/accounts')
    revalidatePath('/month-close')
    return { ok: true, data: { id: data.id } }
  } catch (e) {
    return fail(e)
  }
}

export async function endInvestmentPlan(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const plan = await txDb.investmentPlan.findFirst({ where: { id, familyId: ctx.familyId } })
      if (!plan) throw new Error('定投计划不存在')
      if (plan.status === 'ENDED') return
      const endedAt = new Date()
      await txDb.investmentPlan.update({
        where: { id },
        data: { status: 'ENDED', endedAt },
      })
      await audit(ctx, 'UPDATE', 'InvestmentPlan', id, `${plan.name} · 结束计划`, txDb)
    })
    revalidatePath('/investment-plans')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/** 同日核对：已买入才写账本；未买入只保存可撤销的计划层证据。 */
export async function recordInvestmentPlanBuys(input: unknown): Promise<ActionResult<{ count: number; noBuyCount: number }>> {
  try {
    const ctx = await requireWrite()
    const data = investmentPlanBuysInputSchema.parse(input)
    const today = dateKeyAt(new Date())
    const result = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      let affectedSinceMs = Infinity
      for (const buy of data.buys) {
        const occurredAt = new Date(`${buy.date}T12:00:00+08:00`)
        const navDate = new Date(`${buy.navDate}T12:00:00+08:00`)
        if (dateKeyAt(occurredAt) !== buy.date || dateKeyAt(navDate) !== buy.navDate) {
          throw new Error('申购日期或成交净值日无效')
        }
        if (buy.date > today) throw new Error('未来计划节点不能录为已发生申购')
        if (buy.navDate < buy.date || navDate.getTime() - occurredAt.getTime() > 7 * 86400000) {
          throw new Error('成交净值日需在申购日之后七天内，请核对平台记录')
        }
        const plan = await txDb.investmentPlan.findFirst({
          where: { id: buy.planId, familyId: ctx.familyId },
          include: { account: true, assets: { include: { asset: true } } },
        })
        if (!plan || !plan.accountId || !plan.account || plan.assets.length !== 1) {
          throw new Error('快速录入只支持已限定账户且关联单只基金的计划')
        }
        const asset = plan.assets[0].asset
        if (asset.cls !== 'FUND' || asset.currency !== plan.currency || plan.account.currency !== asset.currency) {
          throw new Error('计划基金与交易账户不匹配')
        }
        const scheduled = scheduledDatesInMonth(buy.date.slice(0, 7), {
          id: plan.id,
          name: plan.name,
          amount: Number(plan.amount),
          currency: plan.currency,
          cadence: plan.cadence,
          scheduleDay: plan.scheduleDay,
          startDate: plan.startDate,
          endDate: plan.endDate,
          status: plan.status,
          endedAt: plan.endedAt,
          accountId: plan.accountId,
          assetIds: [asset.id],
        }).some((date) => dateKeyAt(date) === buy.date)
        if (!scheduled) throw new Error(`${plan.name} 在 ${buy.date} 没有有效计划节点`)
        const dayStart = new Date(`${buy.date}T00:00:00+08:00`)
        const dayEnd = new Date(dayStart.getTime() + 86400000)
        const existing = await txDb.transaction.findFirst({
          where: {
            familyId: ctx.familyId,
            accountId: plan.accountId,
            assetId: asset.id,
            type: 'BUY',
            voidedAt: null,
            occurredAt: { gte: dayStart, lt: dayEnd },
          },
        })
        if (existing) throw new Error(`${plan.account.name} · ${asset.name} 在 ${buy.date} 已有有效买入流水，未重复录入`)
        const txData = txInputSchema.parse({
          accountId: plan.accountId,
          assetId: asset.id,
          type: 'BUY',
          quantity: null,
          price: null,
          amount: buy.amount,
          fee: buy.fee,
          occurredAt,
          navDate,
          navSource: 'PENDING',
          note: '定投管理快速录入 · 实际申购由用户核对；份额待确认',
          settleCash: true,
        })
        await createTransactionRecord(txDb, ctx, txData)
        affectedSinceMs = Math.min(affectedSinceMs, occurredAt.getTime())
      }
      for (const item of data.noBuy) {
        const scheduledDate = new Date(`${item.date}T12:00:00+08:00`)
        if (dateKeyAt(scheduledDate) !== item.date || item.date > today) {
          throw new Error('未来或无效的计划日不能确认未买入')
        }
        const plan = await txDb.investmentPlan.findFirst({
          where: { id: item.planId, familyId: ctx.familyId },
          include: { account: true, assets: { include: { asset: true } } },
        })
        if (!plan || !plan.accountId || !plan.account || plan.assets.length !== 1) {
          throw new Error('未买入确认只支持已限定账户且关联单只基金的计划')
        }
        const asset = plan.assets[0].asset
        if (asset.cls !== 'FUND' || asset.currency !== plan.currency || plan.account.currency !== asset.currency) {
          throw new Error('计划基金与交易账户不匹配')
        }
        const scheduled = scheduledDatesInMonth(item.date.slice(0, 7), {
          id: plan.id,
          name: plan.name,
          amount: Number(plan.amount),
          currency: plan.currency,
          cadence: plan.cadence,
          scheduleDay: plan.scheduleDay,
          startDate: plan.startDate,
          endDate: plan.endDate,
          status: plan.status,
          endedAt: plan.endedAt,
          accountId: plan.accountId,
          assetIds: [asset.id],
        }).some((date) => dateKeyAt(date) === item.date)
        if (!scheduled) throw new Error(`${plan.name} 在 ${item.date} 没有有效计划节点`)
        const dayStart = new Date(`${item.date}T00:00:00+08:00`)
        const existingBuy = await txDb.transaction.findFirst({
          where: {
            familyId: ctx.familyId,
            accountId: plan.accountId,
            assetId: asset.id,
            type: 'BUY',
            voidedAt: null,
            occurredAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400000) },
          },
        })
        if (existingBuy) throw new Error(`${plan.account.name} · ${asset.name} 在 ${item.date} 已有有效买入，不能确认未买入`)
        const existingReview = await txDb.investmentPlanDayReview.findUnique({
          where: { planId_scheduledDate: { planId: plan.id, scheduledDate } },
        })
        if (existingReview && !existingReview.revokedAt) {
          throw new Error(`${plan.name} 在 ${item.date} 已确认未买入，无需重复提交`)
        }
        const review = existingReview
          ? await txDb.investmentPlanDayReview.update({
            where: { id: existingReview.id },
            data: { reviewedAt: new Date(), revokedAt: null },
          })
          : await txDb.investmentPlanDayReview.create({
            data: { familyId: ctx.familyId, planId: plan.id, scheduledDate },
          })
        await audit(ctx, existingReview ? 'UPDATE' : 'CREATE', 'InvestmentPlanDayReview', review.id, `${plan.name} · ${item.date} · 已核对未买入`, txDb)
      }
      return {
        count: data.buys.length,
        noBuyCount: data.noBuy.length,
        affectedSince: Number.isFinite(affectedSinceMs) ? new Date(affectedSinceMs) : null,
      }
    }, { timeout: 60000 })
    const warning = result.affectedSince ? await refresh(ctx, result.affectedSince) : undefined
    revalidatePath('/investment-plans')
    revalidatePath('/transactions')
    revalidatePath('/fund-confirmations')
    revalidatePath('/health')
    revalidatePath('/accounts')
    revalidatePath('/month-close')
    revalidatePath('/review')
    return { ok: true, data: { count: result.count, noBuyCount: result.noBuyCount }, warning }
  } catch (e) {
    return fail(e)
  }
}

/**
 * 区间未买：一次确认连续日期区间内没有执行，只写可撤销的计划层证据。
 * 与逐日核对同一口径（ADR-026）：不改现金、持仓、收益、计划额；已有有效 BUY 或已核对的节点跳过并如实报告。
 */
export async function recordInvestmentPlanNoBuyWindow(
  input: unknown,
): Promise<ActionResult<{ count: number; created: number; refreshed: number; skipped: number }>> {
  try {
    const ctx = await requireWrite()
    const data = investmentPlanNoBuyWindowSchema.parse(input)
    const today = dateKeyAt(new Date())
    if (data.to > today) throw new Error('未到期的计划日不能确认未买入')

    const result = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const plans = await txDb.investmentPlan.findMany({
        where: { id: { in: data.planIds }, familyId: ctx.familyId },
        include: { assets: { include: { asset: true } } },
      })
      if (plans.length !== data.planIds.length) throw new Error('部分计划不存在或不属于当前家庭')

      let created = 0
      let refreshed = 0
      let skipped = 0
      for (const plan of plans) {
        const enginePlan = {
          id: plan.id,
          name: plan.name,
          amount: Number(plan.amount),
          currency: plan.currency,
          cadence: plan.cadence,
          scheduleDay: plan.scheduleDay,
          startDate: plan.startDate,
          endDate: plan.endDate,
          status: plan.status,
          endedAt: plan.endedAt,
          accountId: plan.accountId,
          assetIds: plan.assets.map((item) => item.assetId),
        }
        const dates = scheduledDatesInMonth(data.from.slice(0, 7), enginePlan)
          .filter((date) => dateKeyAt(date) >= data.from && dateKeyAt(date) <= data.to)
        for (const date of dates) {
          const dayKey = dateKeyAt(date)
          if (dayKey > today) { skipped++; continue }
          const scheduledDate = new Date(`${dayKey}T12:00:00+08:00`)
          const dayStart = new Date(`${dayKey}T00:00:00+08:00`)
          const dayEnd = new Date(dayStart.getTime() + 86400000)
          // 账本已有有效买入（同一候选资产 + 计划限定账户）时不能标未买，如实跳过
          const existingBuy = await txDb.transaction.findFirst({
            where: {
              familyId: ctx.familyId,
              assetId: { in: plan.assets.map((item) => item.assetId) },
              ...(plan.accountId ? { accountId: plan.accountId } : {}),
              type: 'BUY',
              voidedAt: null,
              occurredAt: { gte: dayStart, lt: dayEnd },
            },
          })
          if (existingBuy) { skipped++; continue }
          const existingReview = await txDb.investmentPlanDayReview.findUnique({
            where: { planId_scheduledDate: { planId: plan.id, scheduledDate } },
          })
          if (existingReview && !existingReview.revokedAt) { skipped++; continue }
          const review = existingReview
            ? await txDb.investmentPlanDayReview.update({
              where: { id: existingReview.id },
              data: { reviewedAt: new Date(), revokedAt: null },
            })
            : await txDb.investmentPlanDayReview.create({
              data: { familyId: ctx.familyId, planId: plan.id, scheduledDate },
            })
          if (existingReview) refreshed++
          else created++
          await audit(ctx, existingReview ? 'UPDATE' : 'CREATE', 'InvestmentPlanDayReview', review.id, `${plan.name} · ${dayKey} · 区间确认未买入`, txDb)
        }
      }
      return { count: created + refreshed, created, refreshed, skipped }
    }, { timeout: 60000 })

    revalidatePath('/investment-plans')
    revalidatePath('/month-close')
    return { ok: true, data: result }
  } catch (e) {
    return fail(e)
  }
}

export async function revokeInvestmentPlanNoBuyReview(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const review = await txDb.investmentPlanDayReview.findFirst({
        where: { id, familyId: ctx.familyId },
        include: { plan: true },
      })
      if (!review) throw new Error('未买入核对记录不存在')
      if (review.revokedAt) throw new Error('该未买入核对已撤销')
      await txDb.investmentPlanDayReview.update({ where: { id }, data: { revokedAt: new Date() } })
      await audit(ctx, 'UPDATE', 'InvestmentPlanDayReview', id, `${review.plan.name} · ${dateKeyAt(review.scheduledDate)} · 撤销未买入核对`, txDb)
    })
    revalidatePath('/investment-plans')
    revalidatePath('/month-close')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 基金交易规则 ----------

export async function saveFundTradePolicy(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = fundTradePolicyInputSchema.parse(input)
    const saved = await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const asset = await txDb.asset.findFirst({ where: { id: data.assetId, familyId: ctx.familyId, cls: 'FUND' } })
      if (!asset) throw new Error('所选资产不是当前家庭的场外基金')
      const values = {
        purchaseFeeRate: data.purchaseFeeRate,
        redemptionFeeRules: JSON.stringify([...data.redemptionFeeRules].sort((a, b) => a.maxHoldingDays - b.maxHoldingDays)),
        purchaseSuspendedFrom: data.purchaseSuspendedFrom,
        purchaseSuspendedUntil: data.purchaseSuspendedUntil,
        sourceName: data.sourceName,
        sourceReference: data.sourceReference || null,
        note: data.note || null,
      }
      const existing = await txDb.fundTradePolicy.findFirst({ where: { familyId: ctx.familyId, assetId: asset.id } })
      const policy = existing
        ? await txDb.fundTradePolicy.update({ where: { id: existing.id }, data: values })
        : await txDb.fundTradePolicy.create({ data: { familyId: ctx.familyId, assetId: asset.id, ...values } })
      await audit(ctx, existing ? 'UPDATE' : 'CREATE', 'FundTradePolicy', policy.id, `${asset.symbol} ${asset.name} · ${data.sourceName}`, txDb)
      return policy
    })
    revalidatePath('/fund-operations')
    revalidatePath('/transactions')
    revalidatePath(`/positions/${data.assetId}`)
    return { ok: true, data: { id: saved.id } }
  } catch (e) {
    return fail(e)
  }
}

export async function deleteFundTradePolicy(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      const policy = await txDb.fundTradePolicy.findFirst({
        where: { id, familyId: ctx.familyId },
        include: { asset: true },
      })
      if (!policy) throw new Error('基金规则不存在')
      await txDb.fundTradePolicy.delete({ where: { id } })
      await audit(ctx, 'DELETE', 'FundTradePolicy', id, `${policy.asset.symbol} ${policy.asset.name}`, txDb)
    })
    revalidatePath('/fund-operations')
    revalidatePath('/transactions')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 公司行动账本 ----------

export async function checkSplitAnnouncements(): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const scan = await scanSplitEvents(prisma, ctx)
    revalidatePath('/corporate-actions')
    return { ok: true, warning: scan.errors.length ? `${scan.errors.length} 个标的检查失败，请查看详情` : undefined }
  } catch (error) { return fail(error) }
}

export async function confirmDiscoveredSplit(input: SplitConfirmation): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const result = await applyConfirmedSplit(prisma, ctx, input)
    for (const path of ['/corporate-actions', '/transactions', '/positions', '/watch', '/review', '/', '/health']) revalidatePath(path)
    return { ok: true, warning: result.warning }
  } catch (error) { return fail(error) }
}

export async function createCorporateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWrite()
    const data = corporateActionInputSchema.parse(input)
    const created = await auditedTransaction(prisma, ctx.familyId, async (txDb) => (
      createCorporateActionRecord(txDb, ctx, data)
    ), { timeout: 30_000 })
    const warning = await rebuildSnapshotsForFamily(prisma, ctx.familyId, created.affectedSince)
    for (const path of ['/corporate-actions', '/transactions', '/positions', '/watch', '/review', '/', '/health']) {
      revalidatePath(path)
    }
    return { ok: true, data: { id: created.id }, warning }
  } catch (e) {
    return fail(e)
  }
}

export async function reverseCorporateAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    const reversed = await auditedTransaction(prisma, ctx.familyId, async (txDb) => (
      reverseCorporateActionRecord(txDb, ctx, id)
    ), { timeout: 30_000 })
    const warning = await rebuildSnapshotsForFamily(prisma, ctx.familyId, reversed.affectedSince)
    for (const path of ['/corporate-actions', '/transactions', '/positions', '/watch', '/review', '/', '/health']) {
      revalidatePath(path)
    }
    return { ok: true, warning }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 行情源质量 ----------

export async function runMarketQualityCheck(): Promise<ActionResult<{
  checked: number
  comparable: number
  divergent: number
  failed: number
}>> {
  try {
    const ctx = await requireWrite()
    const state = await loadEngineState(ctx)
    const byAsset = new Map<string, { id: string; symbol: string; name: string; cls: 'STOCK' | 'ETF' | 'FUND'; value: number }>()
    for (const position of state.valued) {
      if (!['STOCK', 'ETF', 'FUND'].includes(position.asset.cls) || position.quantity <= 1e-9) continue
      const current = byAsset.get(position.assetId)
      const value = Math.abs(position.value)
      if (current) current.value += value
      else byAsset.set(position.assetId, {
        id: position.assetId,
        symbol: position.asset.symbol,
        name: position.asset.name,
        cls: position.asset.cls as 'STOCK' | 'ETF' | 'FUND',
        value,
      })
    }
    const subjects = [...byAsset.values()].sort((a, b) => b.value - a.value).slice(0, 20)
    const rows: Array<{
      assetId: string
      symbol: string
      name: string
      cls: string
      sources: Awaited<ReturnType<typeof compareProviderQuotes>>
      spreadBps: number | null
    }> = []
    for (let offset = 0; offset < subjects.length; offset += 4) {
      const batch = subjects.slice(offset, offset + 4)
      rows.push(...await Promise.all(batch.map(async (asset) => {
        const sources = await compareProviderQuotes(asset.symbol, { route: asset.cls === 'FUND' ? 'FUND' : 'AUTO' })
        const prices = sources.flatMap((source) => source.status === 'OK' && source.price != null ? [source.price] : [])
        const spreadBps = prices.length >= 2
          ? Math.round(((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 1_000_000) / 100
          : null
        return { assetId: asset.id, symbol: asset.symbol, name: asset.name, cls: asset.cls, sources, spreadBps }
      })))
    }
    const summary = {
      checked: rows.length,
      comparable: rows.filter((row) => row.spreadBps != null).length,
      divergent: rows.filter((row) => row.spreadBps != null && row.spreadBps > 30).length,
      failed: rows.filter((row) => !row.sources.some((source) => source.status === 'OK')).length,
    }
    await auditedTransaction(prisma, ctx.familyId, async (txDb) => {
      await audit(ctx, 'MARKET_QUALITY_CHECK', 'MarketProvider', ctx.familyId, JSON.stringify({
        version: 1,
        checkedAt: new Date().toISOString(),
        thresholdBps: 30,
        summary,
        rows,
      }), txDb)
    })
    revalidatePath('/health/market')
    revalidatePath('/health')
    return { ok: true, data: summary }
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
    const result = await recordAccountReconciliationEvidence(prisma, ctx, data)
    revalidatePath('/reconciliation')
    revalidatePath('/health')
    return { ok: true, data: result }
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
  // 校验失败不能把 ZodError 的 JSON 原文交给用户
  if (e instanceof ZodError) {
    const { text, fieldErrors } = describeZodError(e)
    return { ok: false, error: text, fieldErrors }
  }
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
  // 账本写入后必须同时失效流水页的客户端路由缓存，否则刷新可能被去重而留下已作废行
  revalidatePath('/transactions')
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
    const saved = await savePortfolioReviewRecord(prisma, ctx, data)
    revalidatePath('/review')
    return {
      ok: true,
      data: saved,
    }
  } catch (e) {
    return fail(e)
  }
}

// ---------- 会话 ----------

// 成员切换已由「账号密码登录 + 会话」取代（见 context/PLAN_AUTH_MOBILE.md），不再支持无密码切换身份

// ---------- 流水 ----------

export async function createTransaction(
  input: unknown,
  clientRequestKey?: string,
): Promise<ActionResult<{ id: string; replayed: boolean }>> {
  try {
    const ctx = await requireWrite()
    const data = txInputSchema.parse(input)
    // 幂等键复用 APP 写入通道的语义：同键同体视为重放，同键异体拒绝
    const requestKey = normalizeRequestKey(clientRequestKey)
    const requestHash = requestKey ? requestHashOf(data) : null
    if (requestKey) {
      const existing = await prisma.transaction.findFirst({
        where: { familyId: ctx.familyId, clientRequestId: requestKey },
        select: { id: true, clientRequestHash: true },
      })
      if (existing) {
        if (existing.clientRequestHash !== requestHash) {
          return { ok: false, error: '这次提交已在账本中记录过，但内容与本次不同；请刷新页面后重新录入' }
        }
        return { ok: true, data: { id: existing.id, replayed: true } }
      }
    }
    try {
      const { id: txId, affectedSince } = await auditedTransaction(prisma, ctx.familyId, (txDb) =>
        createTransactionRecord(txDb, ctx, data, {
          clientRequestId: requestKey ?? undefined,
          clientRequestHash: requestHash ?? undefined,
        }),
      )
      const warning = await refresh(ctx, affectedSince)
      return { ok: true, data: { id: txId, replayed: false }, warning }
    } catch (e) {
      // 并发重复提交撞唯一约束时按重放处理，不向用户报错
      if (requestKey && isUniqueViolation(e)) {
        const existing = await prisma.transaction.findFirst({
          where: { familyId: ctx.familyId, clientRequestId: requestKey },
          select: { id: true, clientRequestHash: true },
        })
        if (existing?.clientRequestHash === requestHash) {
          return { ok: true, data: { id: existing.id, replayed: true } }
        }
      }
      throw e
    }
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
export async function previewFundOfficialNav(id: string): Promise<ActionResult<FundNavConfirmationPreview>> {
  try {
    const ctx = await getSessionOrThrow()
    const preview = await previewFundOfficialNavRecord(prisma, ctx, id)
    return { ok: true, data: preview }
  } catch (e) {
    return fail(e)
  }
}

/** 用户核对平台份额后，以成交日官方净值替换原流水；原流水通过冲正保留。 */
export async function confirmFundOfficialNav(id: string, confirmedQuantity?: number): Promise<ActionResult<{
  id: string
  oldPrice: number
  newPrice: number
  oldQuantity: number
  newQuantity: number
}>> {
  try {
    const ctx = await requireWrite()
    const { warning, ...corrected } = await confirmFundOfficialNavRecord(prisma, ctx, id, confirmedQuantity)
    revalidatePath('/transactions')
    revalidatePath('/fund-confirmations')
    revalidatePath('/health')
    revalidatePath('/')
    return { ok: true, data: corrected, warning }
  } catch (e) {
    return fail(e)
  }
}

/** 标记基金赎回结算已由用户按外部账单核对；不修改账本金额。 */
export async function confirmFundSettlement(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireWrite()
    await confirmFundSettlementRecord(prisma, ctx, id)
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
  meta?: { sourceName?: string; mapping?: CsvColumnMapping },
): Promise<ActionResult<{
  batchId: string
  imported: number
  failed: number
  duplicates: number
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
          duplicates: existingBatch.duplicateCount,
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
    const validCandidates = parsed.filter((r): r is typeof r & { tx: ParsedTx } => r.ok && r.tx != null)
    const failed = parsed.filter((r) => !r.ok).map((r) => ({ row: r.row, errors: r.errors }))
    const dateTimes = validCandidates.map((row) => row.tx.occurredAt.getTime())
    const existingRows = dateTimes.length === 0 ? [] : await prisma.transaction.findMany({
      where: {
        familyId: ctx.familyId,
        occurredAt: { gte: new Date(Math.min(...dateTimes)), lte: new Date(Math.max(...dateTimes)) },
        voidedAt: null,
        internal: false,
        type: { not: 'REVERSAL' },
      },
    })
    const knownKeys = new Set(existingRows.map((tx) => parsedTxKey({
      accountId: tx.accountId,
      assetId: tx.assetId,
      type: tx.type,
      quantity: tx.quantity == null ? null : Number(tx.quantity),
      price: tx.price == null ? null : Number(tx.price),
      amount: Number(tx.amount),
      fee: Number(tx.fee),
      occurredAt: tx.occurredAt,
      note: tx.note,
    })))
    const seenKeys = new Set<string>()
    const duplicates: { row: number; reason: string }[] = []
    const valid = validCandidates.filter((row) => {
      const key = parsedTxKey(row.tx)
      if (knownKeys.has(key) || seenKeys.has(key)) {
        duplicates.push({ row: row.row, reason: knownKeys.has(key) ? '账本已有相同流水' : '文件内重复行' })
        return false
      }
      seenKeys.add(key)
      return true
    })
    const toCreate = valid.map((r) => ({
      ...r.tx,
      note: r.tx.note,
      importRowHash: createHash('sha256').update(parsedTxKey(r.tx)).digest('hex'),
    }))
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
              duplicateCount: duplicates.length,
              settleCash: settle,
              totalAmount,
              totalFees,
              issuesJson: JSON.stringify({ failed, duplicates }),
              mappingJson: JSON.stringify(meta?.mapping ?? {}),
              createdBy: ctx.memberId,
            },
          })
          for (const tx of toCreate) {
            const accountId = await routedAccountIdForAsset(txDb, ctx.familyId, tx.accountId, tx.assetId)
            const entry = { ...tx, accountId }
            const validated = await validateTransaction(txDb, ctx, { ...entry, type: entry.type as TransactionDraft['type'] })
            const settlementDate = entry.type === 'SELL' && validated.asset.cls === 'FUND' && validated.navDate
              ? fundSettlementDate(validated.navDate, { qdii: isQdiiFund(validated.asset.symbol, validated.asset.name) })
              : null
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
                navDate: validated.navDate,
                settlementDate,
                note: tx.note,
                importRowHash: tx.importRowHash,
                importBatchId: batch.id,
              },
            })
            const needsSettlement = settle && ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE'].includes(entry.type)
            const settlement = needsSettlement ? await cashSettlementOf(txDb, ctx.familyId, entry.accountId) : null
            if (needsSettlement && !settlement) {
              throw new Error('CSV 中存在未配置资金账户的交易账户；请先完成账户配置，或关闭现金联动结算')
            }
            if (settlement) {
              const legs = buildSettlementLegs(entry as ParsedTx, settlement.cashAssetId, settlement.accountId, {
                settleAt: settlementDate ?? undefined,
              })
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
            `CSV 导入 ${valid.length} 条，重复 ${duplicates.length} 条，失败 ${failed.length} 条；金额 ${totalAmount.toFixed(2)}，费用 ${totalFees.toFixed(2)}${settle ? '（含现金结算）' : ''}`,
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
        data: { batchId, imported: valid.length, failed: failed.length, duplicates: duplicates.length, errors: failed, duplicateBatch: false, totalAmount, totalFees },
        warning,
      }
    }
    return {
      ok: true,
      data: { batchId, imported: 0, failed: failed.length, duplicates: duplicates.length, errors: failed, duplicateBatch: false, totalAmount, totalFees },
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

/**
 * FIRE 情景预览：不写库、不取行情，直接用与页面同源的引擎输入重算候选方案。
 * 这样“预览值”与“应用后的引擎值”必然一致，不会出现两套模型两个答案。
 */
export async function previewGoalScenario(input: unknown): Promise<ActionResult<{
  accumulationSuccessProb: number
  projectedMedian: number
  fireNumberAtRetirement: number
  fundedRatio: number
}>> {
  try {
    await getSessionOrThrow()
    const data = goalScenarioPreviewSchema.parse(input)
    const projection = projectFireGoal({
      ...data.base,
      portfolioWeights: data.base.portfolioWeights as ClassWeights | undefined,
      monthlyContribution: data.monthlyContribution,
      monthsToRetirement: data.base.monthsToRetirement + data.delayMonths,
    })
    return {
      ok: true,
      data: {
        accumulationSuccessProb: projection.accumulationSuccessProb,
        projectedMedian: projection.projectedMedian,
        fireNumberAtRetirement: projection.fireNumberAtRetirement,
        fundedRatio: projection.fundedRatio,
      },
    }
  } catch (e) {
    return fail(e)
  }
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

export interface MarketRefreshSummary {
  mode: 'CURRENT' | 'FULL'
  symbols: number
  snapshots: number
  results: PersistHistoryResult[]
  timings: {
    splitScanMs: number
    historyMs: number
    fxMs: number
    snapshotsMs: number
    totalMs: number
  }
}

function refreshLedgerRows(rows: Array<{
  id: string
  accountId: string
  assetId: string
  type: LedgerTx['type']
  quantity: unknown
  price: unknown
  amount: unknown
  fee: unknown
  occurredAt: Date
  navDate: Date | null
  settlementDate: Date | null
  navSource: string | null
  internal: boolean
  voidedAt: Date | null
  settleOfId: string | null
  asset: { cls: AssetInfo['cls']; currency: string }
}>): LedgerTx[] {
  return rows.map((tx) => ({
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
    settlementDate: tx.settlementDate,
    navSource: tx.navSource,
    internal: tx.internal,
    voidedAt: tx.voidedAt,
    settleOfId: tx.settleOfId,
    assetClass: tx.asset.cls,
    currency: tx.asset.currency,
  }))
}

async function runPriceRefresh(ctx: FamilyCtx, mode: 'CURRENT' | 'FULL'): Promise<{
  summary: MarketRefreshSummary
  warning?: string
}> {
  const startedAt = Date.now()
  const timings = { splitScanMs: 0, historyMs: 0, fxMs: 0, snapshotsMs: 0, totalMs: 0 }
  const splitScan = { events: [] as unknown[], errors: [] as string[] }
  if (mode === 'FULL') {
    const phaseAt = Date.now()
    const scanned = await scanSplitEvents(prisma, ctx)
    splitScan.events = scanned.events
    splitScan.errors = scanned.errors
    timings.splitScanMs = Date.now() - phaseAt
  }

  const db = scopedDb(prisma, ctx)
  const [assetRows, transactionRows] = await Promise.all([
    db.asset.findMany(),
    db.transaction.findMany({ include: { asset: true }, orderBy: { occurredAt: 'asc' } }),
  ])
  const assets: AssetInfo[] = assetRows.map((asset) => ({
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    cls: asset.cls,
    manual: asset.manual,
    currency: asset.currency,
  }))
  const ledgerTxs = refreshLedgerRows(transactionRows)
  const slot: RefreshSlot = mode === 'FULL' ? 'full' : 'manual'
  const plan = buildMarketRefreshPlan(assets, activeAssetIdsFromLedger(ledgerTxs), slot)
  const from = ledgerTxs[0]?.occurredAt ?? new Date(Date.now() - 800 * 86400000)
  const to = new Date()

  const purged = mode === 'FULL'
    ? await prisma.priceBar.deleteMany({ where: { source: 'SIMULATED' } })
    : { count: 0 }
  const purgedMisrouted = await purgeMisroutedFundBars(prisma, plan.marketSymbols)
  const historyAt = Date.now()
  // 基金源与交易所源相互独立，各自内部仍串行，最多只有两个公开请求并发。
  const [fundResults, marketResults] = await Promise.all([
    persistFundHistory(prisma, plan.fundSymbols, from, to),
    persistHistory(prisma, plan.marketSymbols, from, to, { route: 'EXCHANGE' }),
  ])
  const results = [...fundResults, ...marketResults]
  timings.historyMs = Date.now() - historyAt

  const fxAt = Date.now()
  let fxBackfilled = 0
  let fxBackfillWarning: string | undefined
  if (mode === 'FULL' && plan.hasForeignCurrency) {
    try {
      fxBackfilled = await backfillHistoricalFx(prisma, from)
    } catch (error) {
      fxBackfillWarning = `历史汇率回填失败：${error instanceof Error ? error.message : String(error)}`
    }
  }
  const fxWritten = plan.hasForeignCurrency ? await persistDailyFx(prisma, await fxRates(prisma)) : 0
  timings.fxMs = Date.now() - fxAt

  const snapshotsAt = Date.now()
  const changedFrom = results
    .map((result) => result.changedFrom ? new Date(result.changedFrom) : null)
    .filter((date): date is Date => date != null && Number.isFinite(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0]
  const today = new Date(Math.floor(Date.now() / 86400000) * 86400000)
  const snapshots = mode === 'FULL'
    ? await rebuildSnapshots(prisma, ctx.familyId)
    : await rebuildSnapshots(prisma, ctx.familyId, { affectedSince: changedFrom ?? today })
  timings.snapshotsMs = Date.now() - snapshotsAt
  timings.totalMs = Date.now() - startedAt

  const failed = results.filter((result) => result.status === 'FAILED')
  await audit(
    ctx,
    'REFRESH',
    'PriceBar',
    null,
    `${mode === 'FULL' ? '完整维护' : '当前持仓'} ${plan.fundSymbols.length + plan.marketSymbols.length} 个标的；`
      + `清理模拟K线 ${purged.count} 条、误路由场内净值 ${purgedMisrouted} 条；汇率回填 ${fxBackfilled} 条，当日 ${fxWritten} 条；`
      + `耗时 ${timings.totalMs}ms（拆分 ${timings.splitScanMs} / 行情 ${timings.historyMs} / 汇率 ${timings.fxMs} / 快照 ${timings.snapshotsMs}）；`
      + results.map((result) => `${result.symbol}:${result.status}:${result.count}@${result.source}`).join(' '),
  )
  for (const path of ['/', '/watch', '/positions', '/review', '/health', '/health/market']) revalidatePath(path)
  const warnings = [
    splitScan.events.length ? '发现拆分公告线索，请到公司行动页核对' : undefined,
    splitScan.errors.length ? `拆分检查有 ${splitScan.errors.length} 个标的失败，请到公司行动页查看` : undefined,
    fxBackfillWarning,
    failed.length > 0
      ? `${failed.length} 个标的历史行情刷新失败：${failed.map((item) => item.symbol).join('、')}`
      : undefined,
  ].filter((item): item is string => item != null)
  return {
    summary: {
      mode,
      symbols: plan.fundSymbols.length + plan.marketSymbols.length,
      snapshots,
      results,
      timings,
    },
    warning: warnings.join('；') || undefined,
  }
}

/** 日常人工兜底：只刷新当前持仓和基准，并增量重建受影响快照。 */
export async function refreshCurrentPrices(): Promise<ActionResult<MarketRefreshSummary>> {
  try {
    const ctx = await requireWrite()
    const result = await runPriceRefresh(ctx, 'CURRENT')
    return { ok: true, data: result.summary, warning: result.warning }
  } catch (e) {
    return fail(e)
  }
}

/** 数据修复：补齐全部历史、检查拆分、补历史汇率并全量重建快照。 */
export async function refreshPrices(): Promise<ActionResult<MarketRefreshSummary>> {
  try {
    const ctx = await requireWrite()
    const result = await runPriceRefresh(ctx, 'FULL')
    return { ok: true, data: result.summary, warning: result.warning }
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
