import { describe, expect, it } from 'vitest'
import {
  attributionDateKey,
  liveAttributionDates,
  livePreviousClose,
  liveQuoteAttribution,
  portfolioDayOffset,
} from '@/lib/engine/portfolio-day'

const US = { symbol: 'USSMH', currency: 'USD', cls: 'ETF' }
const CN = { symbol: '510300', currency: 'CNY', cls: 'ETF' }
const HK = { symbol: 'HK00700', currency: 'HKD', cls: 'STOCK' }
const FUND = { symbol: '110022', currency: 'CNY', cls: 'FUND' }

describe('北京归属偏移', () => {
  it('只有美股 +1，其余市场当日', () => {
    expect(portfolioDayOffset(US)).toBe(1)
    expect(portfolioDayOffset(CN)).toBe(0)
    expect(portfolioDayOffset(HK)).toBe(0)
    expect(portfolioDayOffset(FUND)).toBe(0)
    expect(portfolioDayOffset({ symbol: 'USVGT' })).toBe(1)
    expect(portfolioDayOffset({ symbol: 'CASH-USD', cls: 'CASH' })).toBe(0)
    expect(portfolioDayOffset({ symbol: '不是代码' })).toBe(0)
  })

  it('交易所交易日折算为北京归属日', () => {
    expect(attributionDateKey(US, '2026-09-15')).toBe('2026-09-16')
    expect(attributionDateKey(CN, '2026-09-15')).toBe('2026-09-15')
    expect(attributionDateKey(HK, '2026-09-15')).toBe('2026-09-15')
    // 跨月 / 跨年
    expect(attributionDateKey(US, '2026-09-30')).toBe('2026-10-01')
    expect(attributionDateKey(US, '2026-12-31')).toBe('2027-01-01')
    expect(attributionDateKey(US, null)).toBeNull()
    expect(attributionDateKey(US, '2026/09/15')).toBeNull()
  })
})

describe('实时“今日涨跌”的归属窗口', () => {
  it('美股允许北京今天与明天两格，其余市场只允许北京今天', () => {
    const now = new Date('2026-09-16T02:00:00Z') // 北京 09-16 10:00
    expect(liveAttributionDates(US, now)).toEqual(['2026-09-16', '2026-09-17'])
    expect(liveAttributionDates(CN, now)).toEqual(['2026-09-16'])
  })

  it('美股上一场（美东 09-15）在北京白天计入今天', () => {
    const now = new Date('2026-09-16T02:00:00Z')
    expect(liveQuoteAttribution({ asset: US, exchangeTradingDate: '2026-09-15', now }))
      .toEqual({ attributionDate: '2026-09-16', included: true })
    expect(livePreviousClose({ asset: US, exchangeTradingDate: '2026-09-15', prevClose: 280, now })).toBe(280)
    // 美东 09-14 的场次归属北京 09-15，不参与北京 09-16
    expect(liveQuoteAttribution({ asset: US, exchangeTradingDate: '2026-09-14', now }).included).toBe(false)
    expect(livePreviousClose({ asset: US, exchangeTradingDate: '2026-09-14', prevClose: 280, now })).toBeNull()
  })

  it('北京晚间正在进行的美股场次归属明天，实时口径仍纳入', () => {
    const evening = new Date('2026-09-16T14:00:00Z') // 北京 09-16 22:00
    expect(liveQuoteAttribution({ asset: US, exchangeTradingDate: '2026-09-16', now: evening }))
      .toEqual({ attributionDate: '2026-09-17', included: true })
    // 同一时刻 A 股当日场次仍归属北京今天
    expect(liveQuoteAttribution({ asset: CN, exchangeTradingDate: '2026-09-16', now: evening }).included).toBe(true)
  })

  it('昨收无效时返回 null，不虚构基准', () => {
    const now = new Date('2026-09-16T02:00:00Z')
    expect(livePreviousClose({ asset: US, exchangeTradingDate: '2026-09-15', prevClose: null, now })).toBeNull()
    expect(livePreviousClose({ asset: US, exchangeTradingDate: '2026-09-15', prevClose: Number.NaN, now })).toBeNull()
    expect(livePreviousClose({ asset: US, exchangeTradingDate: null, prevClose: 280, now })).toBeNull()
  })
})
