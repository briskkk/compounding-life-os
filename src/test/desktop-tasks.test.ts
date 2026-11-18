import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { assembleOverviewTasks, loadOverviewTasks, reconciliationAccountId } from '@/lib/services/overview-tasks'
import { buildOverviewTasks } from '@/lib/engine/overview-tasks'
import type { InvestmentPlanInput } from '@/lib/engine/investment-plan'
import type { FamilyCtx } from '@/lib/scoped'

function plan(): InvestmentPlanInput {
  return {
    id: 'plan-a',
    name: '家庭定投',
    amount: 1000,
    currency: 'CNY',
    cadence: 'MONTHLY',
    scheduleDay: 15,
    startDate: new Date(2026, 0, 1, 12),
    endDate: null,
    status: 'ACTIVE',
    endedAt: null,
    accountId: 'broker-a',
    assetIds: ['fund-a'],
  }
}

const now = new Date(2026, 8, 20, 18)
const rates = { CNY: 1, USD: 7.2, HKD: 0.9 }

describe('桌面待办装配', () => {
  it('汇率、对账月份和定投入参交给总览引擎，不另写判断', () => {
    const tasks = assembleOverviewTasks({
      pendingFundPurchases: [
        { assetName: '美元基金', amount: 10, currency: 'USD', navDate: new Date('2026-09-16T00:00:00+08:00') },
      ],
      currencyRates: rates,
      monthTxAccountIds: ['cash', 'broker', 'cash'],
      reconcileLogs: [
        { entityId: 'cash', detail: JSON.stringify({ version: 1, asOfDate: '2026-09-18' }) },
        { entityId: 'broker', detail: JSON.stringify({ version: 1, asOfDate: '2026-08-18' }) },
        { entityId: 'other', detail: 'not-json' },
      ],
      accounts: [
        { id: 'cash', name: '工资卡' },
        { id: 'broker', name: '券商账户' },
      ],
      plans: [plan()],
      buys: [],
      planReviews: [],
      now,
    })

    const expected = buildOverviewTasks({
      pendingFundPurchases: [
        { assetName: '美元基金', amount: 72, navDate: '2026-09-15' },
      ],
      plans: [plan()],
      buys: [],
      planReviews: [],
      unreconciledAccounts: ['券商账户'],
      month: '2026-09',
      now,
    })
    expect(tasks).toEqual(expected)
    expect(tasks.map((task) => task.key)).toEqual([
      'FUND_CONFIRMATION',
      'INVESTMENT_PLAN',
      'ACCOUNT_RECONCILIATION',
    ])
    expect(tasks[0]).toMatchObject({
      count: 1,
      title: '1 笔基金份额待确认',
      href: '/fund-confirmations',
      action: '去核对份额',
      evidence: { assetName: '美元基金', amount: 72, navDate: '2026-09-15' },
    })
    expect(tasks[1]).toMatchObject({
      count: 1,
      href: '/investment-plans',
      action: '去核对定投',
      evidence: { planCount: 1 },
    })
    expect(tasks[2]).toMatchObject({
      count: 1,
      href: '/reconciliation',
      action: '去核对账户',
      evidence: { accountNames: ['券商账户'] },
    })
    expect(tasks.every((task) => task.count > 0)).toBe(true)
  })

  it('数量为 0 的类别不进入列表', () => {
    const tasks = assembleOverviewTasks({
      pendingFundPurchases: [],
      currencyRates: rates,
      monthTxAccountIds: [],
      reconcileLogs: [],
      accounts: [],
      plans: [plan()],
      buys: [],
      planReviews: [],
      now,
    })
    expect(tasks.map((task) => task.key)).toEqual(['INVESTMENT_PLAN'])
    expect(tasks.every((task) => task.count > 0)).toBe(true)
  })

  it('当月对账凭证以外的记录不算已对账', () => {
    expect(reconciliationAccountId(null, '2026-09', 'cash')).toBeNull()
    expect(reconciliationAccountId('{}', '2026-09', 'cash')).toBeNull()
    expect(reconciliationAccountId(
      JSON.stringify({ version: 1, asOfDate: '2026-09-01' }),
      '2026-09',
      'cash',
    )).toBe('cash')
  })

  it('没有待办时返回空数组', () => {
    expect(assembleOverviewTasks({
      pendingFundPurchases: [],
      currencyRates: rates,
      monthTxAccountIds: [],
      reconcileLogs: [],
      accounts: [],
      plans: [],
      buys: [],
      planReviews: [],
      now,
    })).toEqual([])
  })
})

const base = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/test.db')}` })
const familyIds: string[] = []

function ctxOf(familyId: string): FamilyCtx {
  return { familyId, memberId: 'member-a', memberName: '测试', role: 'OWNER', userId: 'user-a' }
}

afterAll(async () => {
  if (familyIds.length > 0) {
    await base.familySpace.deleteMany({ where: { id: { in: familyIds } } })
  }
  await base.$disconnect()
})

describe('桌面待办读取', () => {
  it('空家庭返回空列表，有证据时返回三类待办且不计已确认份额', async () => {
    const empty = await base.familySpace.create({ data: { name: '空家庭待办' } })
    const filled = await base.familySpace.create({ data: { name: '有待办家庭' } })
    familyIds.push(empty.id, filled.id)
    const asOf = new Date('2026-11-18T02:00:00Z')

    expect(await loadOverviewTasks(ctxOf(empty.id), { now: asOf, client: base })).toEqual([])

    const account = await base.account.create({
      data: { familyId: filled.id, name: '券商', type: 'BROKERAGE', currency: 'CNY' },
    })
    const fund = await base.asset.create({
      data: { familyId: filled.id, symbol: `DESK-${filled.id}`, name: '测试基金', cls: 'FUND', currency: 'CNY' },
    })
    await base.transaction.create({
      data: {
        familyId: filled.id,
        accountId: account.id,
        assetId: fund.id,
        type: 'BUY',
        quantity: null,
        price: null,
        amount: 1200,
        fee: 0,
        occurredAt: new Date('2026-11-10T02:00:00Z'),
        navDate: new Date('2026-11-10T00:00:00Z'),
        navSource: 'PENDING',
      },
    })
    await base.transaction.create({
      data: {
        familyId: filled.id,
        accountId: account.id,
        assetId: fund.id,
        type: 'BUY',
        quantity: 100,
        price: 1,
        amount: 100,
        fee: 0,
        occurredAt: new Date('2026-11-01T02:00:00Z'),
        navDate: new Date('2026-11-01T00:00:00Z'),
        navSource: 'OFFICIAL',
      },
    })
    await base.investmentPlan.create({
      data: {
        familyId: filled.id,
        accountId: account.id,
        name: '家庭定投',
        amount: 1000,
        currency: 'CNY',
        cadence: 'MONTHLY',
        scheduleDay: 15,
        startDate: new Date('2026-01-01T04:00:00Z'),
        assets: { create: [{ familyId: filled.id, assetId: fund.id }] },
      },
    })

    const tasks = await loadOverviewTasks(ctxOf(filled.id), { now: asOf, client: base })
    expect(tasks.map((task) => task.key)).toEqual([
      'FUND_CONFIRMATION',
      'INVESTMENT_PLAN',
      'ACCOUNT_RECONCILIATION',
    ])
    expect(tasks.every((task) => task.count > 0)).toBe(true)
    expect(tasks[0]).toMatchObject({
      count: 1,
      href: '/fund-confirmations',
      action: '去核对份额',
      evidence: { assetName: '测试基金', amount: 1200, navDate: '2026-11-10' },
    })
    expect(tasks[1]).toMatchObject({
      href: '/investment-plans',
      action: '去核对定投',
      evidence: { planCount: 1 },
    })
    expect(tasks[1].count).toBeGreaterThan(0)
    expect(tasks[2]).toMatchObject({
      count: 1,
      href: '/reconciliation',
      action: '去核对账户',
      evidence: { accountNames: ['券商'] },
    })

    await base.auditLog.create({
      data: {
        familyId: filled.id,
        actorName: '测试',
        action: 'RECONCILE',
        entity: 'Account',
        entityId: account.id,
        detail: JSON.stringify({ version: 1, asOfDate: '2026-11-18' }),
        hash: `desktop-tasks-${filled.id}`,
        chainScope: filled.id,
        chainKey: 'GENESIS',
      },
    })
    const afterReconcile = await loadOverviewTasks(ctxOf(filled.id), { now: asOf, client: base })
    expect(afterReconcile.map((task) => task.key)).toEqual(['FUND_CONFIRMATION', 'INVESTMENT_PLAN'])
    expect(afterReconcile.every((task) => task.count > 0)).toBe(true)
  })
})
