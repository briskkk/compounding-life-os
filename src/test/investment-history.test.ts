import { describe, expect, it } from 'vitest'
import {
  annualPath,
  buildFundSleeveSeries,
  drawdownEvidence,
  fundContributions,
  investmentHistoryResult,
  marketContributions,
  monthlyPath,
  resolveHistoryRange,
  sleeveEventsFromTxs,
  styleContributions,
  twrEvidence,
  xirrEvidence,
  type FundContributionRow,
  type HistoryScope,
} from '@/lib/engine/investment-history'
import type { PerformancePoint } from '@/lib/engine/period-performance'
import { performanceBetween } from '@/lib/engine/period-performance'
import type { LedgerTx } from '@/lib/engine/ledger'
import { deriveDecisionEvents, type DecisionNavPoint } from '@/lib/engine/decision-events'
import { bucketEventsByQuarter, summarizeGapSegments, type SleeveEventPoint } from '@/lib/engine/investment-history'
import { behaviorSummary, holdingSegments } from '@/lib/engine/behavior-analysis'

function point(date: string, netWorth: number, contributions: number, status: PerformancePoint['valuationStatus'] = 'SETTLED'): PerformancePoint {
  return {
    date,
    netWorth,
    contributions,
    valuationStatus: status,
    valuationCoverage: 1,
    latestValuationDate: status === 'NO_UPDATE' ? null : date,
    valuationGaps: [],
  }
}

/** 构造一只基金的日序列：期初建仓后每日仅随净值/无变化的样例 */
function fundSeries(assetId: string, rows: Array<[string, number, number]>): { assetId: string; series: PerformancePoint[] } {
  return {
    assetId,
    series: rows.map(([date, netWorth, contributions], index) => {
      const hasPriceChange = index > 0 && rows[index - 1][1] !== netWorth
      return point(date, netWorth, contributions, index === 0 ? 'FLOW_ONLY' : hasPriceChange ? 'SETTLED' : 'NO_UPDATE')
    }),
  }
}

describe('resolveHistoryRange', () => {
  const now = new Date('2026-09-07T12:00:00+08:00')

  it('成立以来从首笔基金流水日开始', () => {
    const range = resolveHistoryRange('INCEPTION', now, '2021-07-22')
    expect(range.label).toBe('成立以来')
    expect(range.startDate).toBe('2021-07-22')
    expect(range.endDate).toBe('2026-09-07')
  })

  it('近五年从五年同日或更晚的成立日算起', () => {
    const range = resolveHistoryRange('FIVE_YEAR', now, '2021-07-22')
    expect(range.startDate).toBe('2021-09-07') // 2026-09-07 − 5y = 2021-09-07（晚于成立日）
    expect(range.endDate).toBe('2026-09-07')
  })

  it('近五年不会早于成立日', () => {
    const range = resolveHistoryRange('FIVE_YEAR', now, '2025-01-02')
    expect(range.startDate).toBe('2025-01-02')
  })

  it('自然年解析区间，未来自然年被截到今日；非法年份回落当年', () => {
    expect(resolveHistoryRange({ year: '2024' }, now, '2021-07-22')).toEqual({
      label: '2024 年',
      scope: { year: '2024' } as HistoryScope,
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      inceptionDate: '2021-07-22',
    })
    const current = resolveHistoryRange({ year: '2026' }, now, '2021-07-22')
    expect(current.startDate).toBe('2026-01-01')
    expect(current.endDate).toBe('2026-09-07') // 尚未结束截到今日
    expect(resolveHistoryRange({ year: 'bad' }, now, '2021-07-22').label).toBe('2026 年')
  })
})

describe('buildFundSleeveSeries', () => {
  it('把多只基金日序列按日期合并为基金子组合，市值与累计现金流分别求和', () => {
    const a = fundSeries('a', [
      ['2021-07-22', 0, 0],
      ['2021-07-23', 1000, 1000],
      ['2021-07-26', 1000, 1000],
      ['2021-07-27', 1000, 1000], // 无净值变化但仍在序列
    ])
    const b = fundSeries('b', [
      ['2021-07-26', 0, 0],
      ['2021-07-27', 500, 500],
    ])
    const sleeve = buildFundSleeveSeries([a, b], '2021-07-22', '2021-07-27')
    const byDate = new Map(sleeve.map((item) => [item.date, item]))
    expect(sleeve[0].date).toBe('2021-07-22')
    expect(byDate.get('2021-07-23')?.netWorth).toBe(1000)
    expect(byDate.get('2021-07-26')?.netWorth).toBe(1000) // b 当天刚建仓（市值 0）并入 a
    expect(byDate.get('2021-07-27')?.netWorth).toBe(1500)
    expect(byDate.get('2021-07-27')?.contributions).toBe(1500)
  })
})

describe('twrEvidence', () => {
  it('净值链完整时 TWR 资格为 ELIGIBLE 且截止日等于范围末日', () => {
    const series = [
      point('2021-07-22', 100, 100, 'FLOW_ONLY'),
      point('2021-07-23', 110, 100),
      point('2021-07-26', 121, 100),
    ]
    const twr = twrEvidence(series, '2021-07-22', '2021-07-26')
    expect(twr.status).toBe('ELIGIBLE')
    expect(twr.asOf).toBe('2021-07-26')
    expect(twr.pct).toBeCloseTo(0.21, 6)
  })

  it('尾部净值链断裂时 PARTIAL，asOf 显示真实截止日而非请求截止日', () => {
    const series = [
      point('2021-07-22', 100, 100, 'FLOW_ONLY'),
      point('2021-07-23', 110, 100),
      point('2021-07-26', 121, 100),
      point('2021-07-27', 121, 100, 'NO_UPDATE'),
      point('2021-07-28', 121, 100, 'NO_UPDATE'),
    ]
    const twr = twrEvidence(series, '2021-07-22', '2021-07-28')
    expect(twr.status).toBe('PARTIAL')
    expect(twr.asOf).toBe('2021-07-26')
    expect(twr.pct).toBeCloseTo(0.21, 6) // 只用真实净值观察点
    expect(twr.limitations.join(' ')).toContain('2021-07-26')
  })

  it('无任何有效收益观察点时 BLOCKED', () => {
    const series = [
      point('2021-07-22', 100, 100, 'FLOW_ONLY'),
      point('2021-07-23', 100, 100, 'FLOW_ONLY'),
    ]
    const twr = twrEvidence(series, '2021-07-22', '2021-07-23')
    expect(twr.status).toBe('BLOCKED')
    expect(twr.pct).toBeNull()
  })

  it('期末只有部分基金当日净值时不得标记为可直接引用', () => {
    const series = [
      point('2026-09-03', 100, 100),
      {
        ...point('2026-09-07', 101, 100, 'PARTIAL'),
        valuationCoverage: 0.05,
        latestValuationDate: '2026-09-04',
      },
    ]
    const twr = twrEvidence(series, '2026-09-03', '2026-09-07')
    expect(twr.status).toBe('PARTIAL')
    expect(twr.asOf).toBe('2026-09-04')
  })
})

describe('XIRR 与回撤证据', () => {
  it('XIRR 按真实日期现金流与期末价值计算资金体验', () => {
    const result = xirrEvidence({
      flows: [{ date: new Date('2025-01-01T00:00:00Z'), amount: -1000 }],
      openingValue: 0,
      openingDate: '2025-01-01',
      endingValue: 1100,
      terminalDate: '2026-01-01',
      valuationAsOf: '2026-01-01',
      valuationStatus: 'ELIGIBLE',
    })
    expect(result.status).toBe('ELIGIBLE')
    expect(result.pct).toBeCloseTo(0.1, 6)
    expect(result.cashFlowCount).toBe(1)
  })

  it('非成立以来范围把期初持仓作为起日投入', () => {
    const result = xirrEvidence({
      flows: [],
      openingValue: 1000,
      openingDate: '2025-01-01',
      endingValue: 1100,
      terminalDate: '2026-01-01',
      valuationAsOf: '2026-01-01',
      valuationStatus: 'ELIGIBLE',
    })
    expect(result.pct).toBeCloseTo(0.1, 6)
    expect(result.cashFlowCount).toBe(1)
  })

  it('待确认申购不伪造份额收益，并把可算 XIRR 降级为 PARTIAL', () => {
    const result = xirrEvidence({
      flows: [{ date: new Date('2025-01-01T00:00:00Z'), amount: -1000 }],
      openingValue: 0,
      openingDate: '2025-01-01',
      endingValue: 1000,
      terminalDate: '2025-07-01',
      valuationAsOf: '2025-07-01',
      valuationStatus: 'ELIGIBLE',
      pendingPurchaseCount: 1,
    })
    expect(result.status).toBe('PARTIAL')
    expect(result.pct).toBeCloseTo(0, 8)
    expect(result.limitations.join(' ')).toContain('待确认申购')
  })

  it('缺少跨日期的投入与回收两端时 XIRR 为 BLOCKED', () => {
    const result = xirrEvidence({
      flows: [],
      openingValue: 0,
      openingDate: '2025-01-01',
      endingValue: 0,
      terminalDate: '2025-12-31',
      valuationAsOf: '2025-12-31',
      valuationStatus: 'ELIGIBLE',
    })
    expect(result.status).toBe('BLOCKED')
    expect(result.pct).toBeNull()
  })

  it('最大回撤定位前高、低点和恢复日，并计算最长回本周期', () => {
    const series = [
      point('2025-01-01', 100, 100, 'FLOW_ONLY'),
      point('2025-01-02', 120, 100),
      point('2025-01-03', 90, 100),
      point('2025-01-04', 120, 100),
      point('2025-01-05', 125, 100),
    ]
    const twr = twrEvidence(series, '2025-01-01', '2025-01-05')
    const result = drawdownEvidence(performanceBetween(series, '2025-01-01', '2025-01-05').curve, twr)
    expect(result.maxDrawdown).toBeCloseTo(-0.25, 6)
    expect(result.peakDate).toBe('2025-01-02')
    expect(result.troughDate).toBe('2025-01-03')
    expect(result.recoveryDate).toBe('2025-01-04')
    expect(result.longestUnderwaterDays).toBe(2)
    expect(result.longestUnderwaterRecovered).toBe(true)
    expect(result.annualizedVolatility).not.toBeNull()
    expect(result.returnDrawdownRatio).not.toBeNull()
  })

  it('截至真实数据日仍未回到前高时标记最长未恢复区间', () => {
    const series = [
      point('2025-01-01', 100, 100, 'FLOW_ONLY'),
      point('2025-01-02', 120, 100),
      point('2025-01-03', 90, 100),
      point('2025-01-05', 100, 100),
    ]
    const twr = twrEvidence(series, '2025-01-01', '2025-01-05')
    const result = drawdownEvidence(performanceBetween(series, '2025-01-01', '2025-01-05').curve, twr)
    expect(result.recoveryDate).toBeNull()
    expect(result.longestUnderwaterStartDate).toBe('2025-01-02')
    expect(result.longestUnderwaterEndDate).toBe('2025-01-05')
    expect(result.longestUnderwaterDays).toBe(3)
    expect(result.longestUnderwaterRecovered).toBe(false)
  })
})

describe('investmentHistoryResult', () => {
  const range = {
    label: '成立以来',
    scope: 'INCEPTION' as const,
    startDate: '2021-07-22',
    endDate: '2021-07-26',
    inceptionDate: '2021-07-22',
  }

  it('桥守恒：期初 + 净投入 + 投资收益 = 期末，且与净值路径同源', () => {
    const series = [
      point('2021-07-22', 0, 0, 'FLOW_ONLY'),
      point('2021-07-23', 1000, 1000), // 申购 1000
      point('2021-07-26', 1210, 1000), // 涨 21%
    ]
    const result = investmentHistoryResult({
      range,
      sleeveSeries: series,
      flows: { deposits: 1000, withdrawals: 0, buys: 0, sells: 0, dividends: 0, fees: 0, interestIncome: 0 },
      watermark: { ledgerWatermark: 'L-1', priceWatermark: '2021-07-26', asOf: '2021-07-26', methodVersion: 'investment-history 0.3' },
    })
    expect(result.bridge.openingValue).toBe(0)
    expect(result.bridge.netInflow).toBe(1000)
    expect(result.bridge.investGain).toBeCloseTo(210, 6)
    expect(result.bridge.endingValue).toBeCloseTo(1210, 6)
    expect(result.bridge.openingValue! + result.bridge.netInflow! + result.bridge.investGain!).toBeCloseTo(result.bridge.endingValue!, 6)
    expect(result.metrics.find((item) => item.key === 'bridge')?.status).toBe('ELIGIBLE')
  })

  it('桥金额以组合贡献曲线为准并保持守恒，不复用活动统计推导净投入', () => {
    const series = [
      point('2021-07-22', 0, 0, 'FLOW_ONLY'),
      point('2021-07-23', 1200, 1000), // 申购 1000（含费 20 → 现金流 1000+20=1020？样例仅按 1000 简化）
      point('2021-07-26', 200, 180), // 赎回 820 → 剩余 200
    ]
    const result = investmentHistoryResult({
      range: { ...range, endDate: '2021-07-26' },
      sleeveSeries: series,
      flows: { deposits: 1000, withdrawals: 800, buys: 0, sells: 0, dividends: 20, fees: 20, interestIncome: 0 },
      watermark: { ledgerWatermark: 'L-1', priceWatermark: '2021-07-26', asOf: '2021-07-26', methodVersion: 'investment-history 0.3' },
    })
    expect(result.bridge.netInflow).toBe(180)
    expect(result.bridge.investGain).toBeCloseTo(20, 6)
    expect(result.bridge.openingValue! + result.bridge.netInflow! + result.bridge.investGain!).toBeCloseTo(result.bridge.endingValue!, 6)
  })

  it('近五年范围使用起点前最近 sleeve 点作为期初，避免把起日资金流误当收益', () => {
    const range2 = {
      label: '近五年',
      scope: 'FIVE_YEAR' as const,
      startDate: '2024-01-01',
      endDate: '2026-09-07',
      inceptionDate: '2021-07-22',
    }
    const series = [
      point('2023-12-29', 5000, 4000),
      point('2024-01-01', 5500, 5000), // 2024-01-01 有申购 1000
      point('2024-01-02', 6000, 5000),
    ]
    const result = investmentHistoryResult({
      range: range2,
      sleeveSeries: series,
      flows: { deposits: 1000, withdrawals: 0, buys: 0, sells: 0, dividends: 0, fees: 0, interestIncome: 0 },
      watermark: { ledgerWatermark: 'L-1', priceWatermark: '2026-09-07', asOf: '2026-09-07', methodVersion: 'investment-history 0.3' },
    })
    expect(result.bridge.openingValue).toBe(5000) // 期初取 2023-12-29
    expect(result.bridge.endingValue).toBe(6000)
    expect(result.bridge.netInflow).toBe(1000)
    expect(result.bridge.investGain).toBe(0) // 6000 − 5000 − 1000
  })

  it('结果桥会把低覆盖的混合日期期末估值降级为 PARTIAL', () => {
    const series = [
      point('2021-07-22', 0, 0, 'FLOW_ONLY'),
      point('2021-07-23', 1000, 1000),
      {
        ...point('2021-07-26', 1010, 1000, 'PARTIAL'),
        valuationCoverage: 0.054,
        latestValuationDate: '2021-07-23',
      },
    ]
    const result = investmentHistoryResult({
      range,
      sleeveSeries: series,
      flows: { deposits: 1000, withdrawals: 0, buys: 0, sells: 0, dividends: 0, fees: 0, interestIncome: 0 },
      watermark: { ledgerWatermark: 'L-1', priceWatermark: '2021-07-23', asOf: '2021-07-26', methodVersion: 'investment-history 0.3' },
    })
    const bridge = result.metrics.find((item) => item.key === 'bridge')
    const twr = result.metrics.find((item) => item.key === 'twr')
    const risk = result.metrics.find((item) => item.key === 'risk-statistics')
    expect(bridge?.status).toBe('PARTIAL')
    expect(bridge?.eligibleCount).toBe(0)
    expect(bridge?.asOf).toBe('2021-07-23')
    expect(twr?.coveragePct).toBe((twr?.eligibleCount ?? 0) / (twr?.totalCount ?? 1))
    expect(risk?.coveragePct).toBe((risk?.eligibleCount ?? 0) / (risk?.totalCount ?? 1))
  })

  it('结果桥直接使用组合外部贡献曲线，不把活动统计重复计入', () => {
    const result = investmentHistoryResult({
      range,
      sleeveSeries: [point('2021-07-22', 0, 0, 'FLOW_ONLY'), point('2021-07-26', 915, 915)],
      flows: { deposits: 1000, withdrawals: 80, buys: 500, sells: 300, dividends: 0, fees: 15, interestIncome: 20 },
      watermark: { ledgerWatermark: 'L-1', priceWatermark: '2021-07-26', asOf: '2021-07-26', methodVersion: 'investment-history 0.3' },
    })
    expect(result.bridge.netInflow).toBe(915)
    expect(result.bridge.investGain).toBe(0)
  })
})

describe('年度路径 / 贡献归因 / 决策时间带数据（P0 扩展）', () => {
  it('年度路径逐自然年切片，金额链逐年闭合', () => {
    const series = [
      point('2024-12-31', 1000, 1000),
      point('2025-01-02', 1100, 1000),
      point('2025-06-02', 1210, 1100), // 2025 内申购 100
      point('2025-12-31', 1331, 1100),
      point('2026-01-02', 1464.1, 1100),
      point('2026-09-07', 1610.51, 1100),
    ]
    const rows = annualPath(series, '2025-01-01', '2026-09-07')
    expect(rows.map((r) => r.year)).toEqual([2025, 2026])
    expect(rows[0].openingValue).toBe(1000) // 2024-12-31 作为 2025 基准
    expect(rows[0].netInflow).toBe(100) // 2025-06 申购 100
    expect(rows[0].investGain).toBeCloseTo(231, 6) // 1331−1000−100
    expect(rows[0].endingValue).toBe(1331)
    expect(rows[1].openingValue).toBe(1331)
    expect(rows[1].netInflow).toBe(0)
    expect(rows[1].investGain).toBeCloseTo(279.51, 6) // 1610.51−1331
  })

  it('月度路径按自然月切片，金额桥与 TWR 保持同源', () => {
    const series = [
      point('2024-12-31', 1000, 1000),
      point('2025-01-15', 1100, 1000),
      point('2025-01-31', 1200, 1000),
      point('2025-02-01', 1300, 1100),
      point('2025-02-28', 1430, 1100),
    ]
    const rows = monthlyPath(series, '2025-01-01', '2025-02-28')
    expect(rows.map((row) => row.month)).toEqual(['2025-01', '2025-02'])
    expect(rows[0].openingValue).toBe(1000)
    expect(rows[0].investGain).toBe(200)
    expect(rows[0].twr.pct).toBeCloseTo(0.2, 6)
    expect(rows[1].openingValue).toBe(1200)
    expect(rows[1].netInflow).toBe(100)
    expect(rows[1].investGain).toBe(130)
    expect(rows[1].twr.pct).toBeCloseTo(0.1, 6)
  })

  it('单基金贡献与显式残差对账（ADR-014）', () => {
    const a = fundSeries('a', [['2024-12-30', 0, 0], ['2024-12-31', 200, 200], ['2025-01-02', 240, 200], ['2025-12-31', 260, 200]])
    const b = fundSeries('b', [['2024-12-30', 0, 0], ['2024-12-31', 0, 0], ['2025-03-02', 800, 800], ['2025-12-31', 900, 800]])
    const result = fundContributions({
      assets: [
        { key: 'a', name: '基金A', symbol: 'A', style: 'GROWTH', qdii: false, series: a.series },
        { key: 'b', name: '基金B', symbol: 'B', style: 'VALUE', qdii: false, series: b.series },
      ],
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      sleeveInvestGain: 160, // sleeve 投资收益示例 = (260−0−200) + (900−0−800) = 160
    })
    expect(result.rows.map((r) => r.name)).toEqual(['基金B', '基金A']) // 按金额降序
    expect(result.rows[0].amount).toBe(100)
    expect(result.rows[1].amount).toBe(60)
    expect(result.attributedAmount).toBe(160)
    expect(result.reconciliationAmount).toBe(0)
    expect(result.rows[0].contributionPct).toBeCloseTo(0.625, 6)
  })

  it('单基金净值不足时保留不可计算，不把收益写成 0', () => {
    const blocked = [
      point('2025-01-01', 100, 100, 'FLOW_ONLY'),
      point('2025-12-31', 100, 100, 'FLOW_ONLY'),
    ]
    const result = fundContributions({
      assets: [{ key: 'blocked', name: '缺净值基金', symbol: 'X', style: null, qdii: false, series: blocked }],
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      sleeveInvestGain: 0,
    })
    expect(result.rows[0].amount).toBeNull()
    expect(result.blockedCount).toBe(1)
    expect(result.reconciliationAmount).toBeNull()
  })

  it('市场/策略桶按 QDII 与风格聚合，未分类不并入其他桶', () => {
    const rows: FundContributionRow[] = [
      { key: '1', name: 'A', symbol: 'a', style: 'GROWTH', qdii: true, assetClass: 'FUND', marketLabel: 'QDII（境外市场）', amount: 30, returnPct: null, contributionPct: null },
      { key: '2', name: 'B', symbol: 'b', style: 'GROWTH', qdii: false, assetClass: 'FUND', marketLabel: '境内市场', amount: 20, returnPct: null, contributionPct: null },
      { key: '3', name: 'C', symbol: 'c', style: null, qdii: false, assetClass: 'FUND', marketLabel: '境内市场', amount: 10, returnPct: null, contributionPct: null },
    ]
    const market = marketContributions(rows)
    expect(market.find((m) => m.key === 'QDII（境外市场）')?.amount).toBe(30)
    expect(market.find((m) => m.key === '境内市场')?.amount).toBe(30)
    const styles = styleContributions(rows)
    expect(styles).toEqual([
      { key: 'GROWTH', label: '成长', amount: 50 },
      { key: 'UNCLASSIFIED', label: '未分类', amount: 10 },
    ])
  })

  it('sleeve 事件只保留区间主腿 BUY/SELL，排除内部腿与冲正', () => {
    const now = (d: string) => new Date(`${d}T09:00:00+08:00`)
    const txs = [
      { occurredAt: now('2025-02-01'), type: 'BUY', amount: 5000, assetId: 'a' },
      { occurredAt: now('2025-02-01'), type: 'WITHDRAW', amount: 5000, assetId: 'cash', internal: true }, // 内部现金腿
      { occurredAt: now('2025-03-01'), type: 'SELL', amount: 3000, assetId: 'a' },
      { occurredAt: now('2025-04-01'), type: 'BUY', amount: 2000, assetId: 'a', voidedAt: now('2025-05-01') }, // 冲正
    ]
    const events = sleeveEventsFromTxs(
      txs as any,
      new Map([['a', { name: '基金A', symbol: 'A' }], ['cash', { name: '现金', symbol: 'CASH' }]]),
      '2025-01-01',
      '2025-12-31',
    )
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ date: '2025-02-01', direction: 'BUY', amount: 5000, name: '基金A' })
    expect(events[1]).toMatchObject({ date: '2025-03-01', direction: 'SELL' })
  })
})

describe('P1 决策事件派生', () => {
  const D = (s: string) => new Date(`${s}T10:00:00+08:00`)
  function txs(partials: Array<Partial<LedgerTx>>): LedgerTx[] {
    return partials.map((p, i) => ({
      id: `tx-${i}`,
      accountId: 'acc',
      assetId: 'a',
      type: 'BUY',
      quantity: null,
      price: null,
      amount: 0,
      fee: 0,
      occurredAt: D('2025-01-05'),
      assetClass: 'FUND',
      ...p,
    })) as LedgerTx[]
  }
  function nav(rows: Array<[string, number]>): DecisionNavPoint[] {
    return rows.map(([date, nav]) => ({ date, nav }))
  }
  const meta = new Map([['a', { name: '测试基金', symbol: 'TEST', qdii: false }]])

  it('同日同资产多笔按时间+流水 id 稳定排序并归入同一分组', () => {
    const rows = txs([
      { type: 'BUY', assetId: 'a', occurredAt: new Date('2025-01-05T02:00:00Z'), quantity: 50, price: 1, amount: 50 },
      { type: 'BUY', assetId: 'a', occurredAt: new Date('2025-01-05T03:00:00Z'), quantity: 50, price: 1.02, amount: 51 },
    ])
    // 显式保证 map 生成的 id 顺序 = tx-0, tx-1（与时间一致）
    const events = deriveDecisionEvents({
      txs: rows,
      navByAsset: new Map([['a', nav([['2024-12-31', 1]])]]),
      assetMeta: meta,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('tx-0')
    expect(events[1].id).toBe('tx-1')
    expect(events[0].groupId).toBe(events[1].groupId)
    expect(events[0].date).toBe('2025-01-05')
  })

  it('BUY 建仓/加仓与 SELL 减仓/清仓按数量演化', () => {
    const rows = txs([
      { type: 'BUY', assetId: 'a', occurredAt: D('2025-01-05'), quantity: 100, price: 1, amount: 100 },
      { type: 'BUY', assetId: 'a', occurredAt: D('2025-02-05'), quantity: 50, price: 1, amount: 50 },
      { type: 'SELL', assetId: 'a', occurredAt: D('2025-03-05'), quantity: 120, price: 1, amount: 120 },
      { type: 'SELL', assetId: 'a', occurredAt: D('2025-04-05'), quantity: 30, price: 1, amount: 30 },
    ])
    const events = deriveDecisionEvents({
      txs: rows,
      navByAsset: new Map([['a', nav([['2025-01-04', 1], ['2025-02-04', 1.1], ['2025-03-04', 1.2], ['2025-04-04', 1.3], ['2025-05-04', 1.4], ['2025-06-04', 1.5]])]]),
      assetMeta: meta,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    expect(events.map((e) => e.action)).toEqual(['建仓', '加仓', '减仓', '清仓'])
    expect(events[0].amount).toBe(100)
  })

  it('事件前窗口严格无前视：只使用事件日前净值', () => {
    const rows = txs([
      { type: 'BUY', assetId: 'a', occurredAt: D('2025-03-05'), quantity: 100, price: 1, amount: 100 },
    ])
    // 事件日 03-05 当天的净值 9.9 不得进入事件前窗口（无前视）
    const events = deriveDecisionEvents({
      txs: rows,
      navByAsset: new Map([['a', nav([['2025-01-04', 1], ['2025-02-04', 1.1], ['2025-03-04', 1.2], ['2025-03-06', 9.9]])]]),
      assetMeta: meta,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    const e = events[0]
    // 事件前不足 20 个净值点 → CENSORED，不给收益率（不把不完整窗口当 0）
    expect(e.pre20.status).toBe('CENSORED')
    expect(e.pre20.pct).toBeNull()
    expect(e.pre20.usedDays).toBe(3) // 仅事件日前 3 个净值点
    expect(e.pre20.asOf).toBe('2025-03-04')
  })

  it('事件前满 20 个净值点时给出 ELIGIBLE 窗口收益', () => {
    const rows = txs([
      { type: 'BUY', assetId: 'a', occurredAt: D('2025-03-05'), quantity: 100, price: 1, amount: 100 },
    ])
    const dates: Array<[string, number]> = []
    for (let i = 1; i <= 22; i++) dates.push([`2025-01-${String(i).padStart(2, '0')}`, 1 + i * 0.01])
    dates.push(['2025-03-06', 9.9]) // 事件日后，不得进入前窗口
    const events = deriveDecisionEvents({
      txs: rows,
      navByAsset: new Map([['a', nav(dates)]]),
      assetMeta: meta,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    const e = events[0]
    expect(e.pre20.status).toBe('ELIGIBLE')
    expect(e.pre20.usedDays).toBe(20)
    expect(e.pre20.pct).toBeCloseTo(((1 + 22 * 0.01) / (1 + 3 * 0.01)) - 1, 6) // 前 20 点：03-05 前第 20 点=01-04(1.04)？修正见下
  })

  it('事件后观察期不足标记 CENSORED 且 pct 为 null（不计为 0）', () => {
    const rows = txs([
      { type: 'SELL', assetId: 'a', occurredAt: D('2025-10-05'), quantity: 100, price: 1, amount: 100, fee: 0 },
    ])
    // 前置买入给出持仓成本
    const buys = txs([
      { type: 'BUY', assetId: 'a', occurredAt: D('2025-01-05'), quantity: 100, price: 1, amount: 100 },
    ])
    const events = deriveDecisionEvents({
      txs: [...buys, ...rows],
      navByAsset: new Map([['a', nav([['2025-01-04', 1], ['2025-09-04', 1.2], ['2025-10-04', 1.3], ['2025-11-04', 1.4]])]]),
      assetMeta: meta,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    const sell = events.find((e) => e.action === '减仓' || e.action === '清仓')!
    expect(sell.post180.status).toBe('CENSORED')
    expect(sell.post180.pct).toBeNull()
    expect(sell.eligibility.reasons.join(' ')).toContain('观察期')
  })

  it('PENDING 申购不进入收益窗口（BLOCKED）', () => {
    const rows = txs([
      { type: 'BUY', assetId: 'a', occurredAt: D('2025-03-05'), quantity: null, price: null, amount: 1000, navSource: 'PENDING' },
    ])
    const events = deriveDecisionEvents({
      txs: rows,
      navByAsset: new Map([['a', nav([['2025-01-04', 1], ['2025-03-04', 1.1]])]]),
      assetMeta: meta,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    expect(events[0].pending).toBe(true)
    expect(events[0].pre20.status).toBe('BLOCKED')
    expect(events[0].eligibility.preOk).toBe(false)
  })
})

describe('P1 行为统计（持仓段 / 不对称 / 换手）', () => {
  const D = (s: string) => new Date(`${s}T10:00:00+08:00`)
  function tx(partials: Array<Partial<LedgerTx> & Pick<LedgerTx, 'type'>>): LedgerTx[] {
    return partials.map((p, i) => ({
      id: `t${i}`,
      accountId: 'acc',
      assetId: 'f',
      quantity: null,
      price: null,
      amount: 0,
      fee: 0,
      occurredAt: D('2025-01-01'),
      assetClass: 'FUND',
      ...p,
    }))
  }
  const nav = (rows: Array<[string, number]>) => rows.map(([date, n]) => ({ date, nav: n }))
  const meta = new Map([['f', { name: '基金F', symbol: 'F', qdii: false }]])

  it('完整持仓段：0→正→0 各算一段，未平仓不计入', () => {
    const txs = tx([
      { type: 'BUY', assetId: 'f', quantity: 100, price: 1, amount: 100, occurredAt: D('2025-01-01') },
      { type: 'SELL', assetId: 'f', quantity: 40, price: 1, amount: 40, occurredAt: D('2025-02-01') },
      { type: 'BUY', assetId: 'f', quantity: 50, price: 1.1, amount: 55, occurredAt: D('2025-03-01') },
      { type: 'SELL', assetId: 'f', quantity: 110, price: 1.2, amount: 132, occurredAt: D('2025-04-01') },
      { type: 'BUY', assetId: 'f', quantity: 10, price: 1.3, amount: 13, occurredAt: D('2025-06-01') }, // 未平仓
    ])
    const segs = holdingSegments(txs, '2025-01-01', '2025-12-31')
    expect(segs).toHaveLength(1) // 中间 SELL 未归零，直到 04-01 才归零
    expect(segs[0].openDate).toBe('2025-01-01')
    expect(segs[0].closeDate).toBe('2025-04-01')
  })

  it('盈亏持有不对称与换手率（纯引擎可测）', () => {
    const txs = tx([
      { type: 'BUY', assetId: 'f', quantity: 100, price: 1, amount: 100, occurredAt: D('2025-01-01') },
      { type: 'SELL', assetId: 'f', quantity: 100, price: 1.3, amount: 130, fee: 1, occurredAt: D('2025-06-01') },
    ])
    const fullNav: Array<[string, number]> = []
    for (let i = 1; i <= 30; i++) fullNav.push([`2025-01-${String(i).padStart(2, '0')}`, 1 + i * 0.001])
    // 卖出后 2025-06-01 起 40 个净值日，保证 30 日窗口 ELIGIBLE
    for (let i = 1; i <= 40; i++) fullNav.push([`2025-06-${String(i).padStart(2, '0')}`, 1.5 + i * 0.001])
    const events = deriveDecisionEvents({
      txs,
      navByAsset: new Map([['f', nav(fullNav)]]),
      assetMeta: meta,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    })
    const sum = behaviorSummary({
      events,
      txs,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      averageCapital: 100,
      tradingFees: 1,
    })
    expect(sum.segments).toHaveLength(1)
    expect(sum.asymmetry?.profit.count).toBe(1)
    expect(sum.asymmetry?.loss.count).toBe(0)
    expect(sum.turnoverRate).toBeCloseTo((Math.min(100, 130) * 2) / 100, 6)
    expect(sum.sampleCounts).toEqual({ buy: 1, sell: 1 })
    // 卖出后 30 日有足够净值 → 不应 CENSORED
    expect(sum.sells['30'].eligible).toBeGreaterThanOrEqual(1)
  })
})

describe('可视化支持：缺口段与季度买卖桶', () => {
  it('把连续缺口日聚合成段，短于阈值的孤立点忽略', () => {
    const series = [
      point('2025-01-01', 100, 100),
      point('2025-01-02', 101, 100),
      point('2025-01-03', 101, 100, 'NO_UPDATE'),
      point('2025-01-06', 101, 100, 'NO_UPDATE'),
      point('2025-01-07', 101, 100, 'NO_UPDATE'),
      point('2025-01-08', 101, 100, 'NO_UPDATE'),
      point('2025-01-09', 102, 100),
      point('2025-01-10', 103, 100),
      point('2025-01-13', 103, 100, 'PARTIAL'), // 单点（1 天），低于 minDays=3
      point('2025-01-14', 104, 100),
    ]
    const segments = summarizeGapSegments(series, 3)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({ from: '2025-01-03', to: '2025-01-08', days: 6 })
  })

  it('季度分桶按 BUY/SELL 统计笔数与金额', () => {
    const events: SleeveEventPoint[] = [
      { date: '2025-01-05', direction: 'BUY', name: 'A', symbol: 'a', amount: 100 },
      { date: '2025-02-05', direction: 'BUY', name: 'A', symbol: 'a', amount: 200 },
      { date: '2025-04-01', direction: 'SELL', name: 'A', symbol: 'a', amount: 150 },
    ]
    const buckets = bucketEventsByQuarter(events, '2025-01-01', '2025-12-31')
    expect(buckets).toEqual([
      { quarter: '2025-Q1', buyCount: 2, buyAmount: 300, sellCount: 0, sellAmount: 0 },
      { quarter: '2025-Q2', buyCount: 0, buyAmount: 0, sellCount: 1, sellAmount: 150 },
    ])
  })
})
