import { describe, expect, it } from 'vitest'
import { assembleOverviewTasks, reconciliationAccountId } from '@/lib/services/overview-tasks'
import { buildOverviewTasks } from '@/lib/engine/overview-tasks'
import type { InvestmentPlanInput } from '@/lib/engine/investment-plan'

function plan(): InvestmentPlanInput {
  return {
    id: 'plan-a',
    name: '家庭定投',
    amount: 1000,
    currency: 'CNY',
    cadence: 'MONTHLY',
    scheduleDay: 15,
    startDate: new Date(2026, 0, 1, 12),
    endDate: null,
    status: 'ACTIVE',
    endedAt: null,
    accountId: 'broker-a',
    assetIds: ['fund-a'],
  }
}

const now = new Date(2026, 8, 20, 18)
const rates = { CNY: 1, USD: 7.2, HKD: 0.9 }

describe('桌面待办装配', () => {
  it('汇率、对账月份和定投入参交给总览引擎，不另写判断', () => {
    const tasks = assembleOverviewTasks({
      pendingFundPurchases: [
        { assetName: '美元基金', amount: 10, currency: 'USD', navDate: new Date('2026-09-16T00:00:00+08:00') },
      ],
      currencyRates: rates,
      monthTxAccountIds: ['cash', 'broker', 'cash'],
      reconcileLogs: [
        { entityId: 'cash', detail: JSON.stringify({ version: 1, asOfDate: '2026-09-18' }) },
        { entityId: 'broker', detail: JSON.stringify({ version: 1, asOfDate: '2026-08-18' }) },
        { entityId: 'other', detail: 'not-json' },
      ],
      accounts: [
        { id: 'cash', name: '工资卡' },
        { id: 'broker', name: '券商账户' },
      ],
      plans: [plan()],
      buys: [],
      planReviews: [],
      now,
    })

    const expected = buildOverviewTasks({
      pendingFundPurchases: [
        { assetName: '美元基金', amount: 72, navDate: '2026-09-15' },
      ],
      plans: [plan()],
      buys: [],
      planReviews: [],
      unreconciledAccounts: ['券商账户'],
      month: '2026-09',
      now,
    })
    expect(tasks).toEqual(expected)
    expect(tasks.map((task) => task.key)).toEqual([
      'FUND_CONFIRMATION',
      'INVESTMENT_PLAN',
      'ACCOUNT_RECONCILIATION',
    ])
    expect(tasks[0].evidence.amount).toBe(72)
    expect(tasks[2].evidence.accountNames).toEqual(['券商账户'])
  })

  it('当月对账凭证以外的记录不算已对账', () => {
    expect(reconciliationAccountId(null, '2026-09', 'cash')).toBeNull()
    expect(reconciliationAccountId('{}', '2026-09', 'cash')).toBeNull()
    expect(reconciliationAccountId(
      JSON.stringify({ version: 1, asOfDate: '2026-09-01' }),
      '2026-09',
      'cash',
    )).toBe('cash')
  })

  it('没有待办时返回空数组', () => {
    expect(assembleOverviewTasks({
      pendingFundPurchases: [],
      currencyRates: rates,
      monthTxAccountIds: [],
      reconcileLogs: [],
      accounts: [],
      plans: [],
      buys: [],
      planReviews: [],
      now,
    })).toEqual([])
  })
})
