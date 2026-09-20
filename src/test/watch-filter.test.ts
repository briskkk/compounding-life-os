import { describe, expect, it } from 'vitest'
import { WATCH_OTHER_CLASS, parseWatchClassFilter } from '@/lib/engine/watch-filter'

describe('看盘筛选参数解析', () => {
  it('只接受登记过的资产大类', () => {
    expect(parseWatchClassFilter('STOCK')).toBe('STOCK')
    expect(parseWatchClassFilter('ETF')).toBe('ETF')
    expect(parseWatchClassFilter('FUND')).toBe('FUND')
    expect(parseWatchClassFilter('GOLD')).toBe('GOLD')
    expect(parseWatchClassFilter(WATCH_OTHER_CLASS)).toBe(WATCH_OTHER_CLASS)
  })

  it('未知值与空值一律按「不筛选」处理', () => {
    expect(parseWatchClassFilter('CASH')).toBeNull()
    expect(parseWatchClassFilter('REAL_ESTATE')).toBeNull()
    expect(parseWatchClassFilter('stock')).toBeNull()
    expect(parseWatchClassFilter('')).toBeNull()
    expect(parseWatchClassFilter(undefined)).toBeNull()
    expect(parseWatchClassFilter(null)).toBeNull()
  })
})
