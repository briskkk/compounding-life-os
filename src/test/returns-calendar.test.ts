import { describe, expect, it } from 'vitest'
import {
  allYearTotals,
  benchmarkMonthReturn,
  benchmarkYearReturn,
  buildMonthGrid,
  monthDailyPoints,
  monthKeyOf,
  monthRange,
  observedReturnMonths,
  shiftMonthKey,
  yearMonthTotals,
} from '@/lib/engine/returns-calendar'

describe('收益日历', () => {
  it('月份键解析与跨年平移', () => {
    expect(monthKeyOf('2026-08-09')).toBe('2026-08')
    expect(shiftMonthKey('2026-08', -1)).toBe('2026-07')
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2025-12', 1)).toBe('2026-01')
    expect(monthRange('2026-02')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' })
    expect(monthRange('2024-02')).toEqual({ startDate: '2024-02-01', endDate: '2024-02-29' })
  })

  it('月历网格周一开头，相邻月溢出日标记 inMonth=false', () => {
    // 2026-08-01 是周六
    const weeks = buildMonthGrid('2026-08')
    expect(weeks).toHaveLength(6)
    expect(weeks[0].map((day) => day.date)).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
    ])
    expect(weeks[0][0].inMonth).toBe(false)
    expect(weeks[0][5].inMonth).toBe(true)
    expect(weeks.at(-1)?.[0]).toEqual({ date: '2026-08-31', inMonth: true })
    expect(weeks.at(-1)?.at(-1)).toEqual({ date: '2026-09-06', inMonth: false })
    for (const week of weeks) expect(week).toHaveLength(7)
  })

  it('周一起始的月份没有前置溢出日', () => {
    // 2026-06-01 是周一
    const weeks = buildMonthGrid('2026-06')
    expect(weeks[0][0]).toEqual({ date: '2026-06-01', inMonth: true })
  })

  it('每月 1 日以上月末快照为基准计算自己的当日收益', () => {
    const daily = monthDailyPoints([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 110, contributions: 100 },
      { date: '2026-08-02', netWorth: 140, contributions: 120 },
    ], '2026-08')

    // 基准点（上月末）不进入当月结果
    expect(daily.has('2026-07-31')).toBe(false)
    expect(daily.get('2026-08-01')?.dailyAmount).toBe(10)
    expect(daily.get('2026-08-02')?.dailyAmount).toBe(10)
    expect(daily.get('2026-08-02')?.dailyPct).toBeCloseTo(10 / 110)
  })

  it('仅资金流与休市日保留日期但当日收益为空', () => {
    const daily = monthDailyPoints([
      { date: '2026-07-31', netWorth: 100, contributions: 100 },
      { date: '2026-08-01', netWorth: 150, contributions: 150, valuationStatus: 'FLOW_ONLY' as const },
      { date: '2026-08-02', netWorth: 155, contributions: 150 },
    ], '2026-08')

    expect(daily.get('2026-08-01')?.dailyAmount).toBeNull()
    // 下一个有效估值日相对紧邻的上一快照计算（仅资金流日的余额已含当日入金）
    expect(daily.get('2026-08-02')?.dailyAmount).toBe(5)
  })

  it('基准当月涨跌幅以月初前最近收盘为期初', () => {
    const points = [
      { date: '2026-07-31', close: 4000 },
      { date: '2026-08-14', close: 4040 },
      { date: '2026-08-28', close: 4080 },
    ]
    expect(benchmarkMonthReturn(points, '2026-08')).toBeCloseTo(0.02)
  })

  it('基准月内无新收盘或月初前无收盘时记 null', () => {
    expect(benchmarkMonthReturn([{ date: '2026-07-31', close: 4000 }], '2026-08')).toBeNull()
    expect(benchmarkMonthReturn([{ date: '2026-08-14', close: 4000 }], '2026-08')).toBeNull()
    expect(benchmarkMonthReturn([], '2026-08')).toBeNull()
  })

  it('月收益视图：全年 12 个月一次引擎调用分桶，跨年基准正确', () => {
    const totals = yearMonthTotals([
      { date: '2025-12-31', netWorth: 1000, contributions: 1000 },
      { date: '2026-01-05', netWorth: 1050, contributions: 1000 },
      { date: '2026-01-20', netWorth: 1100, contributions: 1030 },
      { date: '2026-03-02', netWorth: 1090, contributions: 1030 },
    ], 2026)

    expect(totals).toHaveLength(12)
    expect(totals[0]).toEqual({ key: '2026-01', total: 70, hasAmount: true })
    // 2 月没有任何快照：无收益观察
    expect(totals[1]).toEqual({ key: '2026-02', total: 0, hasAmount: false })
    expect(totals[2]).toEqual({ key: '2026-03', total: -10, hasAmount: true })
    expect(totals[11].hasAmount).toBe(false)
  })

  it('年收益视图：按年分桶覆盖整个序列，空序列返回空', () => {
    expect(allYearTotals([])).toEqual([])
    const totals = allYearTotals([
      { date: '2025-06-30', netWorth: 1000, contributions: 1000 },
      { date: '2025-12-31', netWorth: 1200, contributions: 1000 },
      { date: '2026-02-01', netWorth: 1150, contributions: 1000 },
    ])

    expect(totals).toEqual([
      { key: '2025', total: 200, hasAmount: true },
      { key: '2026', total: -50, hasAmount: true },
    ])
  })

  it('年收益视图：没有收益观察的年份（孤立早期快照）不进入列表', () => {
    // 2022 只有一个孤立快照（如期初台账），2026 才有有效估值序列
    const totals = allYearTotals([
      { date: '2022-03-01', netWorth: 500, contributions: 500 },
      { date: '2026-06-01', netWorth: 1000, contributions: 1000 },
      { date: '2026-06-02', netWorth: 1010, contributions: 1000 },
    ])

    expect(totals.map((item) => item.key)).toEqual(['2026'])
    expect(totals[0].total).toBe(10)
  })

  it('有收益观察的月份键按升序返回，仅资金流日不算观察', () => {
    expect(observedReturnMonths([])).toEqual([])
    const months = observedReturnMonths([
      { date: '2026-05-31', netWorth: 100, contributions: 100 },
      { date: '2026-06-01', netWorth: 100, contributions: 150, valuationStatus: 'FLOW_ONLY' as const },
      { date: '2026-06-15', netWorth: 160, contributions: 150 },
      { date: '2026-08-02', netWorth: 155, contributions: 150 },
    ])

    // 06-01 仅资金流不构成观察；06-15 与 08-02 是观察日 → 6 月与 8 月
    expect(months).toEqual(['2026-06', '2026-08'])
  })

  it('基准当年涨跌幅以年初前最近收盘为期初', () => {
    const points = [
      { date: '2025-12-31', close: 4000 },
      { date: '2026-06-30', close: 4200 },
      { date: '2026-08-10', close: 4400 },
    ]
    expect(benchmarkYearReturn(points, 2026)).toBeCloseTo(0.1)
    expect(benchmarkYearReturn(points, 2025)).toBeNull()
    expect(benchmarkYearReturn([], 2026)).toBeNull()
  })
})
