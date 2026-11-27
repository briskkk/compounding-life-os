// 北京归属口径（ADR-027）：美股美东 D 日的行情记进北京 D+1 格
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { rebuildSnapshots } from '@/lib/snapshots'
import { monthDailyPoints } from '@/lib/engine/returns-calendar'
import { buildAssetPerformanceSeries, toAssetNavPoint } from '@/lib/engine/asset-performance'
import type { PerformancePoint } from '@/lib/engine/period-performance'

// 本组只验证交易场次归属，汇率保持固定，不依赖其它测试留下的 RateBar 或外部网络。
vi.mock('@/lib/market/fx', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/market/fx')>(),
  fxRateAtFactory: async () => (currency: string) => currency === 'USD' ? 7.2 : 1,
}))

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })

// PriceBar 无家庭作用域，符号必须全库唯一，避免与其它测试文件互相污染
const US_SYMBOL = 'USBJTST'
const D = (s: string) => new Date(s)

let famId: string
let accId: string
let assetId: string

beforeAll(async () => {
  const fam = await base.familySpace.create({ data: { name: '北京归属测试家' } })
  famId = fam.id
  const acc = await base.account.create({ data: { familyId: famId, name: '美股券商', type: 'BROKERAGE', currency: 'USD' } })
  accId = acc.id
  const asset = await base.asset.create({
    data: { familyId: famId, symbol: US_SYMBOL, name: '测试美股ETF', cls: 'ETF', currency: 'USD' },
  })
  assetId = asset.id
  await base.transaction.create({
    data: { familyId: famId, accountId: accId, assetId, type: 'BUY', quantity: 10, price: 90, amount: 900, fee: 0, occurredAt: D('2026-01-02T00:00:00Z') },
  })
  // 美东 01-02（周五）与 01-05（周一）两根日线：真实交易所日期入库
  await base.priceBar.createMany({
    data: [
      { symbol: US_SYMBOL, date: D('2026-01-02T00:00:00Z'), close: 90, source: 'TEST' },
      { symbol: US_SYMBOL, date: D('2026-01-05T00:00:00Z'), close: 100, source: 'TEST' },
    ],
  })
  await rebuildSnapshots(base, famId)
})

afterAll(async () => {
  await base.$disconnect()
})

async function snapshotAt(day: string): Promise<PerformancePoint> {
  const row = await base.snapshot.findFirst({ where: { familyId: famId, date: D(`${day}T00:00:00Z`) } })
  expect(row, `缺少 ${day} 快照`).not.toBeNull()
  return {
    date: day,
    netWorth: Number(row!.investable),
    contributions: Number(row!.contributions),
    valuationStatus: row!.valuationStatus as PerformancePoint['valuationStatus'],
    valuationCoverage: row!.valuationCoverage,
    latestValuationDate: row!.latestValuationDate ? row!.latestValuationDate.toISOString().slice(0, 10) : null,
  }
}

describe('北京归属：美股收益不落在美东那一天', () => {
  it('美东 01-05 的场次计入北京 01-06，北京 01-05 仍沿用 01-02 收盘', async () => {
    const jan5 = await snapshotAt('2026-01-05')
    const jan6 = await snapshotAt('2026-01-06')
    // 01-05 北京：只能用美东 01-02 的收盘（归属北京 01-03），当天没有新的收益观察
    expect(jan5.latestValuationDate).toBe('2026-01-03')
    // 01-06 北京：美东 01-05 收盘落格（90 → 100），估值证据日同样是北京归属日
    expect(jan6.latestValuationDate).toBe('2026-01-06')
    expect(jan6.netWorth / jan5.netWorth).toBeCloseTo(100 / 90, 2)
  })

  it('收益日历把这一场记在北京 01-06，01-05 无收益观察', async () => {
    const series = await Promise.all(['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'].map(snapshotAt))
    const daily = monthDailyPoints(series, '2026-01')
    const jan5 = series.find((point) => point.date === '2026-01-05')!
    const jan6 = series.find((point) => point.date === '2026-01-06')!
    // 该场收益（≈ 10 × (100 − 90) × 汇率）整体落在北京 01-06 那一格
    expect(daily.get('2026-01-06')?.dailyAmount).toBe(jan6.netWorth - jan5.netWorth)
    expect(daily.get('2026-01-06')?.dailyAmount).toBeGreaterThan(0)
    expect(daily.get('2026-01-05')?.dailyAmount == null).toBe(true)
  })

  it('单资产收益序列同样按北京归属日平移', async () => {
    const prices = [
      toAssetNavPoint(D('2026-01-02T00:00:00Z'), 90, 'TEST', undefined, 1),
      toAssetNavPoint(D('2026-01-05T00:00:00Z'), 100, 'TEST', undefined, 1),
    ]
    expect(prices.map((point) => point.date)).toEqual(['2026-01-03', '2026-01-06'])
    const series = buildAssetPerformanceSeries({
      asset: { id: assetId, symbol: US_SYMBOL, name: '测试美股ETF', cls: 'ETF', manual: false, currency: 'USD' },
      transactions: [{
        id: 'tx-buy', accountId: accId, assetId, type: 'BUY', quantity: 10, price: 90, amount: 900,
        fee: 0, occurredAt: D('2026-01-02T00:00:00Z'), assetClass: 'ETF',
      }],
      prices,
      to: D('2026-01-07T00:00:00Z'),
      currencyRate: 1,
    })
    const jan6 = series.find((point) => point.date === '2026-01-06')
    expect(jan6?.nav).toBe(100)
    expect(jan6?.valuationStatus).toBe('SETTLED')
  })
})
