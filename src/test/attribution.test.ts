import { describe, expect, it } from 'vitest'
import { annualized, cumulativeContributions, dailyNetFlows, twrSeries, xirr, xirrFlowsFromTxs } from '@/lib/engine/attribution'
import type { LedgerTx } from '@/lib/engine/ledger'
import type { TxInput } from '@/lib/engine/types'

const D = (s: string) => new Date(s)

function tx(partial: Partial<TxInput> & Pick<TxInput, 'type'>): TxInput {
  return {
    accountId: 'a',
    assetId: 'cash',
    quantity: null,
    price: null,
    amount: 0,
    fee: 0,
    occurredAt: D('2025-01-01'),
    ...partial,
  }
}

describe('收益归因', () => {
  it('外部净流按日聚合，内部结算腿不计入', () => {
    const flows = dailyNetFlows([
      tx({ type: 'DEPOSIT', amount: 42000, occurredAt: D('2025-01-10') }),
      tx({ type: 'DEPOSIT', amount: 6000, occurredAt: D('2025-01-15'), internal: true }), // 结算腿
      tx({ type: 'WITHDRAW', amount: 8000, occurredAt: D('2025-01-20') }),
      tx({ type: 'TRANSFER_IN', amount: 18000, occurredAt: D('2025-01-11') }), // 转账类型本身不算外部流
    ])
    expect(flows.size).toBe(2)
    // 逐日序列累计：到 01-21 应包含 01-10 的存入与 01-20 的取出
    const days = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)))
    const cum = cumulativeContributions(days, flows)
    expect(cum[9]).toBe(42000)
    expect(cum[20]).toBe(34000)
  })

  it('无现金结算腿的可交易黄金买卖按组合外转入转出处理', () => {
    const goldBuy: LedgerTx = {
      id: 'gold-buy',
      accountId: 'gold-account',
      assetId: 'gold',
      assetClass: 'GOLD',
      type: 'BUY',
      quantity: 10,
      price: 100,
      amount: 1000,
      fee: 2,
      occurredAt: D('2025-01-10'),
    }
    const settledSell: LedgerTx = {
      ...goldBuy,
      id: 'gold-sell-settled',
      type: 'SELL',
      quantity: 2,
      amount: 220,
      fee: 1,
      occurredAt: D('2025-01-20'),
    }
    const settlementLeg: LedgerTx = {
      id: 'cash-leg',
      settleOfId: settledSell.id,
      accountId: 'cash-account',
      assetId: 'cash',
      assetClass: 'CASH',
      type: 'DEPOSIT',
      quantity: null,
      price: null,
      amount: 219,
      fee: 0,
      occurredAt: D('2025-01-20'),
      internal: true,
    }
    const standaloneSell: LedgerTx = {
      ...settledSell,
      id: 'gold-sell-external',
      amount: 240,
      occurredAt: D('2025-01-25'),
    }
    const txs = [goldBuy, settledSell, settlementLeg, standaloneSell]
    const flows = dailyNetFlows(txs)

    expect(flows.get(Math.floor(D('2025-01-10').getTime() / 86400000))).toBe(1002)
    expect(flows.has(Math.floor(D('2025-01-20').getTime() / 86400000))).toBe(false)
    expect(flows.get(Math.floor(D('2025-01-25').getTime() / 86400000))).toBe(-239)
    expect(xirrFlowsFromTxs(txs)).toEqual([
      { date: D('2025-01-10'), amount: -1002 },
      { date: D('2025-01-25'), amount: 239 },
    ])
  })

  it('TWR 消除出入金影响：day2 无流涨 10%，day3 入金后持平', () => {
    const points = [
      { date: D('2025-01-01'), netWorth: 0 },
      { date: D('2025-01-02'), netWorth: 1000 },
      { date: D('2025-01-03'), netWorth: 1100 },
      { date: D('2025-01-04'), netWorth: 2100 }, // 入金 1000，市值本身没变
    ]
    const flows = dailyNetFlows([
      tx({ type: 'DEPOSIT', amount: 1000, occurredAt: D('2025-01-02') }),
      tx({ type: 'DEPOSIT', amount: 1000, occurredAt: D('2025-01-04') }),
    ])
    const twr = twrSeries(points, flows)
    expect(twr[2].dailyReturn).toBeCloseTo(0.1)
    expect(twr[3].dailyReturn).toBeCloseTo(0) // 入金日不计收益
    expect(twr[3].cumulative).toBeCloseTo(0.1)
  })

  it('华为股票估值变化不进入可投资资产 TWR', () => {
    const totalNetWorth = [
      { date: D('2025-01-01'), netWorth: 1000 },
      { date: D('2025-01-02'), netWorth: 1500 },
    ]
    const investable = [
      { date: D('2025-01-01'), netWorth: 1000 },
      { date: D('2025-01-02'), netWorth: 1000 },
    ]

    expect(twrSeries(totalNetWorth, new Map()).at(-1)?.dailyReturn).toBeCloseTo(0.5)
    expect(twrSeries(investable, new Map()).at(-1)?.dailyReturn).toBe(0)
  })

  it('XIRR：单笔投入一年后 +10% → 年化约 10%', () => {
    const r = xirr([{ date: D('2025-01-01'), amount: -1000 }], 1100, D('2026-01-01'))
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(0.1, 2)
  })

  it('XIRR：由流水构造（投入取负）', () => {
    const flows = xirrFlowsFromTxs([
      tx({ type: 'DEPOSIT', amount: 10000, occurredAt: D('2025-01-01') }),
      tx({ type: 'WITHDRAW', amount: 2000, occurredAt: D('2025-06-01') }),
      tx({ type: 'DEPOSIT', amount: 999, internal: true }), // 内部腿排除
    ])
    expect(flows).toEqual([
      { date: D('2025-01-01'), amount: -10000 },
      { date: D('2025-06-01'), amount: 2000 },
    ])
  })

  it('已冲正的外部出入金不计入净投入与 XIRR', () => {
    const txs = [
      tx({ type: 'DEPOSIT', amount: 10000, occurredAt: D('2025-01-01'), voidedAt: D('2025-02-01') }),
      tx({ type: 'DEPOSIT', amount: 3000, occurredAt: D('2025-01-02') }),
    ]
    const flows = dailyNetFlows(txs)
    expect([...flows.values()]).toEqual([3000])
    expect(xirrFlowsFromTxs(txs)).toEqual([{ date: D('2025-01-02'), amount: -3000 }])
  })

  it('annualized：不足一年按天数折算', () => {
    expect(annualized(0.1, 365)).toBeCloseTo(0.1, 3)
    expect(annualized(0.21, 730)).toBeCloseTo(0.1, 2)
    expect(annualized(-1.5, 100)).toBeNull()
  })

  it('外币现金流按汇率折人民币（净投入与 XIRR 一致性）', () => {
    const rate = (cur: string) => (cur === 'USD' ? 6.77 : 1)
    const txs = [
      tx({ type: 'DEPOSIT', amount: 1000, occurredAt: D('2025-01-10'), currency: 'USD' }),
      tx({ type: 'DEPOSIT', amount: 1000, occurredAt: D('2025-01-10') }), // CNY 缺省
    ]
    const flows = dailyNetFlows(txs, rate)
    const key = Math.floor(D('2025-01-10').getTime() / 86400000)
    expect(flows.get(key)).toBeCloseTo(6770 + 1000)

    const xirrFlows = xirrFlowsFromTxs(txs, rate)
    expect(xirrFlows[0].amount).toBeCloseTo(-6770)
    expect(xirrFlows[1].amount).toBeCloseTo(-1000)
    // 缺省 rate 时退回原值（CNY 行为不变）
    expect(xirrFlowsFromTxs(txs)[0].amount).toBe(-1000)
  })
})
