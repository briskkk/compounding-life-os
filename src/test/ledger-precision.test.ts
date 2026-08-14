// 金额精度守恒：大额多笔流水重放后「流入 = 余额 + 已实现盈亏」严格守恒（分内）
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

describe('金额精度守恒', () => {
  it('万笔小额定投后成本与期望分内一致', () => {
    const txs: LedgerTx[] = []
    for (let i = 0; i < 10000; i++) {
      txs.push(tx({
        type: 'BUY',
        quantity: 0.001,
        price: 12.34,
        amount: 0.001 * 12.34,
        fee: 0.01,
        occurredAt: D(`2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`),
      }))
    }
    const [pos] = foldTransactions(txs)
    const expected = 10000 * (0.001 * 12.34 + 0.01)
    // 分内一致（误差 < 0.005 元）
    expect(Math.abs(pos.costBasis - expected)).toBeLessThan(0.005)
  })

  it('现金账户守恒：总存款 = 余额 + 已实现盈亏（利息/费用后）', () => {
    const deposits = 3_000_000.37
    const txs: LedgerTx[] = [
      tx({ type: 'DEPOSIT', amount: deposits, assetClass: 'CASH' }),
      // 多笔非整额利息与费用
      tx({ type: 'INTEREST', amount: 12.345, occurredAt: D('2025-01-02'), assetClass: 'CASH' }),
      tx({ type: 'INTEREST', amount: 0.07, occurredAt: D('2025-01-03'), assetClass: 'CASH' }),
      tx({ type: 'FEE', amount: 1.01, occurredAt: D('2025-01-04'), assetClass: 'CASH' }),
    ]
    const [pos] = foldTransactions(txs)
    // 现金账户：FEE 只扣已实现盈亏，不影响余额；利息直接增加余额
    const balanceAfter = deposits + 12.345 + 0.07
    const netIncome = 12.345 + 0.07 - 1.01
    expect(Math.abs(pos.quantity - balanceAfter)).toBeLessThan(0.005)
    expect(Math.abs(pos.realizedPnl - netIncome)).toBeLessThan(0.005)
  })

  it('大额买卖多次后成本与已实现盈亏守恒（不凭空生钱）', () => {
    const txs: LedgerTx[] = []
    for (let round = 0; round < 500; round++) {
      txs.push(tx({
        type: 'BUY', quantity: 1000.001, price: 123.4567, amount: 1000.001 * 123.4567, fee: 0.03,
        occurredAt: D(`2025-${String((round % 12) + 1).padStart(2, '0')}-${String((round % 28) + 1).padStart(2, '0')}`),
      }))
      txs.push(tx({
        type: 'SELL', quantity: 1000, price: 124.0, amount: 1000 * 124.0, fee: 0.05,
        occurredAt: D(`2026-${String((round % 12) + 1).padStart(2, '0')}-${String((round % 28) + 1).padStart(2, '0')}`),
      }))
    }
    const [pos] = foldTransactions(txs)
    // 总成本投入 = 总卖出金额 − 已实现盈亏 + 剩余成本（费用已计入成本/盈亏）
    const totalBuyCost = txs.reduce((s, t) => s + (t.type === 'BUY' ? t.amount + t.fee : 0), 0)
    const totalSellNet = txs.reduce((s, t) => s + (t.type === 'SELL' ? t.amount - t.fee : 0), 0)
    // 会计恒等式：总投入 = 卖出净回 + 剩余成本 − 已实现盈亏
    // （已实现盈亏 = 卖出净回 − 卖出成本，故 卖出净回 − 已实现盈亏 = 卖出成本）
    const outflow = totalSellNet + pos.costBasis - pos.realizedPnl
    expect(Math.abs(totalBuyCost - outflow)).toBeLessThan(0.01)
  })
})
