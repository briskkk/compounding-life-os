import { describe, expect, it } from 'vitest'
import { buildIntradayCurves, buildPortfolioCurve, type CurveHolding, type IntradayPoint } from '@/lib/engine/intraday'
import { parseTencentMinutes } from '@/lib/market/intraday'
import { parseYahooChart } from '@/lib/market/yahoo'

describe('组合当日收益曲线', () => {
  const t0 = Date.parse('2026-07-27T09:30:00+08:00')
  const min = 60000

  it('向前填补 + 基线盈亏计算', () => {
    const holdings: CurveHolding[] = [
      { symbol: 'A', qty: 100, rateToCny: 1, prevClose: 10 },
      { symbol: 'B', qty: 10, rateToCny: 6.77, prevClose: 300 },
    ]
    const series = new Map<string, IntradayPoint[]>([
      ['A', [{ t: t0, price: 10.5 }]],
      [
        'B',
        [
          { t: t0 + min, price: 310 },
          { t: t0 + 2 * min, price: 320 },
        ],
      ],
    ])
    const curve = buildPortfolioCurve(holdings, series, 5000)
    expect(curve).toHaveLength(3)
    // t0：A=10.5×100 + B=昨收300×10×6.77 + 5000 = 26360
    expect(curve[0].value).toBe(1050 + 300 * 10 * 6.77 + 5000)
    // t0+1m：B 更新为 310
    expect(curve[1].value).toBe(1050 + 310 * 10 * 6.77 + 5000)
    // 基线 = 100×10 + 10×300×6.77 + 5000 = 26310
    expect(curve[2].pnl).toBe(curve[2].value - 26310)
    expect(curve[2].pnl).toBeGreaterThan(0)
  })

  it('无昨收时以首个分钟价为基线，避免把全部市值记为当日盈利', () => {
    const holdings: CurveHolding[] = [{ symbol: 'A', qty: 100, rateToCny: 1, prevClose: null }]
    const curve = buildPortfolioCurve(holdings, new Map([['A', [{ t: t0, price: 10 }]]]), 0)
    expect(curve[0].pnl).toBe(0)
    expect(curve[0].value).toBe(1000)
  })

  it('将无分时持仓的当前市值与当日盈亏计入整条曲线', () => {
    const holdings: CurveHolding[] = [{ symbol: 'A', qty: 100, rateToCny: 1, prevClose: 10 }]
    const series = new Map([['A', [{ t: t0, price: 11 }]]])
    // 无分时资产当前市值 5,000，较昨收亏损 200；动态资产盈利 100。
    const [point] = buildPortfolioCurve(holdings, series, 5000, -200)
    expect(point.value).toBe(6100)
    expect(point.pnl).toBe(-100)
    expect(point.value - point.pnl).toBe(6200)
  })

  it('全部无分时数据 → 空曲线', () => {
    expect(buildPortfolioCurve([{ symbol: 'A', qty: 1, rateToCny: 1, prevClose: 1 }], new Map(), 100)).toEqual([])
  })
})

describe('逐标的当日盈亏序列（看盘点行看曲线）', () => {
  const t0 = Date.parse('2026-07-27T09:30:00+08:00')
  const min = 60000
  const holdings: CurveHolding[] = [
    { symbol: 'A', qty: 100, rateToCny: 1, prevClose: 10 },
    { symbol: 'B', qty: 10, rateToCny: 6.77, prevClose: 300 },
  ]
  const series = new Map<string, IntradayPoint[]>([
    ['A', [{ t: t0, price: 10.5 }, { t: t0 + 2 * min, price: 11 }]],
    ['B', [{ t: t0 + min, price: 310 }]],
  ])

  it('与组合曲线共用时间轴，缺失分钟点为 null 而不是 0', () => {
    const { curve, series: assetSeries } = buildIntradayCurves(holdings, series, 0, 0, new Set(['A', 'B']))
    const a = assetSeries.get('A')!
    const b = assetSeries.get('B')!
    expect(a).toHaveLength(curve.length)
    expect(b).toHaveLength(curve.length)
    // A 只在 t0 与 t0+2m 有分钟点，中间那一刻必须是 null（断开），不能插值或填 0
    expect(a.map((p) => p.pnl)).toEqual([50, null, 100])
    // B 只有 t0+1m 一个点：其余时刻必须是 null（断开），不能插值或填 0
    expect(b.map((p) => p.pnl)).toEqual([null, 677, null])
    expect(b[0].pnl).toBeNull()
  })

  it('选中标的的末点盈亏与组合「当日盈亏」同口径（可直接对上表格）', () => {
    const { curve, series: assetSeries } = buildIntradayCurves(holdings, series, 0, 0, new Set(['A']))
    const a = assetSeries.get('A')!
    // A 收盘 11 vs 昨收 10 → +100；B 收盘 310 vs 昨收 300 → +677
    expect(a.at(-1)!.pnl).toBe(100)
    expect(curve.at(-1)!.pnl).toBe(100 + 677)
  })

  it('只跟踪被请求的标的，未跟踪的不返回序列', () => {
    const { series: assetSeries } = buildIntradayCurves(holdings, series, 0, 0, new Set(['A']))
    expect([...assetSeries.keys()]).toEqual(['A'])
    expect(buildIntradayCurves(holdings, series, 0, 0).series.size).toBe(0)
  })

  it('无昨收时以首个分钟价为基线，标的序列起点为 0', () => {
    const { series: assetSeries } = buildIntradayCurves(
      [{ symbol: 'A', qty: 100, rateToCny: 1, prevClose: null }],
      new Map([['A', [{ t: t0, price: 10 }]]]),
      0,
      0,
      new Set(['A']),
    )
    expect(assetSeries.get('A')![0].pnl).toBe(0)
  })
})

describe('腾讯分钟线解析', () => {
  it('解析 HHMM 价格并落在当日 +08:00', () => {
    const pts = parseTencentMinutes(['0930 1308.00 1366 178672800.00', '1500 1297.41 5000 1.0'], '2026-07-27')
    expect(pts).toHaveLength(2)
    expect(pts[0].price).toBe(1308)
    expect(new Date(pts[0].t).toISOString()).toBe('2026-07-27T01:30:00.000Z')
    expect(pts[1].price).toBe(1297.41)
  })
})

describe('Yahoo 报文解析', () => {
  it('提取时间戳与收盘价，跳过 null', () => {
    const { points, prevClose, currency } = parseYahooChart({
      chart: {
        result: [
          {
            meta: { currency: 'USD', chartPreviousClose: 321.66 },
            timestamp: [1784935800, 1784935860, 1784935920],
            indicators: { quote: [{ close: [322.1, null, 322.5] }] },
          },
        ],
      },
    })
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ t: 1784935800000, price: 322.1 })
    expect(prevClose).toBe(321.66)
    expect(currency).toBe('USD')
  })
})
