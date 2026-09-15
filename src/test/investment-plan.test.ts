import { describe, expect, it } from 'vitest'
import {
  buildInvestmentPlanMonth,
  scheduledDatesInMonth,
  type InvestmentPlanInput,
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
