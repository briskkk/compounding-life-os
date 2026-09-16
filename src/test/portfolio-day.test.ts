import { describe, expect, it } from 'vitest'
import { portfolioDayKey, portfolioDayZone } from '@/lib/engine/portfolio-day'

describe('组合日：按市场时区判定「今日」', () => {
  it('美股在北京白天取上一交易日、在北京夜间取当日', () => {
    // 北京 2026-09-16 10:00 = 纽约 2026-09-15 22:00 → 美股当日为 09-15
    expect(portfolioDayKey({ symbol: 'USSMH', currency: 'USD' }, new Date('2026-09-16T02:00:00Z'))).toBe('2026-09-15')
    // 北京 2026-09-16 22:00 = 纽约 2026-09-16 10:00（已开盘）→ 美股当日为 09-16
    expect(portfolioDayKey({ symbol: 'USSMH', currency: 'USD' }, new Date('2026-09-16T14:00:00Z'))).toBe('2026-09-16')
  })

  it('港股与 A 股 / 场外基金跟随北京日期', () => {
    expect(portfolioDayKey({ symbol: 'HK00700', currency: 'HKD' }, new Date('2026-09-16T02:00:00Z'))).toBe('2026-09-16')
    expect(portfolioDayKey({ symbol: '600519', currency: 'CNY' }, new Date('2026-09-16T02:00:00Z'))).toBe('2026-09-16')
    expect(portfolioDayKey({ symbol: '110022', currency: 'CNY', cls: 'FUND' }, new Date('2026-09-16T02:00:00Z'))).toBe('2026-09-16')
  })

  it('没有币种时按代码前缀判断市场', () => {
    expect(portfolioDayZone({ symbol: 'USVGT' })).toBe('America/New_York')
    expect(portfolioDayZone({ symbol: 'HK00700' })).toBe('Asia/Hong_Kong')
    expect(portfolioDayZone({ symbol: '600519' })).toBe('Asia/Shanghai')
    expect(portfolioDayZone({ symbol: '不是代码' })).toBe('Asia/Shanghai')
  })
})
