import { describe, expect, it } from 'vitest'
import { transactionPayment } from '@/lib/engine/transaction-payment'
import { buildSettlementLegs } from '@/lib/engine/settlement'
import type { TxInput, TxType } from '@/lib/engine/types'

describe('流水含费收付', () => {
  it.each([
    ['BUY', '买入支出', 1347.85],
    ['SELL', '卖出净额', 1347.35],
    ['DIVIDEND', '收入净额', 1347.35],
    ['INTEREST', '收入净额', 1347.35],
  ] as const)('%s 与账本现金结算使用同一含费金额', (type, label, amount) => {
    const tx: TxInput = {
      type, amount: 1347.6, fee: 0.25, quantity: 1200, price: 1.123,
      accountId: 'broker', assetId: 'asset', occurredAt: new Date('2025-01-02T02:00:00Z'),
    }
    expect(transactionPayment(tx)?.label).toBe(label)
    expect(transactionPayment(tx)?.amount).toBeCloseTo(amount)
    expect(transactionPayment(tx)?.amount).toBe(buildSettlementLegs(tx, 'cash', 'bank')[0].amount)
    expect(tx.amount).toBe(1347.6)
    expect(tx.fee).toBe(0.25)
  })

  it('零费用保留原币精度，不提前按人民币分位舍入', () => {
    expect(transactionPayment({ type: 'BUY', amount: 12.3456, fee: 0 })).toEqual({ label: '买入支出', amount: 12.3456 })
  })

  it('作废流水及非买卖收入事件不显示含费收付', () => {
    expect(transactionPayment({ type: 'BUY', amount: 1347.6, fee: 0.25, voidedAt: new Date() })).toBeNull()
    const types: TxType[] = ['FEE', 'DEPOSIT', 'WITHDRAW', 'TRANSFER_IN', 'TRANSFER_OUT', 'VALUATION', 'VEST', 'SHARE_ADJUSTMENT', 'COST_ADJUSTMENT', 'REVERSAL']
    for (const type of types) expect(transactionPayment({ type, amount: 1347.6, fee: 0.25 })).toBeNull()
  })
})
