// 基金确认/到账推算 + 账本可用份额与在途资金（ADR-012）
import { describe, expect, it } from 'vitest'
import { estimateShares, fundConfirmationDate, fundNavDate, fundSettlementDate, isQdiiFund, nextTradingDay } from '@/lib/engine/fund-order'
import { chinaFundCalendarCoverage, isChinaFundTradingDay } from '@/lib/engine/china-trading-calendar'
import { foldTransactions, holdingsIndex, pendingFundPurchasesAt, pendingSettlementsAt, type LedgerTx } from '@/lib/engine/ledger'
import { assertTransactionRules, assertTransactionTimeline } from '@/lib/transaction-rules'
import { buildSettlementLegs } from '@/lib/engine/settlement'
import { dateKeyAt } from '@/lib/engine/watch-market'

const D = (s: string) => new Date(`${s}T12:00:00+08:00`)
const key = (d: Date) => dateKeyAt(d)

function tx(partial: Partial<LedgerTx> & Pick<LedgerTx, 'type'>): LedgerTx {
  return {
    accountId: 'acc1',
    assetId: 'fund1',
    quantity: null,
    price: null,
    amount: 0,
    fee: 0,
    occurredAt: D('2025-01-06'), // 周一
    assetClass: 'FUND',
    ...partial,
  }
}

describe('基金确认日推算（fund-order）', () => {
  it('工作日 15:00 前下单按当日净值确认', () => {
    const nav = fundNavDate(D('2025-01-06'), { qdii: false, submittedAt: new Date('2025-01-06T10:00:00+08:00') })
    expect(key(nav)).toBe('2025-01-06')
  })

  it('15:00 后下单顺延到次一交易日', () => {
    const nav = fundNavDate(D('2025-01-06'), { qdii: false, submittedAt: new Date('2025-01-06T15:30:00+08:00') })
    expect(key(nav)).toBe('2025-01-07')
  })

  it('历史补录按记录时刻区分 15:00 临界：同日 10:30 卖出按当日净值，16:00 卖出按次日净值', () => {
    const morning = fundNavDate(D('2025-01-06'), { qdii: false, submittedAt: new Date('2025-01-06T10:30:00+08:00') })
    expect(key(morning)).toBe('2025-01-06')
    const evening = fundNavDate(D('2025-01-06'), { qdii: false, submittedAt: new Date('2025-01-06T16:00:00+08:00') })
    expect(key(evening)).toBe('2025-01-07')
  })

  it('周末下单顺延到周一；QDII 的 T+2 确认不改变成交净值日', () => {
    const sat = fundNavDate(D('2025-01-04'), { qdii: false, submittedAt: D('2025-01-04') })
    expect(key(sat)).toBe('2025-01-06')
    const qdii = fundNavDate(D('2025-01-06'), { qdii: true, submittedAt: new Date('2025-01-06T10:00:00+08:00') })
    expect(key(qdii)).toBe('2025-01-06')
    expect(key(fundConfirmationDate(qdii, { qdii: true }))).toBe('2025-01-08')
  })

  it('019671 在 8/20 15:00 前卖出采用 8/20 净值，T+2 仅表示确认延迟', () => {
    const qdii = isQdiiFund('019671', '广发港股创新药ETF联接(QDII)C')
    const before = fundNavDate(D('2026-08-20'), { qdii, submittedAt: new Date('2026-08-20T10:00:00+08:00') })
    const after = fundNavDate(D('2026-08-20'), { qdii, submittedAt: new Date('2026-08-20T16:00:00+08:00') })
    expect(key(before)).toBe('2026-08-20')
    expect(key(after)).toBe('2026-08-21')
    expect(key(fundConfirmationDate(before, { qdii }))).toBe('2026-08-24')
  })

  it('赎回到账日：普通基金确认后 2 个工作日，QDII +7 个自然日', () => {
    expect(key(fundSettlementDate(D('2025-01-06'), { qdii: false }))).toBe('2025-01-08')
    expect(key(fundSettlementDate(D('2025-01-06'), { qdii: true }))).toBe('2025-01-13')
  })

  it('QDII 识别与份额估算', () => {
    const verifiedQdii = ['012348', '014978', '019671', '021000', '021778', '040046', '539001']
    for (const symbol of verifiedQdii) expect(isQdiiFund(symbol)).toBe(true)
    // 012348 的本地简称没有写 QDII，仍必须由代码注册表正确识别。
    expect(isQdiiFund('012348', '天弘恒生科技ETF联接A')).toBe(true)
    expect(isQdiiFund('000001', 'XX QDII 混合')).toBe(true)
    expect(isQdiiFund('110022')).toBe(false)
    expect(estimateShares(1000, 0.9821)).toBe(1018.23)
  })

  it('nextTradingDay 跳过周末', () => {
    expect(key(nextTradingDay(D('2025-01-03')))).toBe('2025-01-06') // 周五 → 周一
  })

  it('按交易所公告跳过春节等连续休市日', () => {
    expect(isChinaFundTradingDay(D('2025-01-27'))).toBe(true)
    expect(isChinaFundTradingDay(D('2025-01-28'))).toBe(false)
    expect(key(nextTradingDay(D('2025-01-27')))).toBe('2025-02-05')
    expect(key(nextTradingDay(D('2026-02-13')))).toBe('2026-02-24')
    expect(key(fundConfirmationDate(D('2026-02-13'), { qdii: false }))).toBe('2026-02-24')
  })

  it('公开日历覆盖范围外明确回退周末规则', () => {
    expect(chinaFundCalendarCoverage(D('2026-08-24'))).toBe('PUBLISHED')
    expect(chinaFundCalendarCoverage(D('2027-01-04'))).toBe('WEEKEND_ONLY')
  })

  it('北京时间周一零点的净值日，普通基金 T+1、QDII T+2 不受 UTC 前一天影响', () => {
    const nav = new Date('2026-10-25T16:00:00.000Z')
    expect(isChinaFundTradingDay(nav)).toBe(true)
    expect(key(fundConfirmationDate(nav, { qdii: false }))).toBe('2026-10-27')
    expect(key(fundConfirmationDate(nav, { qdii: true }))).toBe('2026-10-28')
    expect(key(fundSettlementDate(nav, { qdii: false }))).toBe('2026-10-28')
    expect(key(fundSettlementDate(nav, { qdii: true }))).toBe('2026-11-02')
  })

  it.each([
    ['2026-10-26T06:59:59Z', '2026-10-26'],
    ['2026-10-26T07:00:00Z', '2026-10-27'],
    ['2026-10-25T16:01:00Z', '2026-10-26'],
    ['2026-10-07T16:01:00Z', '2026-10-08'],
  ])('按北京时间处理 15 点和休市边界：%s', (input, expected) => {
    expect(key(fundNavDate(new Date(input), { qdii: true }))).toBe(expected)
  })

  it('日历覆盖年份也按北京时间跨年', () => {
    expect(chinaFundCalendarCoverage(new Date('2023-12-31T16:00:00Z'))).toBe('PUBLISHED')
    expect(chinaFundCalendarCoverage(new Date('2026-12-31T16:00:00Z'))).toBe('WEEKEND_ONLY')
  })
})

describe('可用份额（availableQty）', () => {
  it('申购按派生确认完成日生效：净值日后、确认日前仍不可卖', () => {
    const buy = tx({
      type: 'BUY',
      quantity: 100,
      price: 1,
      amount: 100,
      occurredAt: D('2025-01-06'),
      navDate: D('2025-01-06'),
      confirmationDate: D('2025-01-08'),
    })
    // 确认日（01-08）当天回放：份额可用
    const [confirmed] = foldTransactions([buy], D('2025-01-08'))
    expect(confirmed.quantity).toBe(100)
    expect(confirmed.availableQty).toBe(100)
    // 净值日后、确认日前回放：份额在持仓中，但不可用
    const [pending] = foldTransactions([buy], D('2025-01-07'))
    expect(pending.quantity).toBe(100)
    expect(pending.availableQty).toBe(0)
  })

  it('无 navDate 的买入即时可用（股票口径不变）', () => {
    const [pos] = foldTransactions([tx({ type: 'BUY', quantity: 100, price: 1, amount: 100 })], D('2025-01-06'))
    expect(pos.availableQty).toBe(100)
  })

  it('卖出立即冻结份额', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 200, price: 1, amount: 200 }),
      tx({ type: 'SELL', quantity: 50, price: 1, amount: 50, occurredAt: D('2025-01-07') }),
    ], D('2025-01-07'))
    expect(pos.quantity).toBe(150)
    expect(pos.availableQty).toBe(150)
  })

  it('holdingsIndex 按账户×资产索引', () => {
    const map = holdingsIndex(foldTransactions([tx({ type: 'BUY', quantity: 100, price: 1, amount: 100 })]))
    expect(map['acc1:fund1']).toEqual({ quantity: 100, availableQty: 100 })
  })
})

describe('在途资金（pendingSettlementsAt）', () => {
  const sell = tx({
    id: 'sell1', type: 'SELL', quantity: 100, price: 1, amount: 100, occurredAt: D('2025-01-06'),
  })
  const delayedLeg = tx({
    id: 'leg1', type: 'DEPOSIT', amount: 100, internal: true, settleOfId: 'sell1',
    accountId: 'cash-acc', assetId: 'cash1', assetClass: 'CASH', occurredAt: D('2025-01-09'),
  })

  it('申报后、到账前：在途资金可见并携带赎回上下文', () => {
    const pending = pendingSettlementsAt([sell, delayedLeg], D('2025-01-07'))
    expect(pending).toHaveLength(1)
    expect(pending[0].amount).toBe(100)
    expect(pending[0].sellTxId).toBe('sell1')
    expect(pending[0].sellAssetId).toBe('fund1')
    expect(key(pending[0].settlementDate)).toBe('2025-01-09')
  })

  it('到账日后不再计入在途（现金腿已生效）', () => {
    expect(pendingSettlementsAt([sell, delayedLeg], D('2025-01-09'))).toHaveLength(0)
  })

  it('被冲正的赎回不产生在途', () => {
    expect(pendingSettlementsAt([
      sell, { ...delayedLeg, voidedAt: D('2025-01-08') },
    ], D('2025-01-07'))).toHaveLength(0)
    expect(pendingSettlementsAt([
      { ...sell, voidedAt: D('2025-01-08') }, delayedLeg,
    ], D('2025-01-07'))).toHaveLength(0)
  })

  it('未来申报的赎回不算在途', () => {
    expect(pendingSettlementsAt([
      { ...sell, occurredAt: D('2025-01-10') }, delayedLeg,
    ], D('2025-01-07'))).toHaveLength(0)
  })

  it('即时结算腿（同日）不产生在途', () => {
    const sameDayLeg = { ...delayedLeg, occurredAt: D('2025-01-06') }
    expect(pendingSettlementsAt([sell, sameDayLeg], D('2025-01-07'))).toHaveLength(0)
  })
})

describe('申购待确认（pendingFundPurchasesAt）', () => {
  const purchase = tx({
    id: 'pending-buy',
    type: 'BUY',
    amount: 1000,
    navSource: 'PENDING',
    navDate: D('2025-01-06'),
    confirmationDate: D('2025-01-07'),
  })

  it('只保留已发生且份额未知的基金申购金额', () => {
    expect(pendingFundPurchasesAt([purchase], D('2025-01-06'))).toEqual([
      expect.objectContaining({ buyTxId: 'pending-buy', amount: 1000, assetId: 'fund1' }),
    ])
    expect(pendingFundPurchasesAt([{ ...purchase, occurredAt: D('2025-01-08') }], D('2025-01-06'))).toHaveLength(0)
    expect(pendingFundPurchasesAt([{ ...purchase, voidedAt: D('2025-01-07') }], D('2025-01-06'))).toHaveLength(0)
    expect(pendingFundPurchasesAt([{ ...purchase, quantity: 1000, price: 1 }], D('2025-01-06'))).toHaveLength(0)
  })
})

describe('基金交易规则（容差与可用份额）', () => {
  const fund = { cls: 'FUND' as const, manual: false }
  const stock = { cls: 'STOCK' as const, manual: false }

  it('基金允许份额两位小数带来的舍入误差，股票保持严格', () => {
    // 1000 元申购、净值 0.9821 → 确认 1018.23 份 → 1018.23 × 0.9821 = 1000.0025
    expect(() => assertTransactionRules(
      { type: 'BUY', quantity: 1018.23, price: 0.9821, amount: 1000 }, fund,
    )).not.toThrow()
    // 0.02 元偏差：超出股票严格容差（0.01），仍在基金舍入容差（0.05）内
    expect(() => assertTransactionRules(
      { type: 'BUY', quantity: 1018.23, price: 0.9821, amount: 1000.02 }, fund,
    )).not.toThrow()
    expect(() => assertTransactionRules(
      { type: 'BUY', quantity: 1018.23, price: 0.9821, amount: 1000.02 }, stock,
    )).toThrow()
  })

  it('待确认申购不伪造净值与份额', () => {
    expect(() => assertTransactionRules(
      { type: 'BUY', quantity: null, price: null, amount: 1000, navSource: 'PENDING' }, fund,
    )).not.toThrow()
  })

  it('卖出按可用份额校验，确认中的申购不可卖', () => {
    expect(() => assertTransactionRules(
      { type: 'SELL', quantity: 60, price: 1, amount: 60 },
      fund,
      { quantity: 100, unvestedQty: 0, availableQty: 50 },
    )).toThrow(/可卖 50/)
    expect(() => assertTransactionRules(
      { type: 'SELL', quantity: 50, price: 1, amount: 50 },
      fund,
      { quantity: 100, unvestedQty: 0, availableQty: 50 },
    )).not.toThrow()
  })

  it('时间线：确认日当天可卖，确认日前不可卖', () => {
    const buy = { type: 'BUY' as const, quantity: 100, occurredAt: D('2025-01-06'), navDate: D('2025-01-07'), sequence: 0 }
    expect(() => assertTransactionTimeline([
      buy,
      { type: 'SELL', quantity: 50, occurredAt: D('2025-01-06'), sequence: 1 },
    ], fund)).toThrow(/数量不足/)
    expect(() => assertTransactionTimeline([
      buy,
      { type: 'SELL', quantity: 50, occurredAt: D('2025-01-07'), sequence: 1 },
    ], fund)).not.toThrow()
  })
})

describe('延迟结算腿（settlement）', () => {
  it('SELL 现金腿落在预计到账日而非成交日', () => {
    const legs = buildSettlementLegs(
      tx({ type: 'SELL', quantity: 100, price: 1, amount: 100 }),
      'cash1', 'cash-acc',
      { settleAt: D('2025-01-09') },
    )
    expect(legs).toHaveLength(1)
    expect(legs[0].type).toBe('DEPOSIT')
    expect(key(legs[0].occurredAt)).toBe('2025-01-09')
  })

  it('缺省 settleAt 时保持成交日（股票口径不变）', () => {
    const legs = buildSettlementLegs(
      tx({ type: 'SELL', quantity: 100, price: 1, amount: 100 }),
      'cash1', 'cash-acc',
    )
    expect(key(legs[0].occurredAt)).toBe('2025-01-06')
  })
})
