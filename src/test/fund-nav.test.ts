import { describe, expect, it } from 'vitest'
import { exactFundNavBar, fundNavDayRange } from '@/lib/market/fund-nav'

describe('基金确认日净值', () => {
  it('精确选择确认日，不把次日净值当作历史成交净值', () => {
    const bars = [
      { date: new Date('2026-08-20T00:00:00+08:00'), close: 1.3981 },
      { date: new Date('2026-08-21T00:00:00+08:00'), close: 1.3976 },
    ]

    expect(exactFundNavBar(bars, '2026-08-20')?.close).toBe(1.3981)
    expect(exactFundNavBar(bars, '2026-08-22')).toBeNull()
  })

  it('按北京时间构造完整确认日区间，并拒绝无效日期', () => {
    const range = fundNavDayRange('2026-08-20')
    expect(range?.from.toISOString()).toBe('2026-08-19T16:00:00.000Z')
    expect(range?.to.toISOString()).toBe('2026-08-20T16:00:00.000Z')
    expect(fundNavDayRange('2026-02-30')).toBeNull()
    expect(fundNavDayRange('2026/08/20')).toBeNull()
  })
})
