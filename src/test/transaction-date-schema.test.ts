import { describe, expect, it } from 'vitest'
import { txInputSchema } from '@/lib/schemas'

const purchase = {
  accountId: 'fund-account',
  assetId: 'fund',
  type: 'BUY',
  quantity: 100,
  price: 10,
  amount: 1000,
  fee: 0,
  occurredAt: '2026-10-26T12:00:00+08:00',
  note: null,
}

describe('流水日期按北京时间自然日校验', () => {
  it.each(['navDate', 'settlementDate'])('%s 允许同日零点和后续日期', (field) => {
    for (const date of ['2026-10-26T00:00:00+08:00', '2026-10-27T00:00:00+08:00']) {
      expect(txInputSchema.safeParse({ ...purchase, [field]: date }).success).toBe(true)
    }
  })

  it.each(['navDate', 'settlementDate'])('%s 拒绝北京时间前一天，即使 UTC 日期相同', (field) => {
    const result = txInputSchema.safeParse({
      ...purchase,
      occurredAt: '2026-10-26T00:01:00+08:00',
      [field]: '2026-10-25T23:59:00+08:00',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: [field] }))
  })

  it.each(['navDate', 'settlementDate'])('%s 接受跨 UTC 日期的同一北京时间日期', (field) => {
    expect(txInputSchema.safeParse({
      ...purchase,
      occurredAt: new Date('2026-10-26T15:59:00Z'),
      [field]: new Date('2026-10-25T16:00:00Z'),
    }).success).toBe(true)
  })

  it('历史按金额申购允许当日净值日且保留未知份额', () => {
    const result = txInputSchema.parse({
      ...purchase,
      quantity: null,
      price: null,
      navSource: 'PENDING',
      navDate: '2026-10-26T00:00:00+08:00',
      settleCash: true,
    })
    expect(result.quantity).toBeNull()
    expect(result.price).toBeNull()
    expect(result.navDate?.toISOString()).toBe('2026-10-25T16:00:00.000Z')
  })

  it('非基金流水仍可省略或留空可选日期', () => {
    expect(txInputSchema.safeParse(purchase).success).toBe(true)
    expect(txInputSchema.safeParse({ ...purchase, navDate: null, settlementDate: null }).success).toBe(true)
  })
})
