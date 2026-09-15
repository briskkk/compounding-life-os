import { describe, expect, it } from 'vitest'
import { buildMonthClose } from '@/lib/engine/month-close'

const planRow = (dueAmount: number, actualAmount: number) => ({
  scheduledDates: [new Date('2026-07-15T04:00:00Z')],
  transactionCount: actualAmount > 0 ? 1 : 0,
  dueAmount,
  actualAmount,
})

describe('buildMonthClose', () => {
  it('只有四类既有证据都完成时才显示 4/4', () => {
    const result = buildMonthClose({
      snapshot: { status: 'SETTLED', coverage: 1 },
      pendingFundCount: 0,
      activeAccountIds: ['broker', 'fund'],
      reconciledAccountIds: ['broker', 'fund'],
      planRows: [planRow(6000, 6000)],
      reviewStatus: 'COMPLETED',
    })

    expect(result.completedSteps).toBe(4)
    expect(result.data.status).toBe('COMPLETE')
    expect(result.reconciliation.status).toBe('COMPLETE')
    expect(result.investmentPlan.status).toBe('COMPLETE')
    expect(result.review.status).toBe('COMPLETE')
  })

  it('估值缺口或待确认申购会阻止数据确认完成', () => {
    const partial = buildMonthClose({
      snapshot: { status: 'PARTIAL', coverage: 0.72 },
      pendingFundCount: 0,
      activeAccountIds: [],
      reconciledAccountIds: [],
      planRows: [],
      reviewStatus: null,
    })
    const pending = buildMonthClose({
      snapshot: { status: 'SETTLED', coverage: 1 },
      pendingFundCount: 2,
      activeAccountIds: [],
      reconciledAccountIds: [],
      planRows: [],
      reviewStatus: null,
    })

    expect(partial.data).toMatchObject({ status: 'ATTENTION', summary: '最近快照状态为 PARTIAL' })
    expect(pending.data).toMatchObject({ status: 'ATTENTION', summary: '2 笔基金申购仍待确认' })
  })

  it('账户只按当月活跃集合核对并去重', () => {
    const result = buildMonthClose({
      snapshot: null,
      pendingFundCount: 0,
      activeAccountIds: ['broker', 'broker', 'bank'],
      reconciledAccountIds: ['broker', 'old-account'],
      planRows: [],
      reviewStatus: null,
    })

    expect(result.reconciliation).toMatchObject({ status: 'ATTENTION', summary: '1/2 个活跃账户已核对' })
  })

  it('尚未到期、未配置和未达标的定投分别保留不同状态', () => {
    const empty = buildMonthClose({
      snapshot: null,
      pendingFundCount: 0,
      activeAccountIds: [],
      reconciledAccountIds: [],
      planRows: [],
      reviewStatus: null,
    })
    const upcoming = buildMonthClose({
      snapshot: null,
      pendingFundCount: 0,
      activeAccountIds: [],
      reconciledAccountIds: [],
      planRows: [planRow(0, 0)],
      reviewStatus: null,
    })
    const behind = buildMonthClose({
      snapshot: null,
      pendingFundCount: 0,
      activeAccountIds: [],
      reconciledAccountIds: [],
      planRows: [planRow(6000, 5990)],
      reviewStatus: 'DRAFT',
    })

    expect(empty.investmentPlan.status).toBe('EMPTY')
    expect(upcoming.investmentPlan.status).toBe('READY')
    expect(behind.investmentPlan.status).toBe('ATTENTION')
    expect(behind.review.status).toBe('READY')
  })
})
