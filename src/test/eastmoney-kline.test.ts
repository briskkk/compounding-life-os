import { describe, expect, it } from 'vitest'
import { parseEastmoneyKlines, secidFor } from '@/lib/market/eastmoney-kline'

describe('东财 K 线源', () => {
  it('secid 映射：沪市 1 前缀、深市 0 前缀、指数前缀去除', () => {
    expect(secidFor('515880')).toBe('1.515880') // 沪 ETF
    expect(secidFor('159560')).toBe('0.159560') // 深 ETF
    expect(secidFor('600519')).toBe('1.600519')
    expect(secidFor('000333')).toBe('0.000333')
    expect(secidFor('sh000300')).toBe('1.000300')
    expect(secidFor('sz399006')).toBe('0.399006')
    expect(secidFor('110022')).toBeNull() // 场外基金无交易所 K 线
    expect(secidFor('USQQQM')).toBeNull()
    expect(secidFor('AU9999')).toBeNull()
  })

  it('解析日 K 报文：过滤非法行与区间外日期', () => {
    const from = new Date('2026-08-01T00:00:00Z')
    const to = new Date('2026-08-12T00:00:00Z')
    const bars = parseEastmoneyKlines(
      [
        '2026-07-31,0.570,0.582,0.595,0.570,46569718', // 区间外
        '2026-08-03,0.570,0.582,0.595,0.570,46569718',
        '2026-08-04,0.598,0.637,0.640,0.597,93309241',
        'bad,row',
      ],
      from,
      to,
    )
    expect(bars).toHaveLength(2)
    expect(bars[0]).toEqual({ date: new Date('2026-08-03T00:00:00Z'), close: 0.582, open: 0.57, high: 0.595, low: 0.57 })
    expect(bars[1].close).toBe(0.637)
  })
})
