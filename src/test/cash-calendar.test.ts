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
})
