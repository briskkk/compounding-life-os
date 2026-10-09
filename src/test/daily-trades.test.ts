import { describe, expect, it } from 'vitest'
import { dailyTradeActivities, positionsWithDailyActivity, transactionTradingDate } from '@/lib/engine/daily-trades'
import { foldTransactions, positionKey, type LedgerTx } from '@/lib/engine/ledger'
import { valuePositions } from '@/lib/engine/valuation'
import { dailyQuoteValuation, summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import { positionDayPnlCny, summarizeAccountPositions } from '@/lib/engine/account-summary'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import { buildPositionTable } from '@/lib/engine/position-table'
import { buildPositionItem } from '@/lib/engine/position-view'
import type { AssetInfo } from '@/lib/engine/types'

const now = new Date('2026-10-09T14:33:00+08:00')
const date = '2026-10-09'
const asset: AssetInfo = { id: 'etf', symbol: '515880', name: '通信ETF', cls: 'ETF', manual: false, currency: 'CNY' }
const assets = new Map([[asset.id, asset]])
const quote = { price: 0.593, prevClose: 0.594, priceCny: 0.593, prevCloseCny: 0.594, tradingDate: date, source: 'TEST' }
const tx = (overrides: Partial<LedgerTx> = {}): LedgerTx => ({
  accountId: 'broker', assetId: 'etf', assetClass: 'ETF', type: 'BUY', quantity: 2000,
  price: 0.567, amount: 1134, fee: 0.1, occurredAt: new Date('2026-10-09T12:00:00+08:00'), ...overrides,
})
const opening = tx({ quantity: 7300, price: 0.6, amount: 4380, fee: 0, occurredAt: new Date('2026-10-08T12:00:00+08:00') })

function positions(txs: LedgerTx[]) {
  const activity = dailyTradeActivities(txs, assets, () => date, () => 1, now)
  return valuePositions(positionsWithDailyActivity(foldTransactions(txs), txs, assets, now), assets, () => quote.price)
    .map((p) => ({ ...p, dailyActivity: activity.get(positionKey(p.accountId, p.assetId)) }))
}

describe('账本驱动的今日盈亏', () => {
  it('通信ETF实际买入回归：昨仓亏7.30 + 新买盈利52 - 手续费0.10 = 44.60，所有视图同源', () => {
    const p = positions([opening, tx()])[0]
    expect(p.quantity).toBe(9300)
    expect(positionDayPnlCny(p, quote.prevClose)).toBeCloseTo(44.6)
    expect(summarizeAccountPositions([p], () => quote.prevClose).dayPnlCny).toBeCloseTo(44.6)
    const live = dailyQuoteValuation({ quantity: p.quantity, dailyActivity: p.dailyActivity, quote, fallbackValueCny: 0, asset, now })
    expect(summarizeDailyPortfolio([live], 100).pnlCny).toBeCloseTo(44.6)
    expect(buildPositionTable([p], new Map([[asset.symbol, quote]]), new Map(), {}, now).rows[0].dayPnlCny).toBeCloseTo(44.6)
    expect(buildPositionItem(p, quote, now).dayPnl).toBeCloseTo(44.6)
  })

  it.each([
    [8400, 600, 0.952, 1.003, 1.004, 39.5],
    [5100, 1000, 1.177, 1.195, 1.201, 54.5],
    [4500, 2000, 0.536, 0.531, 0.541, 54.9],
  ])('截图其余买入按真实账本费用复算', (oldQ, buyQ, buyPrice, prev, price, expected) => {
    const p = positions([tx({ ...opening, quantity: oldQ }), tx({ quantity: buyQ, price: buyPrice })])[0]
    expect(positionDayPnlCny({ ...p, value: p.quantity * price }, prev)).toBeCloseTo(expected)
  })

  it('当天新建仓只计算买入后的损益与账本费用', () => {
    const p = positions([tx()])[0]
    expect(positionDayPnlCny(p, quote.prevClose)).toBeCloseTo(51.9)
  })

  it('部分卖出包含已售份额从昨收到成交价的收益，不使用历史平均成本', () => {
    const p = positions([opening, tx({ type: 'SELL', quantity: 2000, price: 0.62, amount: 1240, fee: 1 })])[0]
    // 剩余5300亏5.30；卖出2000盈利52；扣费1。
    expect(positionDayPnlCny(p, quote.prevClose)).toBeCloseTo(45.7)
  })

  it('全部清仓仍计入当日收益，但不增加持仓数量', () => {
    const p = positions([opening, tx({ type: 'SELL', quantity: 7300, price: 0.62, fee: 1 })])[0]
    const summary = summarizeAccountPositions([p], () => quote.prevClose)
    expect(summary.dayPnlCny).toBeCloseTo(188.8)
    expect(summary.holdingCount).toBe(0)
    expect(buildPositionTable([p], new Map([[asset.symbol, quote]]), new Map(), {}, now).rows).toHaveLength(1)
  })

  it('历史累计盈亏恰为零的清仓仍保留当天收益；次日不再保留空行', () => {
    const txs = [opening, tx({ type: 'SELL', quantity: 7300, price: 0.6, fee: 0 })]
    expect(foldTransactions(txs)).toHaveLength(0)
    expect(positionDayPnlCny(positions(txs)[0], quote.prevClose)).toBeCloseTo(43.8)
    expect(positionsWithDailyActivity([], txs, assets, new Date('2026-10-10T14:00:00+08:00'))).toHaveLength(0)
  })

  it('买卖回转、分红、费用只计一次，冲正、待确认与现金腿不参与', () => {
    const txs = [opening, tx(), tx({ type: 'SELL', quantity: 2000, price: 0.58, fee: 0.1 }),
      tx({ type: 'DIVIDEND', quantity: null, price: null, amount: 10, fee: 1 }),
      tx({ type: 'FEE', quantity: null, price: null, amount: 2 }),
      tx({ voidedAt: now }), tx({ type: 'REVERSAL' }), tx({ navSource: 'PENDING', quantity: null, price: null }),
      tx({ assetId: 'cash', assetClass: 'CASH', type: 'WITHDRAW', quantity: null, price: null, internal: true, settleOfId: 'buy' })]
    expect(positionDayPnlCny(positions(txs)[0], quote.prevClose)).toBeCloseTo(-7.3 + 26 - 0.2 + 9 - 2)
  })

  it('跨账户合并只加总一次，且不污染原账户的调整', () => {
    const ps = positions([opening, tx(), tx({ accountId: 'other' })])
    const merged = mergePositionsByAsset(ps)[0]
    expect(positionDayPnlCny(merged, quote.prevClose)).toBeCloseTo(44.6 + 51.9)
    expect(positionDayPnlCny(ps[0], quote.prevClose)).toBeCloseTo(44.6)
    expect(merged.dailyActivity?.trades).toHaveLength(2)
    expect(ps[0].dailyActivity?.trades).toHaveLength(1)
    expect(merged.dailyActivity?.trades?.[0].t).toBe(tx().occurredAt.getTime())
  })

  it('缺昨收或报价过期不伪造收益；跨日报价不重复使用昨日交易', () => {
    const p = positions([opening, tx()])[0]
    expect(positionDayPnlCny(p, null)).toBeNull()
    const input = { quantity: p.quantity, dailyActivity: p.dailyActivity, fallbackValueCny: p.value, asset, now }
    expect(dailyQuoteValuation({ ...input, quote: { ...quote, tradingDate: '2026-10-08' } }).previousValueCny).toBeNull()
    const next = dailyQuoteValuation({ ...input, now: new Date('2026-10-10T12:00:00+08:00'), quote: { ...quote, tradingDate: '2026-10-10' } })
    expect(next.currentValueCny - next.previousValueCny!).toBeCloseTo(-9.3)
  })

  it('美股午夜两侧成交归入同一纽约场次，人民币只折算一次', () => {
    const us = { ...asset, symbol: 'USQQQ', currency: 'USD' }
    const txs = [tx({ occurredAt: new Date('2026-10-08T22:00:00+08:00'), quantity: 1, price: 100, fee: 1 }),
      tx({ occurredAt: new Date('2026-10-09T01:00:00+08:00'), quantity: 1, price: 110, fee: 1 })]
    expect(transactionTradingDate(txs[0], us)).toBe('2026-10-08')
    expect(transactionTradingDate(txs[1], us)).toBe('2026-10-08')
    const activity = dailyTradeActivities(txs, new Map([[us.id, us]]), () => '2026-10-08', () => 7, now).get('broker:etf')
    const live = dailyQuoteValuation({ quantity: 2, dailyActivity: activity, quote: { price: 120, prevClose: 105, tradingDate: '2026-10-08' }, fallbackValueCny: 0, asset: us, now, rateToCny: 7 })
    expect(live.currentValueCny - live.previousValueCny!).toBeCloseTo((240 - 210 - 2) * 7)
  })

  it('场外基金按成交净值日调整，未确认份额不制造收益', () => {
    const fund = { ...asset, cls: 'FUND' as const }
    const fundTx = tx({ assetClass: 'FUND', occurredAt: new Date('2026-10-08T16:00:00+08:00'), navDate: new Date('2026-10-09T12:00:00+08:00') })
    expect(dailyTradeActivities([fundTx], new Map([[fund.id, fund]]), () => date, () => 1, now).get('broker:etf')?.quantityDelta).toBe(2000)
    expect(dailyTradeActivities([{ ...fundTx, navSource: 'PENDING', quantity: null, price: null }], new Map([[fund.id, fund]]), () => date, () => 1, now).size).toBe(0)
  })
})
