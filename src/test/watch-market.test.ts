import { describe, expect, it } from 'vitest'
import {
  dateKeyAt,
  isCurrentPortfolioDay,
  previousCloseOnPortfolioDay,
  seriesPortfolioDate,
  seriesTradingDate,
  summarizeValuationDate,
} from '@/lib/engine/watch-market'

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

  it('今日收益严格按交易所交易日归属，不把美股昨日收益带到次日', () => {
    expect(isCurrentPortfolioDay('2026-07-31', '2026-07-31')).toBe(true)
    expect(isCurrentPortfolioDay('2026-07-31', '2026-08-01')).toBe(false)
    expect(isCurrentPortfolioDay(null, '2026-08-01')).toBe(false)
    expect(previousCloseOnPortfolioDay(280, '2026-07-31', '2026-08-01')).toBeNull()
    expect(previousCloseOnPortfolioDay(280, '2026-08-01', '2026-08-01')).toBe(280)
  })

  it('北京时间日期键不受运行机器时区影响', () => {
    expect(dateKeyAt(new Date('2026-08-02T16:30:00Z'))).toBe('2026-08-03')
  })

  it('实时估值沿用实际交易日，并计算该日行情覆盖率', () => {
    expect(summarizeValuationDate([
      { tradingDate: '2026-08-17', valueCny: 80 },
      { tradingDate: '2026-08-14', valueCny: 20 },
    ])).toEqual({ date: '2026-08-17', coverage: 0.8 })
    expect(summarizeValuationDate([{ tradingDate: null, valueCny: 100 }])).toBeNull()
  })
})
