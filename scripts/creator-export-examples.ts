// Synthetic plugin integration examples. No database, network or private config access.
import { writeFileSync } from 'node:fs'
import { creatorProfileSchema } from '../src/lib/creator-export-contract'
import { buildCreatorSnapshot, type CreatorSource } from '../src/lib/engine/creator-snapshot'

const profile = creatorProfileSchema.parse({
  slug: 'demo', enabled: true, familyId: 'fictional-family', authorizedByUserId: 'fictional-owner',
  accountIds: ['fictional-bank'], scope: 'INVESTABLE', accountScopeLabel: '可投资资产',
  startDate: '2026-11-19', cutoffTime: '23:59:59', calendar: { kind: 'CN_FUND' },
  operationLabels: { etf: '宽基ETF' },
  publicFields: ['assetTotal', 'pnl', 'netContribution', 'operations'], tokenHashes: ['0'.repeat(64)],
})
const source: CreatorSource = {
  assets: [
    { id: 'cash', symbol: 'CASH-CNY', name: '虚构现金', cls: 'CASH', currency: 'CNY', manual: false },
    { id: 'etf', symbol: '510300', name: '虚构ETF', cls: 'ETF', currency: 'CNY', manual: false },
  ],
  transactions: [
    { id: 'cash-in', accountId: 'fictional-bank', assetId: 'cash', assetClass: 'CASH', type: 'DEPOSIT', quantity: null, price: null, amount: 1000.12, fee: 0, occurredAt: new Date('2026-11-19T10:00:00+08:00') },
    { id: 'buy', accountId: 'fictional-bank', assetId: 'etf', assetClass: 'ETF', type: 'BUY', quantity: 10, price: 10, amount: 100, fee: 1, occurredAt: new Date('2026-11-19T10:00:00+08:00') },
    { id: 'buy-cash', accountId: 'fictional-bank', assetId: 'cash', assetClass: 'CASH', type: 'WITHDRAW', quantity: null, price: null, amount: 101, fee: 0, occurredAt: new Date('2026-11-19T10:00:00+08:00'), internal: true, settleOfId: 'buy' },
  ],
  prices: [
    { symbol: '510300', date: '2026-11-19', close: 10, source: 'TENCENT' },
    { symbol: '510300', date: '2026-11-20', close: 12, source: 'TENCENT' },
  ], rates: [],
}
const now = new Date('2026-11-28T12:00:00+08:00')
const baseline = buildCreatorSnapshot(profile, source, '2026-11-19', now)
const daily = buildCreatorSnapshot(profile, source, '2026-11-20', now)
const dailyWithOperations = buildCreatorSnapshot(profile, {
  ...source, transactions: [...source.transactions,
    { id: 'buy2', accountId: 'fictional-bank', assetId: 'etf', assetClass: 'ETF', type: 'BUY', quantity: 2, price: 12, amount: 24, fee: 0.12, occurredAt: new Date('2026-11-20T10:00:00+08:00') },
    { id: 'buy2-cash', accountId: 'fictional-bank', assetId: 'cash', assetClass: 'CASH', type: 'WITHDRAW', quantity: null, price: null, amount: 24.12, fee: 0, occurredAt: new Date('2026-11-20T10:00:00+08:00'), internal: true, settleOfId: 'buy2' },
  ],
}, '2026-11-20', now)
const pending = buildCreatorSnapshot(profile, source, '2026-11-23', now)
const noSession = buildCreatorSnapshot(profile, source, '2026-11-21', now)
const corrected = buildCreatorSnapshot(profile, {
  ...source, prices: source.prices.map((price) => ({ ...price, close: price.date === '2026-11-20' ? 12.1 : price.close })),
}, '2026-11-20', now)
writeFileSync('docs/creator-daily-snapshots.examples.json', `${JSON.stringify({
  synthetic: true,
  baseline,
  daily,
  dailyWithOperations,
  noOperations: daily,
  historicalReplay: buildCreatorSnapshot(profile, source, '2026-11-20', new Date('2026-12-01T00:00:00Z')),
  pending,
  noSession,
  corrected,
}, null, 2)}\n`)
