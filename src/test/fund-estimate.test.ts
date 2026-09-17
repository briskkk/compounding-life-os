import { describe, expect, it } from 'vitest'
import { estimateFund, estimateLinkedFund, estimateMinuteSeries, type FundHolding } from '@/lib/engine/fund-estimate'
import { parseHoldings, parseEquityRatio } from '@/lib/market/fund-holdings'
import { bestFitIndex, closesToReturns, pearson } from '@/lib/engine/benchmark'
import { CONFIDENCE_FLOOR } from '@/lib/market/fund-engine'
import { CONFIDENCE_MIN, gztimeToIso, parseOfficialEstimate, pickEstimateChannel, type OfficialFundEstimate } from '@/lib/market/eastmoney-fund'
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
      Datas: {
        fundStocks: [
          { GPDM: '600519', GPJC: '贵州茅台', JZBL: '9.77', NEWTEXCH: '1' },
          { GPDM: '000333', GPJC: '美的集团', JZBL: '9.31', NEWTEXCH: '0' },
          { GPDM: '01818', GPJC: '招金矿业', JZBL: '8.66', TEXCH: '5', NEWTEXCH: '116' },
          // 美股重仓股报文里是裸代码（NVDA）；行情源要带市场前缀，否则批量取数返回空，
          // QDII 的模型估值会因拿不到重仓股涨跌而回落官方净值（看盘显示「—」）
          { GPDM: 'NVDA', GPJC: '英伟达', JZBL: '7.5', NEWTEXCH: '105' },
          { GPDM: 'NVDA', GPJC: '英伟达（重复）', JZBL: '7.5', NEWTEXCH: '105' },
        ],
      },
    })
    expect(list).toEqual([
      { code: '600519', name: '贵州茅台', weightPct: 9.77 },
      { code: '000333', name: '美的集团', weightPct: 9.31 },
      { code: 'HK01818', name: '招金矿业', weightPct: 8.66 },
      { code: 'USNVDA', name: '英伟达', weightPct: 7.5 },
      { code: 'USNVDA', name: '英伟达（重复）', weightPct: 7.5 },
    ])
    expect(parseHoldings({ Datas: {} })).toEqual([])
  })

  it('五位数字持仓即使缺少交易所字段也按港股标准化', () => {
    expect(parseHoldings({
      Datas: { fundStocks: [{ GPDM: '01787', GPJC: '山东黄金', JZBL: '9.17' }] },
    })).toEqual([{ code: 'HK01787', name: '山东黄金', weightPct: 9.17 }])
  })

  it('资产配置解析：股票仓位与基金仓位', () => {
    expect(parseEquityRatio({ Datas: [{ FSRQ: '2026-06-30', GP: '87.19' }] })).toEqual({ equityRatioPct: 87.19, fundRatioPct: null, reportDate: '2026-06-30' })
    expect(parseEquityRatio({ Datas: [{ FSRQ: '2026-06-30', GP: '--', JJ: '93.5' }] })).toEqual({ equityRatioPct: null, fundRatioPct: 93.5, reportDate: '2026-06-30' })
    expect(parseEquityRatio({ Datas: [] })).toBeNull()
  })
})

describe('官方盘中估值（FundValuationLast）', () => {
  it('解析估值报文：有估值与无估值两类', () => {
    const est = parseOfficialEstimate(
      { data: [{ FCODE: '012348', GSZ: 0.6517, GSZZL: -1.04, GZTIME: '2026-08-12 11:13', NAV: 0.6586, PDATE: '2026-08-11' }] },
      '012348',
    )
    expect(est).toEqual({
      symbol: '012348',
      gsz: 0.6517,
      gszzlPct: -1.04,
      gztime: '2026-08-12 11:13',
      nav: 0.6586,
      pdate: '2026-08-11',
    })
    // 主动型基金数据侧不再提供估值 → GSZ/GSZZL 为 null
    const noEst = parseOfficialEstimate(
      { data: [{ FCODE: '005094', GSZ: null, GSZZL: null, GZTIME: null, NAV: 5.9295, PDATE: '2026-08-11' }] },
      '005094',
    )
    expect(noEst?.gsz).toBeNull()
    expect(noEst?.gszzlPct).toBeNull()
    expect(noEst?.nav).toBeCloseTo(5.9295)
    expect(parseOfficialEstimate({ data: [] }, '110022')).toBeNull()
  })

  it('估值时间转 ISO（北京时间）', () => {
    expect(gztimeToIso('2026-08-12 11:13')).toBe('2026-08-12T03:13:00.000Z')
    expect(gztimeToIso('bad time')).toBeNull()
  })
})

describe('盘中估值通道选择', () => {
  it('官方估值可用 → OFFICIAL，即使模型置信度达标', () => {
    const official: OfficialFundEstimate = { symbol: '012348', shortName: null, gsz: 0.6517, gszzlPct: -1.04, gztime: '2026-08-12 11:13', nav: 0.6586, pdate: '2026-08-11' }
    expect(pickEstimateChannel(official, 94, CONFIDENCE_FLOOR, CONFIDENCE_MIN)).toBe('OFFICIAL')
  })

  it('官方无估值且模型置信度达标 → MODEL', () => {
    const noEst: OfficialFundEstimate = { symbol: '005094', gsz: null, gszzlPct: null, gztime: null, nav: 5.9295, pdate: '2026-08-11' }
    expect(pickEstimateChannel(noEst, 75, CONFIDENCE_FLOOR, CONFIDENCE_MIN)).toBe('MODEL')
  })

  it('置信度在低置信区间 → MODEL_LOW（展示但弱化标注）', () => {
    const noEst: OfficialFundEstimate = { symbol: '010826', gsz: null, gszzlPct: null, gztime: null, nav: 2.24, pdate: '2026-08-11' }
    expect(pickEstimateChannel(noEst, 43, CONFIDENCE_FLOOR, CONFIDENCE_MIN)).toBe('MODEL_LOW')
    expect(pickEstimateChannel(noEst, 30, CONFIDENCE_FLOOR, CONFIDENCE_MIN)).toBe('MODEL_LOW')
  })

  it('置信度低于下限 → NAV（不展示不可靠估值）', () => {
    const noEst: OfficialFundEstimate = { symbol: '021000', gsz: null, gszzlPct: null, gztime: null, nav: 2.3, pdate: '2026-08-11' }
    expect(pickEstimateChannel(noEst, 29, CONFIDENCE_FLOOR, CONFIDENCE_MIN)).toBe('NAV')
    expect(pickEstimateChannel(null, 29, CONFIDENCE_FLOOR, CONFIDENCE_MIN)).toBe('NAV')
    expect(pickEstimateChannel(noEst, null, CONFIDENCE_FLOOR, CONFIDENCE_MIN)).toBe('NAV')
  })
})
