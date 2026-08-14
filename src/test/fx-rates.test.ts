// 历史汇率（RateBar）测试：按日折算、缺失回落、持久化幂等
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { fxRateAt, loadFxSeries, persistDailyFx, type FxSeriesMap } from '@/lib/market/fx'

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })

const live = { USDCNY: 7.2, HKDCNY: 0.92 }

function seriesOf(rows: { pair: string; date: Date; rate: number }[]): FxSeriesMap {
  const map: FxSeriesMap = new Map()
  for (const r of rows) {
    let s = map.get(r.pair)
    if (!s) {
      s = { times: [], rates: [] }
      map.set(r.pair, s)
    }
    s.times.push(r.date.getTime())
    s.rates.push(r.rate)
  }
  return map
}

describe('fxRateAt（按日汇率）', () => {
  it('当日有 RateBar 时使用当日汇率', () => {
    const series = seriesOf([
      { pair: 'USDCNY', date: new Date('2026-01-01T00:00:00Z'), rate: 7.0 },
      { pair: 'USDCNY', date: new Date('2026-01-02T00:00:00Z'), rate: 7.1 },
    ])
    expect(fxRateAt(series, live, 'USD', new Date('2026-01-02T12:00:00Z'))).toBe(7.1)
  })

  it('缺失日期回落最近可用历史汇率（不晚于该日）', () => {
    const series = seriesOf([
      { pair: 'USDCNY', date: new Date('2026-01-01T00:00:00Z'), rate: 7.0 },
      { pair: 'USDCNY', date: new Date('2026-01-05T00:00:00Z'), rate: 7.3 },
    ])
    // 1 月 3 日无记录 → 回落 1 月 1 日
    expect(fxRateAt(series, live, 'USD', new Date('2026-01-03T00:00:00Z'))).toBe(7.0)
    // 1 月 6 日无记录 → 回落 1 月 5 日
    expect(fxRateAt(series, live, 'USD', new Date('2026-01-06T00:00:00Z'))).toBe(7.3)
  })

  it('早于全部记录时回落实时汇率', () => {
    const series = seriesOf([
      { pair: 'USDCNY', date: new Date('2026-01-05T00:00:00Z'), rate: 7.3 },
    ])
    expect(fxRateAt(series, live, 'USD', new Date('2026-01-01T00:00:00Z'))).toBe(7.2)
  })

  it('CNY / 未知币种恒为 1', () => {
    const series = seriesOf([])
    expect(fxRateAt(series, live, 'CNY', new Date('2026-01-01T00:00:00Z'))).toBe(1)
    expect(fxRateAt(series, live, 'EUR', new Date('2026-01-01T00:00:00Z'))).toBe(1)
  })

  it('HKD 使用 HKDCNY 序列', () => {
    const series = seriesOf([
      { pair: 'HKDCNY', date: new Date('2026-01-01T00:00:00Z'), rate: 0.9 },
    ])
    expect(fxRateAt(series, live, 'HKD', new Date('2026-01-02T00:00:00Z'))).toBe(0.9)
  })
})

describe('persistDailyFx / loadFxSeries（落库）', () => {
  beforeAll(async () => {
    // 清空测试家庭无关的 RateBar（test.db 全局共享）
    await base.rateBar.deleteMany({})
  })

  afterAll(async () => {
    await base.$disconnect()
  })

  it('幂等写入当日汇率，loadFxSeries 可读回', async () => {
    const written = await persistDailyFx(base, { USDCNY: 7.15, HKDCNY: 0.915 })
    expect(written).toBe(2)
    // 同日再次写入应覆盖而非新增
    await persistDailyFx(base, { USDCNY: 7.16, HKDCNY: 0.916 })
    const map = await loadFxSeries(base)
    const usd = map.get('USDCNY')
    expect(usd?.times).toHaveLength(1)
    expect(usd?.rates[0]).toBe(7.16)
  })
})
