import { describe, expect, it } from 'vitest'
import { buildDesktopGlance } from '@/lib/engine/desktop-glance'
import { observeLivePortfolio } from '@/lib/engine/live-portfolio'
import { emptyPosition } from '@/lib/engine/ledger'
import { valuePosition, type ValuedPosition } from '@/lib/engine/valuation'
import type { EngineState, EngineQuote } from '@/lib/queries'

const now = new Date('2026-11-20T02:00:00Z')
function position(symbol = '510300', quantity = 10): ValuedPosition {
  return valuePosition(
    { ...emptyPosition('account', symbol), quantity, costBasis: 100 },
    { id: symbol, name: symbol, symbol, cls: 'ETF', currency: 'CNY', manual: false },
    () => 12,
  )
}
function quote(symbol = '510300', overrides: Partial<EngineQuote> = {}): EngineQuote {
  return {
    symbol, price: 12, priceCny: 12, prevClose: 10, prevCloseCny: 10, changePct: 20,
    tradingDate: '2026-11-20', asOf: '2026-11-20T01:59:00Z', source: 'test',
    kind: 'MARKET', freshness: 'LIVE', ...overrides,
  }
}
function state(valued = [position()], quotes = [quote()]): EngineState {
  return { valued, quotes: new Map(quotes.map((q) => [q.symbol, q])), inTransit: 0, netWorth: 800, investable: 120 } as EngineState
}

describe('桌面摘要的收益证据', () => {
  it('净资产直接取权威状态，收益与看盘同源，百分比为 0–100 单位', () => {
    const input = state()
    const result = buildDesktopGlance(input, now)
    expect(result.netWorth).toEqual({ netWorth: 800, investable: 120, dayPnl: 20, dayPct: 20 })
    expect(result.netWorth.dayPnl).toBe(observeLivePortfolio(input, now).summary.pnlCny)
    expect(result.valuation).toEqual({
      asOfDate: '2026-11-20', quoteAsOf: '2026-11-20T01:59:00.000Z',
      syncedAt: now.toISOString(), status: 'LIVE', coveragePct: 100,
    })
  })

  it('覆盖以行情资产绝对市值为分母，静态现金和在途不稀释覆盖', () => {
    const cash = valuePosition(
      { ...emptyPosition('account', 'cash'), quantity: 900 },
      { id: 'cash', name: '现金', symbol: 'CASH-CNY', cls: 'CASH', currency: 'CNY', manual: false },
      () => undefined,
    )
    const input = { ...state([position(), position('510500'), cash]), inTransit: 500 }
    const result = buildDesktopGlance(input, now)
    expect(result.valuation.status).toBe('PARTIAL')
    expect(result.valuation.coveragePct).toBe(50)
    expect(result.netWorth.dayPnl).toBe(20)
    expect(result.netWorth.dayPct).toBeCloseTo(20 / (240 + 900 + 500 - 20) * 100, 2)
  })

  it('周末/休市旧报价不沿用上个交易日收益，不把同步时间当行情时间', () => {
    const result = buildDesktopGlance(state(), new Date('2026-11-22T02:00:00Z'))
    expect(result.netWorth.dayPnl).toBeNull()
    expect(result.netWorth.dayPct).toBeNull()
    expect(result.valuation).toMatchObject({ status: 'UNAVAILABLE', asOfDate: null, quoteAsOf: null, coveragePct: 0 })
  })

  it('无行情与纯静态资产不虚构零损益或百分百覆盖', () => {
    expect(buildDesktopGlance(state([], []), now).valuation.coveragePct).toBeNull()
    const result = buildDesktopGlance(state([position()], []), now)
    expect(result.netWorth.dayPnl).toBeNull()
    expect(result.valuation.status).toBe('UNAVAILABLE')
  })

  it('美股场次 +1；跨市场两个收益归属日并存时不强填日期', () => {
    const evening = new Date('2026-11-20T15:00:00Z')
    const us = quote('USSPY', { asOf: '2026-11-20T14:59:00Z' })
    const onlyUs = buildDesktopGlance(state([position('USSPY')], [us]), evening)
    expect(onlyUs.valuation.asOfDate).toBe('2026-11-21')
    const mixed = buildDesktopGlance(state([position(), position('USSPY')], [quote(), us]), evening)
    expect(mixed.valuation.asOfDate).toBeNull()
    expect(mixed.valuation.status).toBe('ESTIMATED')
  })

  it('估算或未知时点不会升级为实时；行情水位取参与损益的最早可证时点', () => {
    const unknown = buildDesktopGlance(state([position()], [quote('510300', { freshness: 'UNKNOWN', asOf: now.toISOString() })]), now)
    expect(unknown.valuation.status).toBe('ESTIMATED')
    expect(unknown.valuation.quoteAsOf).toBeNull()
    const input = state([position(), position('510500')], [quote(), quote('510500', { asOf: '2026-11-20T01:58:00Z', kind: 'OFFICIAL_ESTIMATE' })])
    expect(buildDesktopGlance(input, now).valuation).toMatchObject({ status: 'ESTIMATED', quoteAsOf: '2026-11-20T01:58:00.000Z' })
    expect(buildDesktopGlance(state(), new Date('2026-11-20T03:00:00Z')).valuation.status).toBe('ESTIMATED')
  })

  it('同归属日全部官方净值才标结算；市场收盘仍为估算', () => {
    expect(buildDesktopGlance(state([position()], [quote('510300', { kind: 'OFFICIAL_NAV', freshness: 'CLOSED' })]), now).valuation.status).toBe('SETTLED')
    expect(buildDesktopGlance(state([position()], [quote('510300', { freshness: 'CLOSED' })]), now).valuation.status).toBe('ESTIMATED')
  })

  it('当天清仓仍计账本损益；零市值分母保持 null', () => {
    const sold = { ...position('510300', 0), dailyActivity: { tradingDate: '2026-11-20', quantityDelta: -10, cashFlowCny: 119 } }
    const result = buildDesktopGlance(state([sold]), now)
    expect(result.netWorth.dayPnl).toBe(19)
    expect(result.netWorth.dayPct).toBeNull()
    expect(result.valuation.coveragePct).toBeNull()
  })
})
