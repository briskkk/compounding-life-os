import { describe, expect, it } from 'vitest'
import { defaultTransactionDate, isAShareAsset } from '@/lib/engine/trade-time'

describe('日期录入的默认成交时间', () => {
  it.each([['600519', 'STOCK'], ['159560', 'ETF'], ['161128', 'ETF']])('A股和场内LOF统一北京时间10点：%s', (symbol, cls) => {
    expect(defaultTransactionDate('2026-10-09', { symbol, cls }).toISOString()).toBe('2026-10-09T02:00:00.000Z')
  })

  it.each([['161128', 'FUND'], ['HK00700', 'STOCK'], ['USAAPL', 'STOCK'], ['CASH-CNY', 'CASH']])('不更改其他市场和资产的日期录入默认值：%s', (symbol, cls) => {
    expect(isAShareAsset({ symbol, cls })).toBe(false)
    expect(defaultTransactionDate('2026-10-09', { symbol, cls })).toEqual(new Date('2026-10-09T12:00:00'))
  })
})
