import type { InvestmentPlanMonthRow } from '@/lib/engine/investment-plan'

export type MonthCloseStepStatus = 'COMPLETE' | 'ATTENTION' | 'READY' | 'EMPTY'

export interface MonthCloseStep {
  status: MonthCloseStepStatus
  summary: string
}

export interface MonthCloseResult {
  data: MonthCloseStep
  reconciliation: MonthCloseStep
  investmentPlan: MonthCloseStep
  review: MonthCloseStep
  completedSteps: number
  totalSteps: 4
}

export interface MonthCloseInput {
  snapshot: {
    status: string
    coverage: number | null
  } | null
  pendingFundCount: number
  activeAccountIds: string[]
  reconciledAccountIds: string[]
  planRows: Pick<InvestmentPlanMonthRow, 'scheduledDates' | 'transactionCount' | 'dueAmount' | 'actualAmount'>[]
  reviewStatus: 'DRAFT' | 'COMPLETED' | null
}

const COMPLETE_VALUATION_STATUSES = new Set(['SETTLED', 'CLOSED'])

export function buildMonthClose(input: MonthCloseInput): MonthCloseResult {
  const dataComplete = Boolean(
    input.snapshot
    && COMPLETE_VALUATION_STATUSES.has(input.snapshot.status)
    && input.pendingFundCount === 0,
  )
  const data: MonthCloseStep = dataComplete
    ? { status: 'COMPLETE', summary: '月末估值与基金确认均已就绪' }
    : {
        status: 'ATTENTION',
        summary: !input.snapshot
          ? '本月尚无快照证据'
          : input.pendingFundCount > 0
            ? `${input.pendingFundCount} 笔基金申购仍待确认`
            : `最近快照状态为 ${input.snapshot.status}`,
      }

  const activeAccounts = new Set(input.activeAccountIds)
  const reconciledAccounts = new Set(input.reconciledAccountIds.filter((id) => activeAccounts.has(id)))
  const reconciliation: MonthCloseStep = activeAccounts.size === 0
    ? { status: 'EMPTY', summary: '本月没有需要核对的活跃账户' }
    : reconciledAccounts.size === activeAccounts.size
      ? { status: 'COMPLETE', summary: `${activeAccounts.size} 个活跃账户均有当月凭证` }
      : {
          status: 'ATTENTION',
          summary: `${reconciledAccounts.size}/${activeAccounts.size} 个活跃账户已核对`,
        }

  const relevantPlans = input.planRows.filter((row) => row.scheduledDates.length > 0 || row.transactionCount > 0)
  const duePlans = relevantPlans.filter((row) => row.dueAmount > 0)
  const completedPlans = duePlans.filter((row) => row.actualAmount + 0.01 >= row.dueAmount)
  const investmentPlan: MonthCloseStep = relevantPlans.length === 0
    ? { status: 'EMPTY', summary: '本月没有定投计划或匹配流水' }
    : duePlans.length === 0
      ? { status: 'READY', summary: '本月计划尚未到执行日' }
      : completedPlans.length === duePlans.length
        ? { status: 'COMPLETE', summary: `${duePlans.length} 条到期计划均达到计划金额` }
        : {
            status: 'ATTENTION',
            summary: `${completedPlans.length}/${duePlans.length} 条到期计划达到计划金额`,
          }

  const review: MonthCloseStep = input.reviewStatus === 'COMPLETED'
    ? { status: 'COMPLETE', summary: '月度复盘已完成并进入审计链' }
    : input.reviewStatus === 'DRAFT'
      ? { status: 'READY', summary: '已有草稿，等待确认完成' }
      : { status: 'READY', summary: '证据就绪后可保存月度复盘' }

  const steps = [data, reconciliation, investmentPlan, review]
  return {
    data,
    reconciliation,
    investmentPlan,
    review,
    completedSteps: steps.filter((step) => step.status === 'COMPLETE').length,
    totalSteps: 4,
  }
}
