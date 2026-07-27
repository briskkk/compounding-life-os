import { describe, expect, it } from 'vitest'
import { estimateFund, estimateLinkedFund, estimateMinuteSeries, type FundHolding } from '@/lib/engine/fund-estimate'
import { parseHoldings, parseEquityRatio } from '@/lib/market/fund-holdings'
import { bestFitIndex, closesToReturns, pearson } from '@/lib/engine/benchmark'

const holdings: FundHolding[] = [
  { code: '600519', name: '贵州茅台', weightPct: 10 },
  { code: '000333', name: '美的集团', weightPct: 8 },
]

describe('基金盘中估值引擎', () => {
  it('加权涨幅 + 残差指数代理 + 置信度', () => {
    const r = estimateFund({
      holdings,
      equityRatioPct: 30,
      indexChangePct: 1,
      stockChanges: new Map([
        ['600519', 2], // +2%
        ['000333', -1], // −1%
      ]),
      prevNav: 2,
    })
    // 10×2 + 8×(−1) = 12bp → 0.12%；残差 = 30−18=12 × 1% = 0.12%
    expect(r.estimateReturnPct).toBeCloseTo(0.24, 6)
    expect(r.estimatedNav).toBeCloseTo(2 * 1.0024, 6)
    // 置信度 = 已定价 18 / 30 = 60%
    expect(r.confidencePct).toBeCloseTo(60, 1)
    expect(r.contributions[0].code).toBe('600519') // 贡献最大者在前
    expect(r.contributions[0].contributionPct).toBeCloseTo(0.2, 6)
  })

  it('无报价持仓按指数代理且不计入置信度', () => {
    const r = estimateFund({
      holdings,
      equityRatioPct: 30,
      indexChangePct: 1,
      stockChanges: new Map([['600519', 2]]),
      prevNav: 2,
    })
    // 000333 以指数 1% 代理：10×2 + 8×1 + 12×1 = 0.4%
    expect(r.estimateReturnPct).toBeCloseTo(0.4, 6)
    expect(r.confidencePct).toBeCloseTo(33.33, 1)
    expect(r.contributions.find((c) => c.code === '000333')?.changePct).toBeNull()
  })

  it('分钟级序列：重仓分钟线 + 指数分钟线逐点合成', () => {
    const t0 = Date.parse('2026-07-27T09:30:00+08:00')
    const stock = { points: [{ t: t0, price: 11 }], prevClose: 10 } // +10%
    const index = {
      points: [
        { t: t0, price: 4000 },
        { t: t0 + 60000, price: 4020 },
      ],
      prevClose: 4000,
    }
    const out = estimateMinuteSeries(
      [{ code: '600519', name: '茅台', weightPct: 20 }],
      50,
      2,
      new Map([['600519', stock]]),
      index,
      4000,
    )
    expect(out).toHaveLength(2)
    // t0：个股 +10%，指数 0% → (20×0.10 + 30×0)/100 = 2% → nav 2.04
    expect(out[0].price).toBeCloseTo(2.04, 4)
    // t1：指数 +0.5%，个股仍 +10% → (20×0.10 + 30×0.005)/100 = 2.15%
    expect(out[1].price).toBeCloseTo(2 * 1.0215, 4)
  })
})

describe('联接基金（目标 ETF 驱动）', () => {
  it('估算涨幅 = 目标ETF涨幅 × 仓位，高置信', () => {
    const r = estimateLinkedFund({
      etfCode: '520920',
      etfName: '天弘恒生科技ETF',
      etfChangePct: 2.0,
      weightPct: 90,
      prevNav: 0.6337,
    })
    expect(r.estimateReturnPct).toBeCloseTo(1.8, 6)
    expect(r.estimatedNav).toBeCloseTo(0.6337 * 1.018, 6)
    expect(r.confidencePct).toBe(90)
    expect(r.contributions).toHaveLength(1)
    expect(r.contributions[0].code).toBe('520920')
    expect(r.contributions[0].contributionPct).toBeCloseTo(1.8, 6)
  })

  it('目标 ETF 无报价时按 0 变动保守处理', () => {
    const r = estimateLinkedFund({ etfCode: '520920', etfName: 'X', etfChangePct: null, weightPct: 90, prevNav: 1 })
    expect(r.estimateReturnPct).toBe(0)
    expect(r.estimatedNav).toBe(1)
    expect(r.contributions[0].changePct).toBeNull()
  })
})

describe('残差代理指数自动选择', () => {
  const D = (s: string) => new Date(`${s}T00:00:00Z`)

  it('closesToReturns：相邻交易日比值', () => {
    const r = closesToReturns([
      { date: D('2026-07-01'), close: 100 },
      { date: D('2026-07-02'), close: 102 },
      { date: D('2026-07-03'), close: 101 },
    ])
    expect(r).toHaveLength(2)
    expect(r[0].date).toBe('2026-07-02')
    expect(r[0].ret).toBeCloseTo(0.02, 9)
    expect(r[1].date).toBe('2026-07-03')
    expect(r[1].ret).toBeCloseTo(101 / 102 - 1, 9)
  })

  it('pearson：完全正相关 1、完全负相关 −1', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6)
    expect(pearson([1, 2, 3, 4], [-2, -4, -6, -8])).toBeCloseTo(-1, 6)
    expect(pearson([1], [1])).toBe(0)
  })

  it('bestFitIndex：选出与净值涨幅最相关的指数，样本不足回落 null', () => {
    const nav = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      ret: Math.sin(i / 3) * 0.01,
    }))
    const mirror = nav.map((r) => ({ date: r.date, ret: r.ret * 1.2 }))
    const noise = nav.map((r, i) => ({ date: r.date, ret: Math.cos(i * 7) * 0.02 }))
    const fit = bestFitIndex(nav, new Map([['idx-noise', noise], ['idx-fit', mirror]]))
    expect(fit?.code).toBe('idx-fit')
    expect(fit?.correlation).toBeGreaterThan(0.99)
    expect(bestFitIndex(nav, new Map([['x', nav.slice(0, 5)]]))).toBeNull()
  })
})

describe('东财基金报文解析', () => {
  it('重仓股解析', () => {
    const list = parseHoldings({
      Datas: { fundStocks: [{ GPDM: '600519', GPJC: '贵州茅台', JZBL: '9.77' }, { GPDM: '000333', GPJC: '美的集团', JZBL: '9.31' }] },
    })
    expect(list).toEqual([
      { code: '600519', name: '贵州茅台', weightPct: 9.77 },
      { code: '000333', name: '美的集团', weightPct: 9.31 },
    ])
    expect(parseHoldings({ Datas: {} })).toEqual([])
  })

  it('资产配置解析：股票仓位与基金仓位', () => {
    expect(parseEquityRatio({ Datas: [{ FSRQ: '2026-06-30', GP: '87.19' }] })).toEqual({ equityRatioPct: 87.19, fundRatioPct: null, reportDate: '2026-06-30' })
    expect(parseEquityRatio({ Datas: [{ FSRQ: '2026-06-30', GP: '--', JJ: '93.5' }] })).toEqual({ equityRatioPct: null, fundRatioPct: 93.5, reportDate: '2026-06-30' })
    expect(parseEquityRatio({ Datas: [] })).toBeNull()
  })
})
