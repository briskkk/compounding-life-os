import { describe, expect, it } from 'vitest'
import { buildCashCalendar } from '@/lib/engine/cash-calendar'

describe('资金日历', () => {
  it('合并用户计划与在途结算并计算月度净额', () => {
    const result = buildCashCalendar(
      '2026-08',
      [{
        id: 'rent',
        title: '房租',
        direction: 'OUTFLOW',
        amountCny: 5000,
        dueDate: new Date(2026, 6, 31),
        recurrence: 'MONTHLY',
        endDate: null,
        accountName: '招商银行',
        note: null,
      }],
      [{ id: 'redeem', title: '基金赎回到账', amountCny: 8000, dueDate: new Date(2026, 7, 12) }],
    )

    expect(result.events).toHaveLength(2)
    expect(result.events[1].date.getDate()).toBe(31)
    expect(result.net).toBe(3000)
    expect(result.confirmedInflow).toBe(8000)
  })

  it('年度事件只在相同月份出现，并尊重结束日期', () => {
    const plan = {
      id: 'insurance',
      title: '年度保费',
      direction: 'OUTFLOW' as const,
      amountCny: 12000,
      dueDate: new Date(2026, 4, 10),
      recurrence: 'YEARLY' as const,
      endDate: new Date(2027, 11, 31),
      accountName: null,
      note: null,
    }
    expect(buildCashCalendar('2027-05', [plan]).events).toHaveLength(1)
    expect(buildCashCalendar('2027-06', [plan]).events).toHaveLength(0)
    expect(buildCashCalendar('2028-05', [plan]).events).toHaveLength(0)
  })

  it('把定投节点与真实买卖放在同一月历，但不把已发生交易重复计入计划净额', () => {
    const result = buildCashCalendar(
      '2026-09',
      [{
        id: 'rent',
        title: '房租',
        direction: 'OUTFLOW',
        amountCny: 5000,
        dueDate: new Date(2026, 8, 20),
        recurrence: 'NONE',
        endDate: null,
        accountName: '招商银行',
        note: null,
      }],
      [],
      [{
        id: 'plan-a:2026-09-15',
        planId: 'plan-a',
        title: '指数基金定投',
        amount: 1000,
        amountCny: 1000,
        currency: 'CNY',
        dueDate: new Date(2026, 8, 15),
        accountName: '天天基金',
        assetNames: ['指数基金'],
        status: 'RECORDED',
      }, {
        id: 'plan-a:2026-09-16',
        planId: 'plan-a',
        title: '指数基金定投',
        amount: 1000,
        amountCny: 1000,
        currency: 'CNY',
        dueDate: new Date(2026, 8, 16),
        accountName: '天天基金',
        assetNames: ['指数基金'],
        status: 'UNRECORDED_DUE',
      }],
      [{
        id: 'buy-a',
        title: '指数基金',
        type: 'BUY',
        amount: 1000,
        amountCny: 1000,
        currency: 'CNY',
        occurredAt: new Date(2026, 8, 15, 15),
        accountName: '天天基金',
        relatedPlanName: '指数基金定投',
        pending: true,
      }, {
        id: 'sell-a',
        title: '旧基金',
        type: 'SELL',
        amount: 600,
        amountCny: 600,
        currency: 'CNY',
        occurredAt: new Date(2026, 8, 18, 15),
        accountName: '天天基金',
        relatedPlanName: null,
        pending: false,
      }],
    )

    expect(result.events.map((event) => event.source)).toEqual([
      'TRADE', 'INVESTMENT_PLAN', 'INVESTMENT_PLAN', 'TRADE', 'PLAN',
    ])
    expect(result.net).toBe(-5000)
    expect(result.plannedInvestment).toBe(2000)
    expect(result.actualBuy).toBe(1000)
    expect(result.actualSell).toBe(600)
    expect(result.linkedBuyCount).toBe(1)
    expect(result.recordedPlanNodes).toBe(1)
    expect(result.duePlanNodes).toBe(2)
    expect(result.pendingPlanNodes).toBe(1)
  })
})
