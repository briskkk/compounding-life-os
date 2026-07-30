import { describe, expect, it } from 'vitest'
import { createsSettlementCycle } from '@/lib/engine/settlement-account'

const accounts = [
  { id: 'bank', settlementAccountId: null },
  { id: 'broker-a', settlementAccountId: 'bank' },
  { id: 'broker-b', settlementAccountId: null },
]

describe('资金结算账户关系', () => {
  it('允许资金账户自结算及普通单向关联', () => {
    expect(createsSettlementCycle('bank', 'bank', accounts)).toBe(false)
    expect(createsSettlementCycle('broker-b', 'bank', accounts)).toBe(false)
  })

  it('拒绝直接或间接循环', () => {
    expect(createsSettlementCycle('bank', 'broker-a', accounts)).toBe(true)
    expect(createsSettlementCycle('broker-b', 'broker-b', accounts)).toBe(false)
    expect(createsSettlementCycle('broker-b', 'broker-a', [
      ...accounts,
      { id: 'bank', settlementAccountId: 'broker-b' },
    ])).toBe(true)
  })
})
