import { describe, expect, it } from 'vitest'
import { foldTransactions, type LedgerTx } from '@/lib/engine/ledger'

const D = (s: string) => new Date(s)

function tx(partial: Partial<LedgerTx> & Pick<LedgerTx, 'type'>): LedgerTx {
  return {
    accountId: 'acc1',
    assetId: 'asset1',
    quantity: null,
    price: null,
    amount: 0,
    fee: 0,
    occurredAt: D('2025-01-01'),
    assetClass: 'STOCK',
    ...partial,
  }
}

describe('账本折叠（移动平均成本）', () => {
  it('买入累计数量与成本', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 100, price: 10, amount: 1000 }),
      tx({ type: 'BUY', quantity: 100, price: 12, amount: 1200, occurredAt: D('2025-02-01') }),
    ])
    expect(pos.quantity).toBe(200)
    expect(pos.costBasis).toBe(2200)
  })

  it('卖出按均价结算已实现盈亏', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 200, price: 11, amount: 2200 }),
      tx({ type: 'SELL', quantity: 100, price: 15, amount: 1500, fee: 5, occurredAt: D('2025-03-01') }),
    ])
    expect(pos.quantity).toBe(100)
    expect(pos.costBasis).toBe(1100)
    // 100×15 − 5 费用 − 100×11 成本
    expect(pos.realizedPnl).toBeCloseTo(395)
  })

  it('分红与利息计入已实现，费用扣减', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 100, price: 10, amount: 1000 }),
      tx({ type: 'DIVIDEND', amount: 50, occurredAt: D('2025-02-01') }),
      tx({ type: 'FEE', amount: 8, occurredAt: D('2025-02-02') }),
      tx({ type: 'INTEREST', amount: 12, occurredAt: D('2025-02-03') }),
    ])
    expect(pos.realizedPnl).toBe(54)
    expect(pos.quantity).toBe(100)
  })

  it('现金存入 / 取出', () => {
    const [pos] = foldTransactions([
      tx({ type: 'DEPOSIT', amount: 30000, assetClass: 'CASH' }),
      tx({ type: 'WITHDRAW', amount: 5000, occurredAt: D('2025-01-02'), assetClass: 'CASH' }),
    ])
    expect(pos.quantity).toBe(25000)
    expect(pos.costBasis).toBe(25000)
  })

  it('历史归属流水保留审计记录但不再改变持仓', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 4800, price: 8, assetClass: 'HUAWEI_STOCK' }),
      tx({ type: 'VEST', quantity: 300, occurredAt: D('2025-04-01'), assetClass: 'HUAWEI_STOCK' }),
    ])
    expect(pos.unvestedQty).toBe(0)
    expect(pos.vestedQty).toBe(0)
    expect(pos.quantity).toBe(4800)
  })

  it('VALUATION 记录手动估值', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 1, price: 3_200_000, amount: 3_200_000, assetClass: 'REAL_ESTATE' }),
      tx({ type: 'VALUATION', amount: 3_450_000, occurredAt: D('2025-06-01'), assetClass: 'REAL_ESTATE' }),
    ])
    expect(pos.manualValue).toBe(3_450_000)
    expect(pos.lastValuationAt).toEqual(D('2025-06-01'))
  })

  it('upTo 时点回放只计入之前的流水', () => {
    const txs = [
      tx({ type: 'BUY', quantity: 100, price: 10, amount: 1000, occurredAt: D('2025-01-10') }),
      tx({ type: 'SELL', quantity: 100, price: 20, amount: 2000, occurredAt: D('2025-06-10') }),
    ]
    const [before] = foldTransactions(txs, D('2025-03-01'))
    expect(before.quantity).toBe(100)
    const after = foldTransactions(txs, D('2025-12-01'))
    // 已清仓但存在已实现盈亏，持仓行仍保留（数量归零）
    expect(after.length).toBe(1)
    expect(after[0].quantity).toBe(0)
    expect(after[0].realizedPnl).toBeCloseTo(1000)
  })

  it('被冲正（voidedAt）的流水折叠时跳过', () => {
    const txs = [
      tx({ type: 'BUY', quantity: 100, price: 10, amount: 1000 }),
      tx({ type: 'BUY', quantity: 100, price: 10, amount: 1000, occurredAt: D('2025-02-01'), voidedAt: D('2025-03-01') }),
      tx({ type: 'REVERSAL', occurredAt: D('2025-03-01') }),
    ]
    const [pos] = foldTransactions(txs)
    expect(pos.quantity).toBe(100)
    expect(pos.costBasis).toBe(1000)
  })

  it('现金资产的利息直接增加余额', () => {
    const [pos] = foldTransactions([
      tx({ type: 'DEPOSIT', amount: 10000, assetClass: 'CASH' }),
      tx({ type: 'INTEREST', amount: 380, occurredAt: D('2025-12-21'), assetClass: 'CASH' }),
    ])
    expect(pos.quantity).toBe(10380)
    expect(pos.realizedPnl).toBe(380)
  })

  it('拆股只调整份额，保持总成本和已实现盈亏不变', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 10, price: 100, amount: 1000, occurredAt: D('2025-01-01') }),
      tx({ type: 'SHARE_ADJUSTMENT', quantity: 70, price: 8, occurredAt: D('2025-04-21') }),
    ])
    expect(pos.quantity).toBe(80)
    expect(pos.availableQty).toBe(80)
    expect(pos.costBasis).toBe(1000)
    expect(pos.realizedPnl).toBe(0)
  })

  it('前复权历史在拆股日前使用拆分后的等价份额，避免价值跳变', () => {
    const rows = [
      tx({ type: 'BUY', quantity: 10, price: 100, amount: 1000, occurredAt: D('2025-01-01') }),
      tx({ type: 'SHARE_ADJUSTMENT', quantity: 70, price: 8, occurredAt: D('2025-04-21') }),
    ]
    const [before] = foldTransactions(rows, D('2025-03-01'))
    const [after] = foldTransactions(rows, D('2025-05-01'))
    expect(before.quantity).toBe(80)
    expect(after.quantity).toBe(80)
    expect(before.costBasis).toBe(1000)
  })

  it('分拆成本分配只迁移剩余成本，不形成收益', () => {
    const [pos] = foldTransactions([
      tx({ type: 'BUY', quantity: 100, price: 20, amount: 2000 }),
      tx({ type: 'COST_ADJUSTMENT', amount: -500, occurredAt: D('2025-03-01') }),
    ])
    expect(pos.quantity).toBe(100)
    expect(pos.costBasis).toBe(1500)
    expect(pos.realizedPnl).toBe(0)
  })
})
