import { describe, expect, it } from 'vitest'
import { investmentPlanEditSchema, investmentPlanNoBuyWindowSchema } from '@/lib/schemas'

const planFields = {
  name: '纳指 100 定投',
  amount: 200,
  cadence: 'WEEKDAY' as const,
  scheduleDay: null,
  startDate: '2026-07-21T12:00:00+08:00',
  endDate: null,
  accountId: 'acct',
  assetIds: ['fund-a'],
  note: null,
}

describe('定投区间未买输入', () => {
  it('必须显式确认，且区间方向正确', () => {
    const ok = investmentPlanNoBuyWindowSchema.safeParse({
      from: '2026-09-14',
      to: '2026-09-18',
      planIds: ['plan-a'],
      confirmedNoBuy: true,
    })
    expect(ok.success).toBe(true)

    expect(investmentPlanNoBuyWindowSchema.safeParse({
      from: '2026-09-14', to: '2026-09-18', planIds: ['plan-a'], confirmedNoBuy: false,
    }).success).toBe(false)
    expect(investmentPlanNoBuyWindowSchema.safeParse({
      from: '2026-09-18', to: '2026-09-14', planIds: ['plan-a'], confirmedNoBuy: true,
    }).success).toBe(false)
    expect(investmentPlanNoBuyWindowSchema.safeParse({
      from: '2026-09-14', to: '2026-09-18', planIds: [], confirmedNoBuy: true,
    }).success).toBe(false)
  })

  it('日期格式非法时拒绝', () => {
    expect(investmentPlanNoBuyWindowSchema.safeParse({
      from: '2026-9-14', to: '2026-09-18', planIds: ['plan-a'], confirmedNoBuy: true,
    }).success).toBe(false)
  })
})

describe('定投计划编辑输入', () => {
  it('与创建共用字段约束，并额外要求计划 id', () => {
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a' }).success).toBe(true)
    expect(investmentPlanEditSchema.safeParse(planFields).success).toBe(false)
  })

  it('沿用创建的节奏与日程校验', () => {
    // 工作日计划不应带执行日
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a', scheduleDay: 3 }).success).toBe(false)
    // 每周执行日必须在 0–6
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a', cadence: 'WEEKLY', scheduleDay: 7 }).success).toBe(false)
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a', cadence: 'WEEKLY', scheduleDay: 3 }).success).toBe(true)
    // 每月执行日必须在 1–31
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a', cadence: 'MONTHLY', scheduleDay: 0 }).success).toBe(false)
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a', cadence: 'MONTHLY', scheduleDay: 15 }).success).toBe(true)
  })

  it('金额必须为正、候选资产不能为空', () => {
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a', amount: 0 }).success).toBe(false)
    expect(investmentPlanEditSchema.safeParse({ ...planFields, id: 'plan-a', assetIds: [] }).success).toBe(false)
  })
})
