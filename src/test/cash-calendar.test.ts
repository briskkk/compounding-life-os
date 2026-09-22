import { describe, expect, it } from 'vitest'
import { buildCashCalendar, type TradeInput } from '@/lib/engine/cash-calendar'

type TradeSeed = TradeInput

const buy = (over: Partial<TradeSeed> = {}): TradeSeed => ({
  id: 'buy-a',
  title: '指数基金',
  type: 'BUY',
  amount: 1000,
  amountCny: 1000,
  currency: 'CNY',
  occurredAt: new Date(2026, 8, 15, 15),
  accountName: '天天基金',
  relatedPlanName: null,
  pending: false,
  ...over,
})

const sell = (over: Partial<TradeSeed> = {}): TradeSeed => ({
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
  ...over,
})

describe('资金日历：只呈现账本实际活动', () => {
  it('买入与卖出各按其方向计入金额合计，并保留原币金额', () => {
    const result = buildCashCalendar('2026-09', [], [buy(), sell()])

    expect(result.events.map((event) => event.source)).toEqual(['TRADE', 'TRADE'])
    expect(result.actualBuy).toBe(1000)
    expect(result.actualSell).toBe(600)
    expect(result.tradeCount).toBe(2)
    expect(result.buyCount).toBe(1)
    expect(result.sellCount).toBe(1)
    expect(result.settlementInflow).toBe(0)
    expect(result.events[0].direction).toBe('OUTFLOW')
    expect(result.events[1].direction).toBe('INFLOW')
    expect(result.events[0].amount).toBe(1000)
    expect(result.events[0].currency).toBe('CNY')
  })

  it('赎回到账在途单独成列，不计进实际买卖', () => {
    const result = buildCashCalendar(
      '2026-09',
      [{ id: 'redeem', title: '基金赎回到账', amountCny: 8000, dueDate: new Date(2026, 8, 12) }],
      [buy()],
    )

    expect(result.settlementInflow).toBe(8000)
    expect(result.settlementCount).toBe(1)
    expect(result.actualBuy).toBe(1000)
    expect(result.events.find((event) => event.source === 'SETTLEMENT')?.note).toContain('赎回结算日派生')
  })

  it('只保留当月事件，跨月流水被剔除', () => {
    const result = buildCashCalendar('2026-09', [], [
      buy(),
      buy({ id: 'buy-july', occurredAt: new Date(2026, 6, 15, 15) }),
      sell({ id: 'sell-oct', occurredAt: new Date(2026, 9, 2, 15) }),
    ])

    expect(result.events).toHaveLength(1)
    expect(result.events[0].id).toBe('trade:buy-a')
  })

  it('同一天先列实际买卖、后列赎回到账', () => {
    const result = buildCashCalendar(
      '2026-09',
      [{ id: 'redeem', title: '基金赎回到账', amountCny: 8000, dueDate: new Date(2026, 8, 15, 15) }],
      [buy()],
    )

    expect(result.events.map((event) => event.source)).toEqual(['TRADE', 'SETTLEMENT'])
  })

  it('实际买入可标注对应定投计划，但计划本身不产生日历事件', () => {
    const result = buildCashCalendar('2026-09', [], [
      buy({ relatedPlanName: '指数基金定投' }),
      buy({ id: 'buy-b', relatedPlanName: null, occurredAt: new Date(2026, 8, 16, 15) }),
    ])

    expect(result.linkedBuyCount).toBe(1)
    // 日历里只有两笔实际买入：没有计划节点占格，也没有计划额汇总
    expect(result.events).toHaveLength(2)
    expect(result.events.every((event) => event.source === 'TRADE')).toBe(true)
    expect(result.events[0].relatedPlanName).toBe('指数基金定投')
  })

  it('空输入返回零汇总而不是抛错', () => {
    const result = buildCashCalendar('2026-09')
    expect(result.events).toEqual([])
    expect(result.actualBuy).toBe(0)
    expect(result.actualSell).toBe(0)
    expect(result.settlementInflow).toBe(0)
    expect(result.tradeCount).toBe(0)
    expect(result.linkedBuyCount).toBe(0)
  })

  it('月份格式非法时明确失败', () => {
    expect(() => buildCashCalendar('2026/09')).toThrow('月份格式必须为 YYYY-MM')
    expect(() => buildCashCalendar('2026-13')).toThrow('月份格式必须为 YYYY-MM')
  })
})
