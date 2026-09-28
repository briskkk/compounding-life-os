import { describe, expect, it } from 'vitest'
import { buildOverviewTasks } from '@/lib/engine/overview-tasks'
import type { InvestmentPlanInput } from '@/lib/engine/investment-plan'

function plan(overrides: Partial<InvestmentPlanInput> = {}): InvestmentPlanInput {
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
    ...overrides,
  }
}

describe('总览待办', () => {
  it('把已有基金、定投和账户证据转换成三个准确入口', () => {
    const tasks = buildOverviewTasks({
      pendingFundPurchases: [
        { assetName: '基金 B', amount: 800, navDate: '2026-09-18' },
        { assetName: '基金 A', amount: 1200, navDate: '2026-09-16' },
      ],
      plans: [plan()],
      buys: [],
      planReviews: [],
      unreconciledAccounts: ['工资卡', '券商账户', '备用账户'],
      month: '2026-09',
      now: new Date(2026, 8, 20, 18),
    })

    expect(tasks.map((task) => task.key)).toEqual([
      'FUND_CONFIRMATION',
      'INVESTMENT_PLAN',
      'ACCOUNT_RECONCILIATION',
    ])
    expect(tasks[0]).toMatchObject({
      count: 2,
      href: '/fund-confirmations',
      evidence: { assetName: '基金 A', amount: 2000, navDate: '2026-09-16' },
    })
    expect(tasks[1]).toMatchObject({
      count: 1,
      href: '/investment-plans',
      evidence: { planCount: 1 },
    })
    expect(tasks[2]).toMatchObject({
      count: 3,
      href: '/reconciliation',
      evidence: { accountNames: ['工资卡', '券商账户'] },
    })
  })

  it('同日真实 BUY 或有效未买核对都会移除对应定投待办', () => {
    const target = plan()
    const base = {
      pendingFundPurchases: [],
      plans: [target],
      unreconciledAccounts: [],
      month: '2026-09',
      now: new Date(2026, 8, 20, 18),
    }

    const bought = buildOverviewTasks({
      ...base,
      buys: [{
        id: 'buy-a',
        accountId: 'broker-a',
        assetId: 'fund-a',
        amount: 1000,
        occurredAt: new Date(2026, 8, 15, 15),
        navSource: 'PENDING',
      }],
      planReviews: [],
    })
    expect(bought).toEqual([])

    const reviewed = buildOverviewTasks({
      ...base,
      buys: [],
      planReviews: [{
        planId: target.id,
        scheduledDate: new Date(2026, 8, 15, 12),
        revokedAt: null,
      }],
    })
    expect(reviewed).toEqual([])
  })

  it('撤销未买核对后恢复为待核对，不把计划节点写成交易结论', () => {
    const target = plan()
    const tasks = buildOverviewTasks({
      pendingFundPurchases: [],
      plans: [target],
      buys: [],
      planReviews: [{
        planId: target.id,
        scheduledDate: new Date(2026, 8, 15, 12),
        revokedAt: new Date(2026, 8, 16, 9),
      }],
      unreconciledAccounts: [],
      month: '2026-09',
      now: new Date(2026, 8, 20, 18),
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ key: 'INVESTMENT_PLAN', count: 1 })
    expect(tasks[0].detail).toContain('确认实际买入或未买入')
  })
})
