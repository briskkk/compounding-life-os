// 总览待办的唯一装配：网页总览与 macOS 菜单栏读取同一份引擎结果。
// 这里只把账本、定投核对和账户对账凭证整理成 buildOverviewTasks 的入参，
// 不另写基金份额、定投节点或对账是否完成的判断。
import { prisma } from '@/lib/db'
import { scopedDb, type FamilyCtx } from '@/lib/scoped'
import { buildOverviewTasks, type OverviewTask } from '@/lib/engine/overview-tasks'
import type { InvestmentPlanBuy, InvestmentPlanInput } from '@/lib/engine/investment-plan'
import type { PendingFundPurchase } from '@/lib/engine/ledger'
import { dateKeyAt } from '@/lib/engine/watch-market'

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
      // 与总览页原映射一致：净值日字符串取 UTC 日期切片，不在客户端另定交易日。
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

export async function loadOverviewTasks(
  ctx: FamilyCtx,
  pendingFundPurchases: PendingFundPurchase[],
  assets: { id: string; name: string }[],
  currencyRates: OverviewCurrencyRates,
  now = new Date(),
): Promise<OverviewTask[]> {
  const db = scopedDb(prisma, ctx)
  const month = dateKeyAt(now).slice(0, 7)
  const monthStart = new Date(`${month}-01T00:00:00+08:00`)
  const [monthTxs, reconcileLogs, accounts, planRows, monthBuys, planReviews] = await Promise.all([
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
  const assetNameById = new Map(assets.map((asset) => [asset.id, asset.name]))
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
  const buys: InvestmentPlanBuy[] = monthBuys.flatMap((buy) => {
    if (!buy.assetId) return []
    return [{
      id: buy.id,
      accountId: buy.accountId,
      assetId: buy.assetId,
      amount: Number(buy.amount),
      occurredAt: buy.occurredAt,
      navSource: buy.navSource,
    }]
  })

  return assembleOverviewTasks({
    pendingFundPurchases: pendingFundPurchases.map((item) => ({
      assetName: assetNameById.get(item.assetId) ?? '基金申购',
      amount: item.amount,
      currency: item.currency,
      navDate: item.navDate,
    })),
    currencyRates,
    monthTxAccountIds: monthTxs.map((tx) => tx.accountId),
    reconcileLogs,
    accounts,
    plans,
    buys,
    planReviews,
    now,
  })
}
