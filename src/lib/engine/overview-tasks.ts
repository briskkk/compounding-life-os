// 总览待办：只把「账本里已经存在的未完成证据」变成可执行入口。
//
// 三条待办分别对应三个既有核对工作流，任何一条都必须能指出证据来源：
// - 基金份额待确认：净值/份额未知的 BUY 仍在途（ADR-019），入口 /fund-confirmations；
// - 定投节点待核对：已到期、同日无有效 BUY 且未被用户确认未买的计划日（ADR-025/026），
//   计划节点本身不是交易，因此这里只提示核对，不推断已经买入；
// - 账户待对账：本月有账本活动的结算账户尚无当月对账凭证（ADR-017），入口 /reconciliation。
//
// 引擎只返回数量与证据字段，金额与日期的显示格式由页面决定；
// 零待办时返回空数组：页面据此展示完成态，而不是保留空壳面板。
import { unrecordedScheduledDatesInMonth, type InvestmentPlanBuy, type InvestmentPlanInput } from './investment-plan'
import { dateKeyAt } from './watch-market'

export type OverviewTaskKey = 'FUND_CONFIRMATION' | 'INVESTMENT_PLAN' | 'ACCOUNT_RECONCILIATION'

export interface OverviewTaskEvidence {
  /** 基金待确认：涉及的第一只资产名 */
  assetName?: string
  /** 基金待确认：合计金额（原币按当前口径已折算，与可投资口径一致） */
  amount?: number
  /** 基金待确认：最早的待确认净值日 */
  navDate?: string
  /** 定投待核对：涉及的计划条数 */
  planCount?: number
  /** 账户待对账：账户名（最多前两个） */
  accountNames?: string[]
}

export interface OverviewTask {
  key: OverviewTaskKey
  /** 待处理数量：基金笔数 / 定投节点数 / 账户数 */
  count: number
  title: string
  detail: string
  href: string
  /** 目的地动作名，用于「去核对 →」这类可读的链接文案 */
  action: string
  evidence: OverviewTaskEvidence
}

export interface OverviewTaskInput {
  /** 待确认份额的基金申购（账本派生，含金额与净值日） */
  pendingFundPurchases: { assetName: string; amount: number; navDate: string }[]
  /** 当月仍在执行或当月有节点的定投计划 */
  plans: InvestmentPlanInput[]
  /** 当月有效 BUY（与定投页同一匹配规则） */
  buys: InvestmentPlanBuy[]
  /** 当月有效的计划日未买入核对（可撤销） */
  planReviews: { planId: string; scheduledDate: Date; revokedAt: Date | null }[]
  /** 账本当月有活动、但尚无对账凭证的账户名 */
  unreconciledAccounts: string[]
  /** 计划节点核对按哪个自然月统计（账本成员所在时区的当月） */
  month: string
  now: Date
}

export function buildOverviewTasks(input: OverviewTaskInput): OverviewTask[] {
  const tasks: OverviewTask[] = []

  const purchases = input.pendingFundPurchases
  if (purchases.length > 0) {
    const sorted = [...purchases].sort((a, b) => a.navDate.localeCompare(b.navDate))
    tasks.push({
      key: 'FUND_CONFIRMATION',
      count: purchases.length,
      title: `${purchases.length} 笔基金份额待确认`,
      detail: '净值与份额以官方公布为准，确认前金额保留在在途资产',
      href: '/fund-confirmations',
      action: '去核对份额',
      evidence: {
        assetName: sorted[0].assetName,
        amount: purchases.reduce((sum, item) => sum + item.amount, 0),
        navDate: sorted[0].navDate,
      },
    })
  }

  const planDays = new Set<string>()
  for (const plan of input.plans) {
    for (const date of unrecordedScheduledDatesInMonth(input.month, plan, input.buys, input.now, input.planReviews)) {
      planDays.add(`${plan.id}|${dateKeyAt(date)}`)
    }
  }
  if (planDays.size > 0) {
    tasks.push({
      key: 'INVESTMENT_PLAN',
      count: planDays.size,
      title: `${planDays.size} 个定投节点待核对`,
      detail: '按平台记录确认实际买入或未买入，两种结果都不改变计划额',
      href: '/investment-plans',
      action: '去核对定投',
      evidence: { planCount: new Set([...planDays].map((key) => key.split('|')[0])).size },
    })
  }

  const accounts = input.unreconciledAccounts
  if (accounts.length > 0) {
    tasks.push({
      key: 'ACCOUNT_RECONCILIATION',
      count: accounts.length,
      title: `${accounts.length} 个账户本月待对账`,
      detail: '账户本月有账本活动，尚未登记对账凭证',
      href: '/reconciliation',
      action: '去核对账户',
      evidence: { accountNames: accounts.slice(0, 2) },
    })
  }

  return tasks
}
