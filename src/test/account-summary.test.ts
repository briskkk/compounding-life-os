import { describe, expect, it } from 'vitest'
import { positionDayPnlCny, summarizeAccountPositions } from '@/lib/engine/account-summary'

describe('账户持仓摘要', () => {
  const positions = [
    {
      accountId: 'broker',
      assetId: 'etf',
      quantity: 10,
      value: 1_100,
      unrealized: 100,
      asset: { symbol: 'ETF', cls: 'ETF' as const },
    },
    {
      accountId: 'broker',
      assetId: 'cash',
      quantity: 500,
      value: 500,
      unrealized: 0,
      asset: { symbol: 'CASH-CNY', cls: 'CASH' as const },
    },
  ]

  it('汇总市值、现金、持仓数和已知当日盈亏', () => {
    const summary = summarizeAccountPositions(positions, (symbol) => symbol === 'ETF' ? 100 : null)
    expect(summary).toEqual({
      valueCny: 1_600,
      cashCny: 500,
      unrealizedCny: 100,
      dayPnlCny: 100,
      holdingCount: 2,
    })
  })

  it('无昨收数据时不伪造当日盈亏', () => {
    expect(summarizeAccountPositions(positions, () => null).dayPnlCny).toBeNull()
  })

  it('按当前市值与昨收市值计算单项当日盈亏', () => {
    expect(positionDayPnlCny({ quantity: 10, value: 1_100 }, 100)).toBe(100)
  })
})
