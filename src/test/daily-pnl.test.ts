import { describe, expect, it } from 'vitest'
import { summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'

describe('组合当日行情汇总', () => {
  it('以全部行情持仓昨收为基准并将静态资产计入组合市值', () => {
    const summary = summarizeDailyPortfolio(
      [
        { currentValueCny: 1100, previousValueCny: 1000 },
        { currentValueCny: 450, previousValueCny: 500 },
      ],
      5000,
    )

    expect(summary.valueCny).toBe(6550)
    expect(summary.pnlCny).toBe(50)
    expect(summary.baselineCny).toBe(6500)
    expect(summary.pnlPct).toBeCloseTo(50 / 6500)
  })

  it('缺少昨收的行情持仓保留市值但不虚构当日盈亏', () => {
    const summary = summarizeDailyPortfolio([{ currentValueCny: 1200, previousValueCny: null }], 300)
    expect(summary.valueCny).toBe(1500)
    expect(summary.pnlCny).toBe(0)
    expect(summary.baselineCny).toBe(1500)
  })
})
