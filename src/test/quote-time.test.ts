import { describe, expect, it } from 'vitest'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { simulatedProvider } from '@/lib/market'
import { exchangeTimeToIso, marketQuoteFreshness } from '@/lib/market/quote-time'

describe('行情时间与新鲜度语义', () => {
  it('按市场时区把 A/H/美股源时间转换为无歧义 ISO', () => {
    expect(exchangeTimeToIso('20260824110000', 'CN_A')).toBe('2026-08-24T03:00:00.000Z')
    expect(exchangeTimeToIso('2026/08/24 11:00:00', 'HK')).toBe('2026-08-24T03:00:00.000Z')
    expect(exchangeTimeToIso('2026-08-21 16:00:01', 'US')).toBe('2026-08-21T20:00:01.000Z')
  })

  it('交易时段内仅把 15 分钟内的同日数据标为实时', () => {
    const receivedAt = new Date('2026-08-24T03:05:00.000Z')
    expect(marketQuoteFreshness('CN_A', '2026-08-24T03:00:00.000Z', '2026-08-24', receivedAt)).toBe('LIVE')
    expect(marketQuoteFreshness('CN_A', '2026-08-24T02:45:00.000Z', '2026-08-24', receivedAt)).toBe('DELAYED')
    expect(marketQuoteFreshness('CN_A', '2026-08-24T02:30:00.000Z', '2026-08-24', receivedAt)).toBe('STALE')
    expect(marketQuoteFreshness('CN_A', '2026-08-21T07:00:00.000Z', '2026-08-21', receivedAt)).toBe('STALE')
  })

  it('休市时最近收盘价标为 CLOSED，无法证明时标为 UNKNOWN', () => {
    const afterClose = new Date('2026-08-24T08:30:00.000Z')
    expect(marketQuoteFreshness('HK', '2026-08-24T08:00:00.000Z', '2026-08-24', afterClose)).toBe('CLOSED')
    expect(marketQuoteFreshness('US', null, '2026-08-24', afterClose)).toBe('UNKNOWN')
  })

  it('模拟报价携带对应市场的交易日，供今日收益口径对齐', async () => {
    const cn = await simulatedProvider.quote('510300')
    const cnAgain = await simulatedProvider.quote('510300')
    const us = await simulatedProvider.quote('USAAPL')

    expect(cn.tradingDate).toBe(dateKeyAt(new Date(cn.asOf), 'Asia/Shanghai'))
    expect(us.tradingDate).toBe(dateKeyAt(new Date(us.asOf), 'America/New_York'))
    expect(cnAgain.price).toBe(cn.price)
    expect(cnAgain.prevClose).toBe(cn.prevClose)
  })
})
