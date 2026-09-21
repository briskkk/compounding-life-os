import { describe, expect, it } from 'vitest'
import {
  buildInvestmentPlanMonth,
  investmentPlanMatchesBuy,
  scheduledDatesInMonth,
  scheduledDatesInMonthByPlan,
  unrecordedScheduledDatesInMonth,
  type InvestmentPlanInput,
  type InvestmentPlanDayReviewInput,
} from '@/lib/engine/investment-plan'

function plan(overrides: Partial<InvestmentPlanInput> = {}): InvestmentPlanInput {
  return {
    id: 'nasdaq',
    name: '纳指 100 定投',
    amount: 100,
    currency: 'CNY',
    cadence: 'WEEKDAY',
    scheduleDay: null,
    startDate: new Date(2026, 8, 1, 12),
    endDate: null,
    status: 'ACTIVE',
    endedAt: null,
    accountId: null,
    assetIds: ['fund-a', 'fund-b'],
    ...overrides,
  }
}

describe('定投计划', () => {
  it('只在候选资产、限定账户和计划窗口同时匹配时关联真实买入', () => {
    const target = plan({ accountId: 'jd', startDate: new Date(2026, 8, 1), endDate: new Date(2026, 8, 30) })
    const buy = { id: 'b1', accountId: 'jd', assetId: 'fund-a', amount: 100, occurredAt: new Date(2026, 8, 15), navSource: null }
    expect(investmentPlanMatchesBuy(target, buy)).toBe(true)
    expect(investmentPlanMatchesBuy(target, { ...buy, accountId: 'other' })).toBe(false)
    expect(investmentPlanMatchesBuy(target, { ...buy, assetId: 'other' })).toBe(false)
    expect(investmentPlanMatchesBuy(target, { ...buy, occurredAt: new Date(2026, 9, 1) })).toBe(false)
  })

  it('按工作日生成计划，并合并候选资产的真实 BUY 流水', () => {
    const result = buildInvestmentPlanMonth('2026-09', [plan()], [
      { id: 'b1', accountId: 'a1', assetId: 'fund-a', amount: 100, occurredAt: new Date(2026, 8, 1, 10), navSource: 'OFFICIAL' },
      { id: 'b2', accountId: 'a2', assetId: 'fund-b', amount: 200, occurredAt: new Date(2026, 8, 2, 10), navSource: 'PENDING' },
      { id: 'ignored', accountId: 'a1', assetId: 'other', amount: 999, occurredAt: new Date(2026, 8, 3, 10), navSource: null },
    ], new Date(2026, 8, 2, 18))

    expect(result.rows[0].scheduledDates).toHaveLength(22)
    expect(result.rows[0].dueAmount).toBe(200)
    expect(result.rows[0].actualAmount).toBe(300)
    expect(result.rows[0].pendingAmount).toBe(200)
    expect(result.rows[0].days.slice(0, 3).map((day) => day.status)).toEqual(['RECORDED', 'RECORDED', 'UPCOMING'])
    expect(result.rows[0].days[1].pendingCount).toBe(1)
    expect(result.rows[0].days[1].actualAmount).toBe(200)
    expect(result.rows[0].pace).toBe('ON_TRACK')
    expect(result.transactionCount).toBe(2)
    expect(result.pendingCount).toBe(1)
  })

  it('按账户过滤实际投入，金额不足时标记落后', () => {
    const result = buildInvestmentPlanMonth('2026-09', [plan({ cadence: 'WEEKLY', scheduleDay: 2, accountId: 'target' })], [
      { id: 'wrong-account', accountId: 'other', assetId: 'fund-a', amount: 500, occurredAt: new Date(2026, 8, 1, 10), navSource: null },
      { id: 'right-account', accountId: 'target', assetId: 'fund-a', amount: 50, occurredAt: new Date(2026, 8, 1, 10), navSource: null },
    ], new Date(2026, 8, 15, 18))

    expect(result.rows[0].dueAmount).toBe(300)
    expect(result.rows[0].actualAmount).toBe(50)
    expect(result.rows[0].pace).toBe('BEHIND')
  })

  it('逐日区分到期未录与未来节点，非计划日买入仍计入金额并单列', () => {
    const result = buildInvestmentPlanMonth('2026-09', [plan()], [
      { id: 'off-schedule', accountId: 'a1', assetId: 'fund-a', amount: 50, occurredAt: new Date(2026, 8, 5, 10), navSource: null },
    ], new Date(2026, 8, 3, 18))

    expect(result.rows[0].days.slice(0, 4).map((day) => day.status)).toEqual([
      'UNRECORDED_DUE', 'UNRECORDED_DUE', 'UNRECORDED_DUE', 'UPCOMING',
    ])
    expect(result.rows[0].offScheduleDates.map((date) => date.getDate())).toEqual([5])
    expect(result.rows[0].actualAmount).toBe(50)
  })

  it('已核对未买只改变计划日状态和待录队列，不改变实际投入；撤销后可重新核对', () => {
    const target = plan({ accountId: 'jd', assetIds: ['fund-a'] })
    const reviews: InvestmentPlanDayReviewInput[] = [{ planId: target.id, scheduledDate: new Date(2026, 8, 14, 12), revokedAt: null }]
    const now = new Date(2026, 8, 15, 18)
    const reviewed = buildInvestmentPlanMonth('2026-09', [target], [], now, reviews)
    expect(reviewed.rows[0].days.find((day) => day.date.getDate() === 14)?.status).toBe('CONFIRMED_NO_BUY')
    expect(reviewed.rows[0].actualAmount).toBe(0)
    expect(unrecordedScheduledDatesInMonth('2026-09', target, [], now, reviews).map((date) => date.getDate())).not.toContain(14)

    reviews[0].revokedAt = new Date(2026, 8, 15, 19)
    expect(unrecordedScheduledDatesInMonth('2026-09', target, [], now, reviews).map((date) => date.getDate())).toContain(14)

    const bought = buildInvestmentPlanMonth('2026-09', [target], [
      { id: 'later-buy', accountId: 'jd', assetId: 'fund-a', amount: 100, occurredAt: new Date(2026, 8, 14, 15), navSource: 'PENDING' },
    ], now, [{ ...reviews[0], revokedAt: null }])
    expect(bought.rows[0].days.find((day) => day.date.getDate() === 14)?.status).toBe('RECORDED')
    expect(bought.rows[0].days.find((day) => day.date.getDate() === 14)?.hasNoBuyReviewConflict).toBe(true)
  })

  it('待核对队列按计划日分组：同日多只基金合并，且不受已录入影响', () => {
    const first = plan({ id: 'plan-a', accountId: 'jd', assetIds: ['fund-a'] })
    const second = plan({ id: 'plan-b', accountId: 'jd', assetIds: ['fund-b'] })
    const byPlan = scheduledDatesInMonthByPlan('2026-09', [first, second])
    expect(byPlan.get('plan-a')).toHaveLength(22)
    expect(byPlan.get('plan-b')).toHaveLength(22)
    expect(byPlan.get('plan-a')!.map((date) => date.getDate())).toEqual(byPlan.get('plan-b')!.map((date) => date.getDate()))

    // 已录入不影响分组本身：分组只回答「这天有哪些计划节点」，是否待核对由 unrecorded 决定
    const now = new Date(2026, 8, 2, 18)
    const target = plan({ id: 'plan-c', accountId: 'jd', assetIds: ['fund-a'] })
    const pending = unrecordedScheduledDatesInMonth('2026-09', target, [
      { id: 'b1', accountId: 'jd', assetId: 'fund-a', amount: 100, occurredAt: new Date(2026, 8, 1, 12), navSource: 'PENDING' },
    ], now)
    expect(byPlan.get('plan-c') ?? scheduledDatesInMonthByPlan('2026-09', [target]).get('plan-c')).toHaveLength(22)
    expect(pending.map((date) => date.getDate())).toEqual([2])
  })

  it('月度日期按月末收口，并尊重计划结束日', () => {
    const monthly = plan({
      cadence: 'MONTHLY',
      scheduleDay: 31,
      startDate: new Date(2026, 0, 31, 12),
      endDate: new Date(2026, 1, 28, 12),
    })
    expect(scheduledDatesInMonth('2026-02', monthly).map((date) => date.getDate())).toEqual([28])
    expect(scheduledDatesInMonth('2026-03', monthly)).toEqual([])
  })

  it('快速录入保留较晚买入之前漏录的到期节点，并排除同日已有买入', () => {
    const target = plan({ accountId: 'jd', assetIds: ['fund-a'] })
    const buys = [
      { id: 'old', accountId: 'jd', assetId: 'fund-a', amount: 100, occurredAt: new Date(2026, 8, 10, 12), navSource: 'PENDING' },
      { id: 'later', accountId: 'jd', assetId: 'fund-a', amount: 100, occurredAt: new Date(2026, 8, 15, 12), navSource: 'PENDING' },
      { id: 'other-account', accountId: 'other', assetId: 'fund-a', amount: 100, occurredAt: new Date(2026, 8, 11, 12), navSource: 'PENDING' },
      { id: 'other-fund', accountId: 'jd', assetId: 'fund-b', amount: 100, occurredAt: new Date(2026, 8, 14, 12), navSource: 'PENDING' },
    ]
    expect(unrecordedScheduledDatesInMonth('2026-09', target, buys, new Date(2026, 8, 15, 16))
      .map((date) => date.getDate())).toEqual([1, 2, 3, 4, 7, 8, 9, 11, 14])
    expect(unrecordedScheduledDatesInMonth('2026-09', target, buys, new Date(2026, 8, 11, 8))
      .map((date) => date.getDate())).toEqual([1, 2, 3, 4, 7, 8, 9, 11])
  })

  it('未来月份不误报落后，已结束计划保留历史结果', () => {
    const future = buildInvestmentPlanMonth('2026-10', [plan()], [], new Date(2026, 8, 11, 12))
    expect(future.rows[0].pace).toBe('UPCOMING')

    const ended = buildInvestmentPlanMonth('2026-09', [plan({
      status: 'ENDED',
      endedAt: new Date(2026, 8, 4, 12),
    })], [], new Date(2026, 8, 11, 12))
    expect(ended.rows[0].scheduledDates).toHaveLength(4)
    expect(ended.rows[0].pace).toBe('ENDED')
  })
})
