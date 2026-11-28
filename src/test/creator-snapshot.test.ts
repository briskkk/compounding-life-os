import { describe, expect, it } from 'vitest'
import { creatorProfileSchema, creatorSnapshotSchema } from '@/lib/creator-export-contract'
import { buildCreatorSnapshot, creatorSession, type CreatorSource } from '@/lib/engine/creator-snapshot'
import type { LedgerTx } from '@/lib/engine/ledger'
import examples from '../../docs/creator-daily-snapshots.examples.json'

const profile = creatorProfileSchema.parse({
  slug: 'demo', enabled: true, familyId: 'family', authorizedByUserId: 'owner',
  accountIds: ['bank', 'broker'], scope: 'INVESTABLE', accountScopeLabel: '可投资资产',
  startDate: '2026-11-19', cutoffTime: '23:59:59', calendar: { kind: 'CN_FUND' },
  operationLabels: { etf: '宽基ETF', fund: '指数基金', gold: '黄金' },
  publicFields: ['assetTotal', 'pnl', 'netContribution', 'operations'], tokenHashes: ['a'.repeat(64)],
})
function tx(id: string, type: LedgerTx['type'], overrides: Partial<LedgerTx> = {}): LedgerTx {
  return {
    id, type, accountId: 'bank', assetId: 'cash', assetClass: 'CASH', currency: 'CNY',
    quantity: null, price: null, amount: 0, fee: 0,
    occurredAt: new Date('2026-11-19T10:00:00+08:00'), ...overrides,
  }
}
function fixture(): CreatorSource {
  return {
    assets: [
      { id: 'cash', symbol: 'CASH-CNY', name: '秘密现金名', cls: 'CASH', currency: 'CNY', manual: false },
      { id: 'etf', symbol: '510300', name: '秘密持仓名', cls: 'ETF', currency: 'CNY', manual: false },
      { id: 'home', symbol: 'HOME', name: '房产', cls: 'REAL_ESTATE', currency: 'CNY', manual: true },
    ],
    transactions: [
      tx('deposit', 'DEPOSIT', { amount: 1000.12 }),
      tx('buy', 'BUY', { accountId: 'broker', assetId: 'etf', assetClass: 'ETF', quantity: 10, price: 10, amount: 100, fee: 1 }),
      tx('buy-cash', 'WITHDRAW', { amount: 101, internal: true, settleOfId: 'buy' }),
    ],
    prices: [
      { symbol: '510300', date: '2026-11-19', close: 10, source: 'TENCENT' },
      { symbol: '510300', date: '2026-11-20', close: 12, source: 'TENCENT' },
      { symbol: '510300', date: '2026-11-23', close: 13, source: 'TENCENT' },
    ], rates: [],
  }
}
const now = new Date('2026-11-28T12:00:00+08:00')
function ready(source = fixture(), date = '2026-11-20', config = profile) {
  const result = buildCreatorSnapshot(config, source, date, now)
  expect(creatorSnapshotSchema.safeParse(result).success).toBe(true)
  expect(result.status).toBe('ready')
  if (result.status !== 'ready') throw new Error('Expected ready snapshot')
  return result
}

describe('creator 历史日终快照', () => {
  it('交付的虚构响应严格符合公开契约，历史重取相同、更正版本不同', () => {
    const { synthetic, ...responses } = examples
    expect(synthetic).toBe(true)
    for (const response of Object.values(responses)) expect(creatorSnapshotSchema.safeParse(response).success).toBe(true)
    expect(examples.historicalReplay).toEqual(examples.daily)
    expect(examples.noOperations).toEqual(examples.daily)
    if (examples.daily.status === 'ready' && examples.corrected.status === 'ready') {
      expect(examples.corrected.snapshotId).not.toBe(examples.daily.snapshotId)
    }
  })
  it('首日基线保留分，不公布无法比较的收益与净投入', () => {
    const result = ready(fixture(), '2026-11-19')
    expect(result).toMatchObject({ kind: 'baseline', dayNumber: 1, assetTotal: '999.12', pnl: null, netContribution: null })
    expect(result.operations).toEqual([{ side: 'BUY', label: '宽基ETF', amount: '100.00' }])
  })

  it('普通无操作日与历史补发共享同口径，重取标识不变且无敏感字段', () => {
    const result = ready()
    expect(result).toMatchObject({ kind: 'daily', dayNumber: 2, assetTotal: '1019.12', pnl: '20.00', netContribution: '0.00', operations: [] })
    expect(buildCreatorSnapshot(profile, fixture(), '2026-11-20', new Date('2026-12-28T00:00:00Z'))).toEqual(result)
    expect(ready({ ...fixture(), transactions: [...fixture().transactions].reverse() }).snapshotId).toBe(result.snapshotId)
    expect(JSON.stringify(result)).not.toMatch(/秘密|family|owner|bank|broker|quantity|costBasis|tokenHashes/)
    expect(result.snapshotId).toMatch(/^cs1_[a-f0-9]{64}$/)
  })

  it('行情与账本正式更正生成新标识，包括小于分的修正；轮换凭证不变', () => {
    const input = fixture()
    const first = ready(input)
    input.prices[1].close = 12.00001
    expect(ready(input).snapshotId).not.toBe(first.snapshotId)
    expect(ready(input).assetTotal).toBe(first.assetTotal)
    expect(ready(fixture(), '2026-11-20', { ...profile, tokenHashes: ['b'.repeat(64)] }).snapshotId).toBe(first.snapshotId)
    const changed = fixture()
    changed.transactions[0].amount += 1
    expect(ready(changed).snapshotId).not.toBe(first.snapshotId)
  })

  it('周末、法定休市为 no_session，未知年度与未到截点为 pending', () => {
    expect(buildCreatorSnapshot(profile, fixture(), '2026-11-21', now).status).toBe('no_session')
    expect(creatorSession(profile.calendar, '2026-10-01')).toBe(false)
    expect(buildCreatorSnapshot(profile, fixture(), '2027-01-04', now).status).toBe('pending')
    expect(buildCreatorSnapshot(profile, fixture(), '2026-11-20', new Date('2026-11-20T23:59:58+08:00')).status).toBe('pending')
  })

  it('日终行情缺失、模拟、错源与上一交易日缺估值均不发布', () => {
    for (const source of ['SIMULATED', 'OFFICIAL_ESTIMATE', 'EASTMONEY-FUND']) {
      const input = fixture()
      input.prices[1].source = source
      expect(buildCreatorSnapshot(profile, input, '2026-11-20', now).status).toBe('pending')
    }
    const missing = fixture()
    missing.prices.shift()
    expect(buildCreatorSnapshot(profile, missing, '2026-11-20', now).status).toBe('pending')
    expect(buildCreatorSnapshot({ ...profile, cutoffTime: '14:00:00' }, fixture(), '2026-11-20', now).status).toBe('pending')
  })

  it('PENDING 和估算基金不升级为已结算，缺公开操作别名不泄露原名', () => {
    const input = fixture()
    input.transactions.push(tx('pending', 'BUY', { assetId: 'etf', assetClass: 'ETF', navSource: 'PENDING', occurredAt: new Date('2026-11-20T10:00:00+08:00') }))
    expect(buildCreatorSnapshot(profile, input, '2026-11-20', now).status).toBe('pending')
    expect(buildCreatorSnapshot({ ...profile, operationLabels: {} }, fixture(), '2026-11-19', now).status).toBe('pending')
  })

  it('现金外部存取计净投入，范围内买卖含费用留在投资收益', () => {
    const input = fixture()
    const at = new Date('2026-11-20T10:00:00+08:00')
    input.transactions.push(
      tx('external-in', 'DEPOSIT', { amount: 200, occurredAt: at }),
      tx('external-out', 'WITHDRAW', { amount: 50, occurredAt: at }),
      tx('buy2', 'BUY', { accountId: 'broker', assetId: 'etf', assetClass: 'ETF', quantity: 2, price: 12, amount: 24, fee: 0.12, occurredAt: at }),
      tx('buy2-cash', 'WITHDRAW', { amount: 24.12, internal: true, settleOfId: 'buy2', occurredAt: at }),
    )
    expect(ready(input)).toMatchObject({ assetTotal: '1169.00', pnl: '19.88', netContribution: '150.00' })
  })

  it('范围内证券划转不计投入，跨范围现金结算计入与计出', () => {
    const input = fixture()
    const at = new Date('2026-11-20T10:00:00+08:00')
    input.transactions.push(
      tx('transfer-out', 'TRANSFER_OUT', { accountId: 'broker', assetId: 'etf', assetClass: 'ETF', quantity: 2, amount: 20, occurredAt: at }),
      tx('transfer-in', 'TRANSFER_IN', { assetId: 'etf', assetClass: 'ETF', quantity: 2, amount: 20, occurredAt: at }),
      tx('home-buy', 'BUY', { assetId: 'home', assetClass: 'REAL_ESTATE', quantity: 1, price: 100, amount: 100, occurredAt: at }),
      tx('home-cash', 'WITHDRAW', { amount: 100, internal: true, settleOfId: 'home-buy', occurredAt: at }),
    )
    expect(ready(input)).toMatchObject({ assetTotal: '919.12', pnl: '20.00', netContribution: '-100.00' })
    // Selecting just brokerage makes the bank-funded initial buy a scope contribution.
    const scoped = { ...profile, accountIds: ['broker'] }
    expect(ready(input, '2026-11-20', scoped)).toMatchObject({ netContribution: '-24.00', pnl: '20.00' })
  })

  it('清仓与赎回在途不丢资产，冲正记录不进入结果或操作', () => {
    const input = fixture()
    const at = new Date('2026-11-20T10:00:00+08:00')
    input.transactions.push(
      tx('sell', 'SELL', { accountId: 'broker', assetId: 'etf', assetClass: 'ETF', quantity: 10, price: 12, amount: 120, fee: 1, occurredAt: at }),
      tx('sell-cash', 'DEPOSIT', { amount: 119, internal: true, settleOfId: 'sell', occurredAt: new Date('2026-11-23T10:00:00+08:00') }),
      tx('void', 'BUY', { assetId: 'etf', assetClass: 'ETF', amount: 999, quantity: 99, price: 99, occurredAt: at, voidedAt: now }),
    )
    const result = ready(input)
    expect(result).toMatchObject({ assetTotal: '1018.12', pnl: '19.00', netContribution: '0.00' })
    expect(result.operations).toEqual([{ side: 'SELL', label: '宽基ETF', amount: '120.00' }])
    expect(ready(input, '2026-11-23')).toMatchObject({ assetTotal: '1018.12', pnl: '0.00', netContribution: '0.00' })
  })

  it('周末外部资金并入下个记录交易日，天数不算休市日', () => {
    const input = fixture()
    input.transactions.push(tx('weekend', 'DEPOSIT', { amount: 10.01, occurredAt: new Date('2026-11-21T12:00:00+08:00') }))
    expect(ready(input, '2026-11-23')).toMatchObject({ dayNumber: 3, assetTotal: '1039.13', pnl: '10.00', netContribution: '10.01' })
  })

  it('北京时间零点及截点边界不依赖宿主时区', () => {
    const input = fixture()
    input.transactions.push(
      tx('beijing-start', 'DEPOSIT', { amount: 10, occurredAt: new Date('2026-11-19T16:00:00Z') }),
      tx('last-second', 'DEPOSIT', { amount: 20, occurredAt: new Date('2026-11-20T15:59:59Z') }),
      tx('next-day', 'DEPOSIT', { amount: 40, occurredAt: new Date('2026-11-20T16:00:00Z') }),
    )
    expect(ready(input)).toMatchObject({ netContribution: '30.00', pnl: '20.00', assetTotal: '1049.12' })
  })

  it('缺历史汇率不回落实时汇率；美股必须有北京归属日历', () => {
    const input = fixture()
    input.assets.push({ id: 'usd', symbol: 'CASH-USD', name: '美元', cls: 'CASH', currency: 'USD', manual: false })
    input.transactions.push(tx('usd-in', 'DEPOSIT', { assetId: 'usd', currency: 'USD', amount: 10 }))
    expect(buildCreatorSnapshot(profile, input, '2026-11-20', now).status).toBe('pending')
    input.rates = ['2026-11-19', '2026-11-20'].map((date, i) => ({ currency: 'USD', date, rate: 7 + i * 0.1, source: 'ECB' }))
    expect(ready(input)).toMatchObject({ pnl: '21.00', assetTotal: '1090.12' })
    input.assets[1] = { ...input.assets[1], symbol: 'USSPY', currency: 'USD' }
    input.prices = input.prices.map((row) => ({ ...row, symbol: 'USSPY' }))
    expect(buildCreatorSnapshot(profile, input, '2026-11-20', now).status).toBe('pending')
    const calendar = { kind: 'EXPLICIT' as const, from: '2026-11-19', through: '2026-11-20', sessions: ['2026-11-19', '2026-11-20'] }
    expect(ready(input, '2026-11-20', { ...profile, valuationCalendars: { etf: calendar } }).valuation.asOfDate).toBe('2026-11-20')
  })

  it('场外基金必须是官方历史净值，手动黄金每日须有确认估值', () => {
    const input = fixture()
    input.assets[1] = { ...input.assets[1], cls: 'FUND' }
    expect(buildCreatorSnapshot(profile, input, '2026-11-20', now).status).toBe('pending')
    input.prices = input.prices.map((row) => ({ ...row, source: 'EASTMONEY-FUND' }))
    expect(ready(input).pnl).toBe('20.00')
    input.assets[1] = { ...input.assets[1], cls: 'GOLD', manual: true }
    expect(buildCreatorSnapshot(profile, input, '2026-11-20', now).status).toBe('pending')
    input.transactions.push(
      tx('gold-value1', 'VALUATION', { accountId: 'broker', assetId: 'etf', assetClass: 'GOLD', amount: 100 }),
      tx('gold-value2', 'VALUATION', { accountId: 'broker', assetId: 'etf', assetClass: 'GOLD', amount: 120, occurredAt: new Date('2026-11-20T12:00:00+08:00') }),
    )
    expect(ready(input).pnl).toBe('20.00')
  })

  it('内部资金缺对手、非黄金买卖缺结算和跨日内部份额缺对手不冒充外部投入', () => {
    const at = new Date('2026-11-20T10:00:00+08:00')
    for (const extra of [
      tx('unknown-cash', 'DEPOSIT', { amount: 20, internal: true, occurredAt: at }),
      tx('unsettled-buy', 'BUY', { accountId: 'broker', assetId: 'etf', assetClass: 'ETF', quantity: 1, price: 12, amount: 12, occurredAt: at }),
      tx('internal-transfer', 'TRANSFER_OUT', { accountId: 'broker', assetId: 'etf', assetClass: 'ETF', quantity: 1, internal: true, occurredAt: at }),
    ]) {
      const input = fixture()
      input.transactions.push(extra)
      expect(buildCreatorSnapshot(profile, input, '2026-11-20', now).status).toBe('pending')
    }
  })

  it('现金子范围的外部买入按边界投入计算，分红出范围是投资收益和提款', () => {
    const input = fixture()
    const at = new Date('2026-11-20T10:00:00+08:00')
    input.transactions.push(
      tx('div', 'DIVIDEND', { accountId: 'broker', assetId: 'etf', assetClass: 'ETF', amount: 5, occurredAt: at }),
      tx('div-cash', 'DEPOSIT', { amount: 5, internal: true, settleOfId: 'div', occurredAt: at }),
    )
    expect(ready(input).pnl).toBe('25.00')
    expect(ready(input, '2026-11-20', { ...profile, accountIds: ['broker'] })).toMatchObject({ pnl: '25.00', netContribution: '-5.00', assetTotal: '120.00' })
  })
})
