import { describe, expect, it } from 'vitest'
import { dailyQuoteValuation, summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'

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

describe('行情资产当日盈亏的唯一判定（总览 / 看盘 / 收益日历共用）', () => {
  const todayKey = '2026-09-16'

  it('报价交易日等于当前组合日时，现价与昨收都取自同一报价', () => {
    const result = dailyQuoteValuation({
      quantity: 100,
      quote: { price: 12, prevClose: 10, tradingDate: todayKey },
      fallbackValueCny: 900,
      todayKey,
    })
    expect(result.currentValueCny).toBe(1200)
    expect(result.previousValueCny).toBe(1000)
  })

  it('报价属于其它交易日时不参与当日盈亏（不再回退成另一个基准）', () => {
    const result = dailyQuoteValuation({
      quantity: 100,
      quote: { price: 12, prevClose: 10, tradingDate: '2026-09-15' },
      fallbackValueCny: 900,
      todayKey,
    })
    expect(result.currentValueCny).toBe(1200)
    expect(result.previousValueCny).toBeNull()
  })

  it('缺少报价时不虚构当日盈亏，并按回退市值计值', () => {
    const result = dailyQuoteValuation({ quantity: 100, quote: null, fallbackValueCny: 955, todayKey })
    expect(result.currentValueCny).toBe(955)
    expect(result.previousValueCny).toBeNull()
  })

  it('只有昨收缺失时不参与当日盈亏，但现价仍用于市值', () => {
    const result = dailyQuoteValuation({
      quantity: 10,
      quote: { price: 8, prevClose: null, tradingDate: todayKey },
      fallbackValueCny: 1,
      todayKey,
    })
    expect(result.currentValueCny).toBe(80)
    expect(result.previousValueCny).toBeNull()
  })

  it('原币报价按当日汇率统一折算一次', () => {
    const result = dailyQuoteValuation({
      quantity: 10,
      quote: { price: 8, prevClose: 7.5, tradingDate: todayKey },
      fallbackValueCny: 0,
      todayKey,
      rateToCny: 7,
    })
    expect(result.currentValueCny).toBe(560)
    expect(result.previousValueCny).toBe(525)
  })
})
