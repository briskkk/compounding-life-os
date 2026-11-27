import { describe, expect, it } from 'vitest'
import { buildDailyReport } from '@/lib/engine/daily-report'
import { buildDesktopGlance } from '@/lib/engine/desktop-glance'
import { emptyPosition, type LedgerTx } from '@/lib/engine/ledger'
import { valuePosition } from '@/lib/engine/valuation'
import type { EngineQuote, EngineState } from '@/lib/queries'
import type { IntradaySeries } from '@/lib/market/intraday'

const now = new Date('2026-11-27T07:00:00Z')
const asset = (id: string) => ({ id, symbol: id, name: `基金${id}`, cls: 'ETF' as const, currency: 'CNY', manual: false })
function position(id: string, account = 'one', quantity = 10) {
  return valuePosition({ ...emptyPosition(account, id), quantity, costBasis: 100 }, asset(id), () => 12)
}
function quote(id: string, price = 12): EngineQuote {
  return { symbol: id, price, priceCny: price, prevClose: 10, prevCloseCny: 10, changePct: 20,
    tradingDate: '2026-11-27', asOf: now.toISOString(), source: 'test', kind: 'MARKET', freshness: 'LIVE' }
}
function state(ids = ['510300']): EngineState {
  return { assets: ids.map(asset), valued: ids.map((id) => position(id)), quotes: new Map(ids.map((id) => [id, quote(id)])),
    ledgerTxs: [], currencyRates: { CNY: 1, USD: 7, HKD: 0.9 }, inTransit: 0, netWorth: 120, investable: 120 } as unknown as EngineState
}
function minutes(id = '510300', date = '2026-11-27'): Map<string, IntradaySeries> {
  return new Map([[id, { symbol: id, currency: 'CNY', source: 'test', prevClose: 1,
    points: [{ t: Date.parse(`${date}T01:30:00Z`), price: 10 }, { t: Date.parse(`${date}T06:59:00Z`), price: 11 }] }]])
}
function trade(overrides: Partial<LedgerTx> = {}): LedgerTx {
  return { id: 'tx', accountId: 'one', assetId: '510300', assetClass: 'ETF', type: 'BUY',
    amount: 20, quantity: 2, price: 10, fee: 0, occurredAt: new Date('2026-11-27T02:00:00Z'), ...overrides }
}

describe('投资日报快照', () => {
  it('跨账户合并，按正收益取前五，其余损益与权威摘要对账', () => {
    const input = state(['510300', '510301', '510302', '510303', '510304', '510305', '510306'])
    input.valued.push(position('510300', 'two'))
    input.quotes.set('510306', quote('510306', 8))
    const report = buildDailyReport(input, new Map(), now)
    expect(report.leaders).toHaveLength(5)
    expect(report.leaders[0]).toMatchObject({ assetId: '510300', pnl: 40 })
    expect(report.leaders.every((row) => row.pnl > 0)).toBe(true)
    expect(report.pnl).toBe(buildDesktopGlance(input, now).netWorth.dayPnl)
    expect(report.leaders.reduce((sum, row) => sum + row.pnl, 0) + report.remainingPnl!).toBe(report.pnl)
  })

  it('曲线复用报价昨收，不采用分时昨收，末点与总收益一致；不修改输入', () => {
    const series = minutes()
    const report = buildDailyReport(state(), series, now)
    expect(report.curveStatus).toBe('AVAILABLE')
    expect(report.curve.at(-1)?.pnl).toBe(report.pnl)
    expect(report.pnl).toBe(20)
    expect(series.get('510300')!.points.at(-1)!.price).toBe(11)
  })

  it('旧场次、不足两个有效点或无法对齐的交易路径不伪造曲线', () => {
    expect(buildDailyReport(state(), minutes('510300', '2026-11-26'), now).curve).toEqual([])
    const input = state()
    input.valued[0].dailyActivity = { tradingDate: '2026-11-27', quantityDelta: 2, cashFlowCny: -20,
      trades: [{ t: now.getTime(), quantityDelta: 2, cashFlowCny: -20 }] }
    input.valued[0].quantity = 12
    expect(buildDailyReport(input, minutes(), now).curveStatus).toBe('UNAVAILABLE')
  })

  it('缺行情保持空值，不用0填充；亏损日不补齐盈利榜', () => {
    const input = state()
    input.quotes.clear()
    expect(buildDailyReport(input, minutes(), now)).toMatchObject({ pnl: null, pct: null, remainingPnl: null, leaders: [], curve: [] })
    input.quotes.set('510300', quote('510300', 8))
    expect(buildDailyReport(input, minutes(), now)).toMatchObject({ pnl: -20, leaders: [], remainingPnl: -20 })
  })

  it('操作按北京自然日取账本，排除冲正/内部腿/未来交易；待确认单独标记', () => {
    const input = state()
    input.ledgerTxs = [trade(), trade({ id: 'pending', navSource: 'PENDING', quantity: null, price: null, amount: 500 }),
      trade({ id: 'void', voidedAt: now }), trade({ id: 'internal', internal: true }),
      trade({ id: 'previous', occurredAt: new Date('2026-11-26T15:59:59Z') }),
      trade({ id: 'future', occurredAt: new Date('2026-11-28T01:00:00Z') })]
    const report = buildDailyReport(input, new Map(), now)
    expect(report.operations).toEqual([
      { name: '基金510300', side: 'BUY', amount: 20, pending: false },
      { name: '基金510300', side: 'BUY', amount: 500, pending: true },
    ])
    expect(JSON.stringify(report)).not.toContain('accountId')
  })

  it('清仓仍可上榜并按账本交易重建曲线，缺分钟行情的收益保持常数', () => {
    const input = state(['510300', '510301'])
    input.valued[0] = position('510300', 'one', 0)
    input.valued[0].dailyActivity = { tradingDate: '2026-11-27', quantityDelta: -10, cashFlowCny: 119,
      trades: [{ t: Date.parse('2026-11-27T02:00:00Z'), quantityDelta: -10, cashFlowCny: 119 }] }
    const report = buildDailyReport(input, minutes(), now)
    expect(report.leaders.find((row) => row.assetId === '510300')?.pnl).toBe(19)
    expect(report.curve.at(-1)?.pnl).toBe(report.pnl)
    expect(report.pnl).toBe(39)
  })
})
