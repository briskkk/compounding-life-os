import { describe, expect, it } from 'vitest'
import { investmentPlanBuysInputSchema } from '@/lib/schemas'

const buy = { planId: 'bought', date: '2026-09-14', navDate: '2026-09-14', amount: 100, fee: 0 }
const noBuy = { planId: 'not-bought', date: '2026-09-14' }

describe('定投按日核对输入', () => {
  it('整日未买无需制造 BUY，可单独确认', () => {
    const parsed = investmentPlanBuysInputSchema.parse({ confirmedNoBuy: true, buys: [], noBuy: [noBuy] })
    expect(parsed.buys).toEqual([])
    expect(parsed.noBuy).toEqual([noBuy])
  })

  it('同一次核对可同时录入已买并确认未买', () => {
    expect(investmentPlanBuysInputSchema.safeParse({
      confirmedActual: true,
      confirmedNoBuy: true,
      buys: [buy],
      noBuy: [noBuy],
    }).success).toBe(true)
  })

  it('未明确确认或同一计划日同时买与未买时拒绝', () => {
    expect(investmentPlanBuysInputSchema.safeParse({ buys: [], noBuy: [noBuy] }).success).toBe(false)
    expect(investmentPlanBuysInputSchema.safeParse({
      confirmedActual: true,
      confirmedNoBuy: true,
      buys: [buy],
      noBuy: [{ planId: buy.planId, date: buy.date }],
    }).success).toBe(false)
  })
})
