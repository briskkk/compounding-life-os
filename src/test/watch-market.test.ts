import { describe, expect, it } from 'vitest'
import { dateKeyAt, isCurrentPortfolioDay, seriesPortfolioDate, seriesTradingDate } from '@/lib/engine/watch-market'

describe('看盘交易日口径', () => {
  it('按交易所时区标注交易日，按北京时间判断曲线日期', () => {
    const series = {
      symbol: 'USQQQM',
      currency: 'USD',
      prevClose: 280,
      source: 'YAHOO',
      points: [{ t: new Date('2026-08-01T03:59:00Z').getTime(), price: 283 }],
    }
    expect(seriesTradingDate(series, 'USD', 'ETF')).toBe('2026-07-31')
    expect(seriesPortfolioDate(series)).toBe('2026-08-01')
  })

  it('美股交易日在开盘当晚与次日凌晨均属于当前看盘日', () => {
    expect(isCurrentPortfolioDay('2026-07-31', 'USD', '2026-07-31')).toBe(true)
    expect(isCurrentPortfolioDay('2026-07-31', 'USD', '2026-08-01')).toBe(true)
    expect(isCurrentPortfolioDay('2026-07-31', 'USD', '2026-08-03')).toBe(false)
    expect(isCurrentPortfolioDay('2026-07-31', 'CNY', '2026-08-01')).toBe(false)
  })

  it('北京时间日期键不受运行机器时区影响', () => {
    expect(dateKeyAt(new Date('2026-08-02T16:30:00Z'))).toBe('2026-08-03')
  })
})
