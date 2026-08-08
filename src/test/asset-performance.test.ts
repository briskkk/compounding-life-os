import { describe, expect, it } from 'vitest'
import { buildAssetPerformanceSeries, toAssetNavPoint } from '@/lib/engine/asset-performance'
import type { LedgerTx } from '@/lib/engine/ledger'
import type { AssetInfo } from '@/lib/engine/types'
import { performanceBetween } from '@/lib/engine/period-performance'

const stock: AssetInfo = {
  id: 'asset-1',
  symbol: 'CN:600519',
  name: '测试股票',
  cls: 'STOCK',
  manual: false,
  currency: 'CNY',
}

function tx(partial: Partial<LedgerTx> & Pick<LedgerTx, 'type'>): LedgerTx {
  return {
    accountId: 'account-1',
    assetId: 'asset-1',
    quantity: null,
    price: null,
    amount: 0,
    fee: 0,
    occurredAt: new Date('2025-01-01T12:00:00+08:00'),
    assetClass: 'STOCK',
    ...partial,
  }
}

describe('单资产历史收益', () => {
  it('基金北京时间零点净值不会被 UTC 截到前一天', () => {
    expect(toAssetNavPoint(new Date('2026-08-02T16:00:00Z'), 1.234).date).toBe('2026-08-03')
  })

  it('逐日回放持仓和净值，并把分红计入资产总回报', () => {
    const series = buildAssetPerformanceSeries({
      asset: stock,
      transactions: [
        tx({ type: 'BUY', quantity: 10, price: 10, amount: 100 }),
        tx({ type: 'DIVIDEND', amount: 5, occurredAt: new Date('2025-01-03T12:00:00+08:00') }),
      ],
      prices: [
        { date: '2025-01-01', nav: 10 },
        { date: '2025-01-02', nav: 11 },
        { date: '2025-01-03', nav: 11 },
      ],
      to: new Date('2025-01-03T12:00:00+08:00'),
    })

    expect(series.map((point) => point.date)).toEqual([
      '2024-12-31',
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
    ])
    expect(series.at(-1)).toMatchObject({ quantity: 10, nav: 11, netWorth: 110, contributions: 95 })

    const result = performanceBetween(series, '2025-01-01', '2025-01-03')
    expect(result.amount).toBe(15)
    expect(result.pct).toBeCloseTo(0.15)
    expect(result.curve.map((point) => point.dailyAmount)).toEqual([null, 0, 10, 5])
    expect(result.curve.at(-1)?.dailyPct).toBeCloseTo(5 / 110)
  })

  it('以估值流水重建华为股票的当日净值和市值', () => {
    const huawei: AssetInfo = {
      ...stock,
      name: '华为股票',
      symbol: 'HUAWEI-ESOP',
      cls: 'HUAWEI_STOCK',
      manual: true,
    }
    const series = buildAssetPerformanceSeries({
      asset: huawei,
      transactions: [
        tx({
          type: 'BUY',
          quantity: 100,
          price: 8,
          amount: 800,
          assetClass: 'HUAWEI_STOCK',
        }),
        tx({
          type: 'VALUATION',
          amount: 900,
          assetClass: 'HUAWEI_STOCK',
          occurredAt: new Date('2025-01-03T12:00:00+08:00'),
        }),
      ],
      prices: [],
      to: new Date('2025-01-03T12:00:00+08:00'),
    })

    expect(series.find((point) => point.date === '2025-01-02')).toMatchObject({
      quantity: 100,
      nav: 8,
      netWorth: 800,
      valuationStatus: 'NO_UPDATE',
    })
    expect(series.at(-1)).toMatchObject({ quantity: 100, nav: 9, netWorth: 900, valuationStatus: 'SETTLED' })
  })

  it('现金利息只计算一次收益', () => {
    const cash: AssetInfo = {
      ...stock,
      symbol: 'CASH-CNY',
      cls: 'CASH',
      manual: true,
    }
    const series = buildAssetPerformanceSeries({
      asset: cash,
      transactions: [
        tx({ type: 'DEPOSIT', amount: 100, assetClass: 'CASH' }),
        tx({
          type: 'INTEREST',
          amount: 5,
          assetClass: 'CASH',
          occurredAt: new Date('2025-01-02T12:00:00+08:00'),
        }),
      ],
      prices: [],
      to: new Date('2025-01-02T12:00:00+08:00'),
    })

    const result = performanceBetween(series, '2025-01-01', '2025-01-02')
    expect(series.at(-1)).toMatchObject({ quantity: 105, netWorth: 105, contributions: 100 })
    expect(series.find((point) => point.date === '2025-01-01')?.valuationStatus).toBe('FLOW_ONLY')
    expect(series.at(-1)?.valuationStatus).toBe('SETTLED')
    expect(result.amount).toBe(5)
    expect(result.curve.at(-1)?.dailyAmount).toBe(5)
  })

  it.each(['STOCK', 'ETF', 'FUND', 'GOLD'] as const)('%s 在周末沿用价格时收益为“无观察”', (cls) => {
    const asset: AssetInfo = { ...stock, cls, symbol: `TEST-${cls}` }
    const series = buildAssetPerformanceSeries({
      asset,
      transactions: [tx({
        type: 'BUY',
        quantity: 10,
        price: 10,
        amount: 100,
        assetClass: cls,
        occurredAt: new Date('2026-07-31T12:00:00+08:00'),
      })],
      prices: [
        { date: '2026-07-31', nav: 10 },
        { date: '2026-08-03', nav: 11 },
      ],
      to: new Date('2026-08-03T12:00:00+08:00'),
    })

    expect(series.find((point) => point.date === '2026-08-01')?.valuationStatus).toBe('CLOSED')
    expect(series.find((point) => point.date === '2026-08-02')?.valuationStatus).toBe('CLOSED')
    const result = performanceBetween(series, '2026-08-01', '2026-08-03')
    expect(result.curve.find((point) => point.date === '2026-08-01')?.dailyPct).toBeNull()
    expect(result.curve.find((point) => point.date === '2026-08-02')?.dailyPct).toBeNull()
    expect(result.curve.find((point) => point.date === '2026-08-03')?.dailyAmount).toBe(10)
  })

  it('交易日有新价格但涨跌恰好为零时保留 0% 收益', () => {
    const series = buildAssetPerformanceSeries({
      asset: stock,
      transactions: [tx({ type: 'BUY', quantity: 10, price: 10, amount: 100 })],
      prices: [
        { date: '2025-01-01', nav: 10 },
        { date: '2025-01-02', nav: 10 },
      ],
      to: new Date('2025-01-02T12:00:00+08:00'),
    })

    const result = performanceBetween(series, '2025-01-02', '2025-01-02')
    expect(series.at(-1)?.valuationStatus).toBe('SETTLED')
    expect(result.curve.at(-1)?.dailyPct).toBe(0)
    expect(result.curve.at(-1)?.dailyAmount).toBe(0)
  })
})
