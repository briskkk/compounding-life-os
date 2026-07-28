import { describe, expect, it } from 'vitest'
import { assertTransactionRules, assertTransactionTimeline } from '@/lib/transaction-rules'

const stock = { cls: 'STOCK' as const, manual: false }

describe('流水写入规则', () => {
  it('拒绝成交金额与数量乘单价不一致', () => {
    expect(() =>
      assertTransactionRules(
        { type: 'BUY', quantity: 10, price: 100, amount: 900 },
        stock,
      ),
    ).toThrow(/数量 × 单价/)
  })

  it('拒绝超卖与超额转出', () => {
    expect(() =>
      assertTransactionRules(
        { type: 'SELL', quantity: 11, price: 100, amount: 1100 },
        stock,
        { quantity: 10, unvestedQty: 0 },
      ),
    ).toThrow(/数量不足/)
    expect(() =>
      assertTransactionRules(
        { type: 'TRANSFER_OUT', quantity: 11, price: null, amount: 0 },
        stock,
        { quantity: 10, unvestedQty: 0 },
      ),
    ).toThrow(/数量不足/)
  })

  it('限制现金、估值和归属流水的资产类别', () => {
    expect(() => assertTransactionRules({ type: 'DEPOSIT', quantity: null, price: null, amount: 1 }, stock)).toThrow(/现金资产/)
    expect(() => assertTransactionRules({ type: 'VALUATION', quantity: null, price: null, amount: 1 }, stock)).toThrow(/手动估值/)
    expect(() => assertTransactionRules({ type: 'VEST', quantity: 1, price: null, amount: 0 }, stock)).toThrow(/受限股/)
  })

  it('允许合法卖出和受限股归属', () => {
    expect(() =>
      assertTransactionRules(
        { type: 'SELL', quantity: 10, price: 100, amount: 1000 },
        stock,
        { quantity: 10, unvestedQty: 0 },
      ),
    ).not.toThrow()
    expect(() =>
      assertTransactionRules(
        { type: 'VEST', quantity: 20, price: null, amount: 0 },
        { cls: 'RSU', manual: false },
        { quantity: 100, unvestedQty: 20 },
      ),
    ).not.toThrow()
  })

  it('补录历史流水后也不能让后续时间点超卖', () => {
    expect(() =>
      assertTransactionTimeline(
        [
          { type: 'BUY', quantity: 10, occurredAt: new Date('2025-01-01') },
          { type: 'SELL', quantity: 8, occurredAt: new Date('2025-03-01') },
          { type: 'SELL', quantity: 5, occurredAt: new Date('2025-02-01') },
        ],
        stock,
      ),
    ).toThrow(/数量不足/)
  })

  it('RSU 只能卖出已归属数量', () => {
    expect(() =>
      assertTransactionTimeline(
        [
          { type: 'BUY', quantity: 100, occurredAt: new Date('2025-01-01') },
          { type: 'VEST', quantity: 20, occurredAt: new Date('2025-02-01') },
          { type: 'SELL', quantity: 21, occurredAt: new Date('2025-03-01') },
        ],
        { cls: 'RSU', manual: false },
      ),
    ).toThrow(/数量不足/)
  })
})
