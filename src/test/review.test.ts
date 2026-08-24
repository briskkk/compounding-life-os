import { describe, expect, it } from 'vitest'
import { buildReviewResult, type ReviewAssetInput } from '@/lib/engine/review'
import type { LedgerTx } from '@/lib/engine/ledger'

const D = (value: string) => new Date(`${value}T10:00:00+08:00`)

function asset(
  assetId: string,
  name: string,
  cls: ReviewAssetInput['cls'],
  values: Array<[string, number, number, 'SETTLED' | 'FLOW_ONLY']>,
): ReviewAssetInput {
  return {
    assetId,
    name,
    symbol: assetId.toUpperCase(),
    cls,
    style: null,
    currency: 'CNY',
    series: values.map(([date, netWorth, contributions, valuationStatus]) => ({
      date,
      netWorth,
      contributions,
      quantity: netWorth,
      nav: 1,
      valuationStatus,
      valuationCoverage: 1,
      latestValuationDate: date,
      valuationGaps: [],
    })),
  }
}

function tx(input: Partial<LedgerTx> & Pick<LedgerTx, 'assetId' | 'type' | 'occurredAt'>): LedgerTx {
  return {
    id: `${input.assetId}-${input.type}-${input.occurredAt.getTime()}`,
    accountId: 'account',
    quantity: null,
    price: null,
    amount: 0,
    fee: 0,
    assetClass: 'STOCK',
    currency: 'CNY',
    ...input,
  }
}

describe('组合复盘归因', () => {
  it('标的金额和多期链接百分点都与组合收益严格对账', () => {
    const portfolio = [
      { date: '2026-07-31', netWorth: 200, contributions: 200, valuationStatus: 'SETTLED' as const, valuationCoverage: 1 },
      { date: '2026-08-01', netWorth: 220, contributions: 200, valuationStatus: 'SETTLED' as const, valuationCoverage: 1 },
      { date: '2026-08-02', netWorth: 242, contributions: 200, valuationStatus: 'SETTLED' as const, valuationCoverage: 1 },
    ]
    const assets = [
      asset('a', '资产A', 'STOCK', [
        ['2026-07-31', 100, 100, 'SETTLED'],
        ['2026-08-01', 115, 100, 'SETTLED'],
        ['2026-08-02', 121, 100, 'SETTLED'],
      ]),
      asset('b', '资产B', 'ETF', [
        ['2026-07-31', 100, 100, 'SETTLED'],
        ['2026-08-01', 105, 100, 'SETTLED'],
        ['2026-08-02', 121, 100, 'SETTLED'],
      ]),
    ]
    const result = buildReviewResult({
      portfolioSeries: portfolio,
      assets,
      transactions: [],
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      label: '本月',
    })

    expect(result.performance.amount).toBe(42)
    expect(result.assets.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(42)
    expect(result.assets.reduce((sum, row) => sum + (row.contributionPct ?? 0), 0)).toBeCloseTo(result.performance.pct!)
    expect(result.reconciliationAmount).toBeCloseTo(0)
  })

  it('把组合与标的之间的差额显式归入待对账项，而不伪装成标的', () => {
    const result = buildReviewResult({
      portfolioSeries: [
        { date: '2026-07-31', netWorth: 100, contributions: 100, valuationStatus: 'SETTLED' as const },
        { date: '2026-08-01', netWorth: 115, contributions: 100, valuationStatus: 'SETTLED' as const },
      ],
      assets: [asset('a', '资产A', 'FUND', [
        ['2026-07-31', 100, 100, 'SETTLED'],
        ['2026-08-01', 110, 100, 'SETTLED'],
      ])],
      transactions: [],
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      label: '本月',
    })

    expect(result.reconciliationAmount).toBe(5)
    expect(result.assets.find((row) => row.key === 'RECONCILIATION')).toBeUndefined()
    expect(result.attributedAmount).toBe(10)
    expect(result.attributedAmount + result.reconciliationAmount).toBe(15)
    expect(result.reconciliationStatus).toBe('REVIEW')
    expect(result.classes.some((row) => String(row.key) === 'RECONCILIATION')).toBe(false)
    expect(result.sources.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(15)
  })

  it('分红、费用和市场变化来源相加等于标的贡献', () => {
    const transactions = [
      tx({ assetId: 'a', type: 'DIVIDEND', amount: 5, fee: 1, occurredAt: D('2026-08-01') }),
      tx({ assetId: 'a', type: 'BUY', amount: 20, quantity: 2, price: 10, fee: 1, occurredAt: D('2026-08-02') }),
    ]
    const result = buildReviewResult({
      portfolioSeries: [
        { date: '2026-07-31', netWorth: 100, contributions: 100, valuationStatus: 'SETTLED' as const },
        { date: '2026-08-01', netWorth: 104, contributions: 100, valuationStatus: 'SETTLED' as const },
        { date: '2026-08-02', netWorth: 109, contributions: 100, valuationStatus: 'SETTLED' as const },
      ],
      assets: [asset('a', '资产A', 'STOCK', [
        ['2026-07-31', 100, 100, 'SETTLED'],
        ['2026-08-01', 100, 96, 'SETTLED'],
        ['2026-08-02', 120, 116, 'SETTLED'],
      ])],
      transactions,
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      label: '本月',
    })

    const sourceTotal = result.sources.reduce((sum, row) => sum + row.amount, 0)
    expect(sourceTotal).toBeCloseTo(result.performance.amount!)
    expect(result.sources.find((row) => row.key === 'INCOME')?.amount).toBe(5)
    expect(result.sources.find((row) => row.key === 'FEES')?.amount).toBe(-2)
  })

  it('生成交易行为、时间质量和风险变化', () => {
    const transactions = [
      tx({ assetId: 'a', type: 'BUY', amount: 100, quantity: 10, price: 10, fee: 1, occurredAt: D('2026-07-01') }),
      tx({ assetId: 'a', type: 'BUY', amount: 20, quantity: 2, price: 10, fee: 1, occurredAt: D('2026-08-01') }),
      tx({ assetId: 'a', type: 'SELL', amount: 11, quantity: 1, price: 11, fee: 1, occurredAt: D('2026-08-02') }),
    ]
    const result = buildReviewResult({
      portfolioSeries: [
        { date: '2026-07-31', netWorth: 100, contributions: 100, valuationStatus: 'SETTLED' as const, valuationCoverage: 1 },
        { date: '2026-08-01', netWorth: 110, contributions: 100, valuationStatus: 'SETTLED' as const, valuationCoverage: 0.9 },
        { date: '2026-08-02', netWorth: 105, contributions: 100, valuationStatus: 'SETTLED' as const, valuationCoverage: 0.8 },
      ],
      assets: [asset('a', '资产A', 'STOCK', [
        ['2026-07-31', 100, 100, 'SETTLED'],
        ['2026-08-01', 110, 100, 'SETTLED'],
        ['2026-08-02', 105, 100, 'SETTLED'],
      ])],
      transactions,
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      label: '本月',
    })

    expect(result.behavior.decisions.map((decision) => decision.action)).toEqual(['减仓', '加仓'])
    expect(result.behavior.turnover).toBeGreaterThan(0)
    expect(result.timing.bestDay?.amount).toBe(10)
    expect(result.timing.worstDay?.amount).toBe(-5)
    const valuationGap = result.risks.find((risk) => risk.key === 'VALUATION_GAP')
    expect(valuationGap?.start).toBe(0)
    expect(valuationGap?.end).toBeCloseTo(0.2)
  })
})
