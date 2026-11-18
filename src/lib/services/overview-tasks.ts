// 菜单栏待办装配：按总览页同一输入形状调用 buildOverviewTasks。
// 只读取待确认申购、定投核对和账户对账凭证，不折叠持仓、不取行情、不重建快照。
// 外币申购金额用既有汇率折人民币；纯人民币不访问汇率源。
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { scopedDb, type FamilyCtx } from '@/lib/scoped'
import { buildOverviewTasks, type OverviewTask } from '@/lib/engine/overview-tasks'
import type { InvestmentPlanBuy, InvestmentPlanInput } from '@/lib/engine/investment-plan'
import { pendingFundPurchasesAt, type LedgerTx } from '@/lib/engine/ledger'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { fxRatesForCurrenciesSWR } from '@/lib/market/fx'

export interface OverviewCurrencyRates {
  CNY: number
  USD: number
  HKD: number
}

export interface OverviewReconcileLog {
  entityId: string | null
  detail: string | null
}

/** 与总览页原有读取一致：version 1 且 asOfDate 落在该月的对账凭证。 */
export function reconciliationAccountId(detail: string | null, month: string, entityId: string | null): string | null {
  if (!detail || !entityId) return null
  try {
    const parsed = JSON.parse(detail) as { version?: number; asOfDate?: string }
    return parsed.version === 1 && parsed.asOfDate?.startsWith(month) ? entityId : null
  } catch {
    return null
  }
}

function rateFor(currency: string, rates: OverviewCurrencyRates): number {
  if (currency === 'USD' || currency === 'HKD' || currency === 'CNY') return rates[currency]
  return 1
}

export function assembleOverviewTasks(input: {
  pendingFundPurchases: { assetName: string; amount: number; currency: string; navDate: Date }[]
  currencyRates: OverviewCurrencyRates
  monthTxAccountIds: string[]
  reconcileLogs: OverviewReconcileLog[]
  accounts: { id: string; name: string }[]
  plans: InvestmentPlanInput[]
  buys: InvestmentPlanBuy[]
  planReviews: { planId: string; scheduledDate: Date; revokedAt: Date | null }[]
  now: Date
}): OverviewTask[] {
  const month = dateKeyAt(input.now).slice(0, 7)
  const reconciled = new Set(input.reconcileLogs.flatMap((log) => {
    const id = reconciliationAccountId(log.detail, month, log.entityId)
    return id ? [id] : []
  }))
  const accountNameById = new Map(input.accounts.map((account) => [account.id, account.name]))
  const unreconciledAccounts = [...new Set(input.monthTxAccountIds)]
    .filter((accountId) => !reconciled.has(accountId))
    .map((accountId) => accountNameById.get(accountId) ?? '未命名账户')

  return buildOverviewTasks({
    pendingFundPurchases: input.pendingFundPurchases.map((item) => ({
      assetName: item.assetName,
      amount: item.amount * rateFor(item.currency, input.currencyRates),
      // 与总览页原映射一致：净值日字符串取 UTC 日期切片。
      navDate: item.navDate.toISOString().slice(0, 10),
    })),
    plans: input.plans,
    buys: input.buys,
    planReviews: input.planReviews,
    unreconciledAccounts,
    month,
    now: input.now,
  })
}

async function loadPendingFundPurchases(
  db: ReturnType<typeof scopedDb>,
  now: Date,
): Promise<{ assetName: string; amount: number; currency: string; navDate: Date }[]> {
  const rows = await db.transaction.findMany({
    where: {
      type: 'BUY',
      voidedAt: null,
      navSource: 'PENDING',
      quantity: null,
      price: null,
      amount: { gt: 0 },
      navDate: { not: null },
      asset: { cls: 'FUND' },
    },
    select: {
      id: true,
      accountId: true,
      assetId: true,
      quantity: true,
      price: true,
      amount: true,
      fee: true,
      occurredAt: true,
      navDate: true,
      navSource: true,
      settlementDate: true,
      internal: true,
      voidedAt: true,
      settleOfId: true,
      note: true,
      asset: { select: { name: true, cls: true, currency: true } },
    },
  })
  const ledgerTxs: LedgerTx[] = rows.flatMap((row) => {
    if (!row.navDate) return []
    return [{
      id: row.id,
      accountId: row.accountId,
      assetId: row.assetId,
      type: 'BUY' as const,
      quantity: row.quantity == null ? null : Number(row.quantity),
      price: row.price == null ? null : Number(row.price),
      amount: Number(row.amount),
      fee: Number(row.fee),
      occurredAt: row.occurredAt,
      navDate: row.navDate,
      navSource: row.navSource,
      settlementDate: row.settlementDate,
      internal: row.internal,
      voidedAt: row.voidedAt,
      settleOfId: row.settleOfId,
      note: row.note,
      currency: row.asset.currency,
      assetClass: row.asset.cls,
    }]
  })
  const nameById = new Map(rows.map((row) => [row.assetId, row.asset.name]))
  return pendingFundPurchasesAt(ledgerTxs, now).map((item) => ({
    assetName: nameById.get(item.assetId) ?? '基金申购',
    amount: item.amount,
    currency: item.currency,
    navDate: item.navDate,
  }))
}

export async function loadOverviewTasks(
  ctx: FamilyCtx,
  options: { now?: Date; client?: PrismaClient } = {},
): Promise<OverviewTask[]> {
  const now = options.now ?? new Date()
  const client = options.client ?? prisma
  const db = scopedDb(client, ctx)
  const month = dateKeyAt(now).slice(0, 7)
  const monthStart = new Date(`${month}-01T00:00:00+08:00`)
  const [pendingFundPurchases, monthTxs, reconcileLogs, accounts, planRows, monthBuys, planReviews] = await Promise.all([
    loadPendingFundPurchases(db, now),
    db.transaction.findMany({
      where: { occurredAt: { gte: monthStart, lte: now }, voidedAt: null },
      select: { accountId: true },
    }),
    db.auditLog.findMany({
      where: { action: 'RECONCILE', entity: 'Account' },
      select: { entityId: true, detail: true },
    }),
    db.account.findMany({ select: { id: true, name: true } }),
    db.investmentPlan.findMany({ include: { assets: true }, orderBy: { createdAt: 'asc' } }),
    db.transaction.findMany({
      where: { type: 'BUY', voidedAt: null, occurredAt: { gte: monthStart, lte: now } },
      select: { id: true, accountId: true, assetId: true, amount: true, occurredAt: true, navSource: true },
    }),
    db.investmentPlanDayReview.findMany({
      where: { scheduledDate: { gte: monthStart, lte: now } },
      select: { planId: true, scheduledDate: true, revokedAt: true },
    }),
  ])
  const fx = await fxRatesForCurrenciesSWR(
    client,
    pendingFundPurchases.map((item) => item.currency),
  )
  const plans: InvestmentPlanInput[] = planRows.map((plan) => ({
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
  }))
  const buys: InvestmentPlanBuy[] = monthBuys.map((buy) => ({
    id: buy.id,
    accountId: buy.accountId,
    assetId: buy.assetId,
    amount: Number(buy.amount),
    occurredAt: buy.occurredAt,
    navSource: buy.navSource,
  }))

  return assembleOverviewTasks({
    pendingFundPurchases,
    currencyRates: { CNY: 1, USD: fx.USDCNY, HKD: fx.HKDCNY },
    monthTxAccountIds: monthTxs.map((tx) => tx.accountId),
    reconcileLogs,
    accounts,
    plans,
    buys,
    planReviews,
    now,
  })
}
