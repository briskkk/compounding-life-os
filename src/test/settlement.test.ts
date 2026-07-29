import { describe, expect, it } from 'vitest'
import { buildSettlementLegs } from '@/lib/engine/settlement'
import type { TxInput } from '@/lib/engine/types'

const base: TxInput = {
  accountId: 'acc1',
  assetId: 'stock1',
  type: 'BUY',
  quantity: 100,
  price: 10,
  amount: 1000,
  fee: 5,
  occurredAt: new Date('2025-01-01'),
}

describe('现金结算腿', () => {
  it('BUY → WITHDRAW（金额 + 费用），internal 标记', () => {
    const legs = buildSettlementLegs(base, 'cash1', 'cmb')
    expect(legs).toHaveLength(1)
    expect(legs[0].type).toBe('WITHDRAW')
    expect(legs[0].amount).toBe(1005)
    expect(legs[0].internal).toBe(true)
    expect(legs[0].accountId).toBe('cmb')
  })

  it('SELL → DEPOSIT（金额 − 费用）', () => {
    const legs = buildSettlementLegs({ ...base, type: 'SELL' }, 'cash1', 'cmb')
    expect(legs).toHaveLength(1)
    expect(legs[0].type).toBe('DEPOSIT')
    expect(legs[0].amount).toBe(995)
  })

  it('现金资产自身 / 零金额 / 非买卖类型 → 无腿', () => {
    expect(buildSettlementLegs({ ...base, assetId: 'cash1' }, 'cash1', 'cmb')).toHaveLength(0)
    expect(buildSettlementLegs({ ...base, amount: 0, fee: 0 }, 'cash1', 'cmb')).toHaveLength(0)
    expect(buildSettlementLegs({ ...base, type: 'DIVIDEND' }, 'cash1', 'cmb')).toHaveLength(0)
  })
})
