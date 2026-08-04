import { describe, expect, it } from 'vitest'
import { foldTransactions, type LedgerTx } from '@/lib/engine/ledger'
import { valuePositions } from '@/lib/engine/valuation'
import { aggregate } from '@/lib/engine/metrics'
import type { AssetInfo } from '@/lib/engine/types'

const D = (s: string) => new Date(s)

const assets: AssetInfo[] = [
  { id: 'cash', symbol: 'CASH-CNY', name: '现金', cls: 'CASH', manual: false, currency: 'CNY' },
  { id: 'stock', symbol: '600519', name: '贵州茅台', cls: 'STOCK', manual: false, currency: 'CNY' },
  { id: 'house', symbol: 'HOME-01', name: '自住房产', cls: 'REAL_ESTATE', manual: true, currency: 'CNY' },
]
const assetMap = new Map(assets.map((a) => [a.id, a]))

const txs: LedgerTx[] = [
  { accountId: 'a', assetId: 'cash', type: 'DEPOSIT', quantity: null, price: null, amount: 100_000, fee: 0, occurredAt: D('2025-01-01'), assetClass: 'CASH' },
  { accountId: 'a', assetId: 'stock', type: 'BUY', quantity: 100, price: 1500, amount: 150_000, fee: 0, occurredAt: D('2025-01-02'), assetClass: 'STOCK' },
  { accountId: 'a', assetId: 'house', type: 'BUY', quantity: 1, price: 3_000_000, amount: 3_000_000, fee: 0, occurredAt: D('2025-01-03'), assetClass: 'REAL_ESTATE' },
  { accountId: 'a', assetId: 'house', type: 'VALUATION', quantity: null, price: null, amount: 3_300_000, fee: 0, occurredAt: D('2025-06-01'), assetClass: 'REAL_ESTATE' },
]

const prices: Record<string, number> = { '600519': 1600 }
const valued = valuePositions(foldTransactions(txs), assetMap, (s) => prices[s])
const metrics = aggregate(valued)

describe('双口径估值', () => {
  it('净资产 = 现金 + 股票市值 + 房产估值', () => {
    expect(metrics.netWorth).toBe(100_000 + 160_000 + 3_300_000)
  })

  it('可自由投资 = 现金 + 股票（房产除外）', () => {
    expect(metrics.investable).toBe(100_000 + 160_000)
  })

  it('房产取手动估值而非成本', () => {
    const house = valued.find((v) => v.assetId === 'house')!
    expect(house.priceSource).toBe('MANUAL')
    expect(house.value).toBe(3_300_000)
    expect(house.investable).toBe(0)
  })

  it('流动性分桶：房产计入低流动性资产', () => {
    expect(metrics.liquidity.illiquid).toBe(3_300_000)
    expect(metrics.liquidity.cash).toBe(100_000)
  })

  it('集中度取最大非现金持仓', () => {
    expect(metrics.concentration?.symbol).toBe('HOME-01')
  })

  it('集中度会跨账户合并同一资产', () => {
    const positions = foldTransactions([
      { accountId: 'a', assetId: 'stock', type: 'BUY', quantity: 40, price: 100, amount: 4000, fee: 0, occurredAt: D('2025-01-01'), assetClass: 'STOCK' },
      { accountId: 'b', assetId: 'stock', type: 'BUY', quantity: 40, price: 100, amount: 4000, fee: 0, occurredAt: D('2025-01-01'), assetClass: 'STOCK' },
      { accountId: 'a', assetId: 'house', type: 'BUY', quantity: 1, price: 6000, amount: 6000, fee: 0, occurredAt: D('2025-01-01'), assetClass: 'REAL_ESTATE' },
    ])
    const m = aggregate(valuePositions(positions, assetMap, () => 100))
    expect(m.concentration?.symbol).toBe('600519')
    expect(m.concentration?.value).toBe(8000)
  })

  it('华为股票独立归类、按手动估值计入净资产且不计入可自由投资', () => {
    const huawei = new Map<string, AssetInfo>([
      ['huawei', { id: 'huawei', symbol: 'HUAWEI-ESOP', name: '华为 ESOP', cls: 'HUAWEI_STOCK', manual: true, currency: 'CNY' }],
    ])
    const positions = foldTransactions([
      { accountId: 'a', assetId: 'huawei', type: 'BUY', quantity: 100_000, price: 8, amount: 800_000, fee: 0, occurredAt: D('2025-03-01'), assetClass: 'HUAWEI_STOCK' },
      { accountId: 'a', assetId: 'huawei', type: 'DIVIDEND', quantity: null, price: null, amount: 120_000, fee: 0, occurredAt: D('2026-01-31'), assetClass: 'HUAWEI_STOCK' },
      { accountId: 'a', assetId: 'huawei', type: 'VALUATION', quantity: null, price: null, amount: 850_000, fee: 0, occurredAt: D('2026-03-01'), assetClass: 'HUAWEI_STOCK' },
    ])
    const [position] = valuePositions(positions, huawei, () => 99)
    const result = aggregate([position])

    expect(position.priceSource).toBe('MANUAL')
    expect(position.value).toBe(850_000)
    expect(position.investable).toBe(0)
    expect(position.realizedPnl).toBe(120_000)
    expect(result.netWorth).toBe(850_000)
    expect(result.portfolioValue).toBe(0)
    expect(result.realizedPnl).toBe(0)
    expect(result.unrealizedPnl).toBe(0)
    expect(result.byClass.HUAWEI_STOCK).toBe(850_000)
    expect(result.byClass.STOCK).toBe(0)
    expect(result.liquidity.illiquid).toBe(850_000)
    expect(result.concentration).toBeNull()
  })
})

describe('多币种现金估值', () => {
  it('美元现金按汇率折人民币', () => {
    const usdAssets = new Map<string, AssetInfo>([
      ['cash-usd', { id: 'cash-usd', symbol: 'CASH-USD', name: '美元现金', cls: 'CASH', manual: false, currency: 'USD' }],
    ])
    const [pos] = foldTransactions([
      { accountId: 'hsbc', assetId: 'cash-usd', type: 'DEPOSIT', quantity: null, price: null, amount: 1000, fee: 0, occurredAt: D('2026-01-01'), assetClass: 'CASH' },
    ])
    const valued = valuePositions([pos], usdAssets, () => undefined, (cur) => (cur === 'USD' ? 6.77 : 1))
    expect(valued[0].value).toBeCloseTo(6770)
    expect(valued[0].price).toBeCloseTo(6.77)
    expect(valued[0].investable).toBeCloseTo(6770)
  })

  it('现金透支（成本钳制）不产生幻象未实现盈亏', () => {
    const usdAssets = new Map<string, AssetInfo>([
      ['cash-usd', { id: 'cash-usd', symbol: 'CASH-USD', name: '美元现金', cls: 'CASH', manual: false, currency: 'USD' }],
    ])
    const [pos] = foldTransactions([
      { accountId: 'hsbc', assetId: 'cash-usd', type: 'WITHDRAW', quantity: null, price: null, amount: 5237.3, fee: 0, occurredAt: D('2026-07-25'), assetClass: 'CASH' },
    ])
    const [v] = valuePositions([pos], usdAssets, () => undefined, (cur) => (cur === 'USD' ? 6.77 : 1))
    expect(v.value).toBeLessThan(0) // 透支市值为负（真实的现金缺口）
    expect(v.unrealized).toBe(0)
    expect(v.unrealizedPct).toBeNull()
  })
})

describe('多币种持仓盈亏（回归：外币成本必须折算后再与市值相减）', () => {
  const usdEtf = new Map<string, AssetInfo>([
    ['qqqm', { id: 'qqqm', symbol: 'USQQQM', name: '纳指ETF', cls: 'ETF', manual: false, currency: 'USD' }],
  ])
  const usdTxs: LedgerTx[] = [
    { accountId: 'hsbc', assetId: 'qqqm', type: 'BUY', quantity: 14, price: 292.187, amount: 4090.62, fee: 0, occurredAt: D('2026-07-25'), assetClass: 'ETF', currency: 'USD' },
  ]
  const rate = (cur: string) => (cur === 'USD' ? 6.77 : 1)

  it('美元 ETF 市价下跌时未实现盈亏为负（人民币口径）', () => {
    const [pos] = foldTransactions(usdTxs)
    // 行情层返回的已是折人民币价：281.68 × 6.77 ≈ 1907
    const valued = valuePositions([pos], usdEtf, () => 281.68 * 6.77, rate)
    const v = valued[0]
    expect(v.value).toBeCloseTo(14 * 1907, 0)
    expect(v.costCny).toBeCloseTo(4090.62 * 6.77, 0)
    expect(v.unrealized).toBeLessThan(0) // 实际亏损，不得显示为盈利
    expect(v.unrealized).toBeCloseTo(14 * (281.68 - 292.187) * 6.77, 0)
    expect(v.unrealizedPct).toBeCloseTo((281.68 - 292.187) / 292.187, 3)
  })

  it('无行情回落时按成本×汇率计值，盈亏为零', () => {
    const [pos] = foldTransactions(usdTxs)
    const valued = valuePositions([pos], usdEtf, () => undefined, rate)
    expect(valued[0].value).toBeCloseTo(4090.62 * 6.77, 0)
    expect(valued[0].unrealized).toBeCloseTo(0, 4)
  })

  it('混合币种汇总：已实现盈亏与未实现盈亏均为人民币口径', () => {
    const both = new Map<string, AssetInfo>([...usdEtf, ['stock', assets[1]!]])
    const txs: LedgerTx[] = [
      ...usdTxs,
      { accountId: 'a', assetId: 'stock', type: 'BUY', quantity: 100, price: 1500, amount: 150000, fee: 0, occurredAt: D('2026-01-01'), assetClass: 'STOCK' },
      { accountId: 'a', assetId: 'stock', type: 'SELL', quantity: 50, price: 1600, amount: 80000, fee: 0, occurredAt: D('2026-02-01'), assetClass: 'STOCK' },
    ]
    const valued = valuePositions(foldTransactions(txs), both, (s) => (s === '600519' ? 1600 : 281.68 * 6.77), rate)
    const m = aggregate(valued)
    // A 股卖出已实现 50×(1600−1500)=5000（人民币资产汇率 1）
    expect(m.realizedPnl).toBeCloseTo(5000, 1)
    // 未实现 = A 股 50×(1600−1500) + QQQM 浮亏
    expect(m.unrealizedPnl).toBeLessThan(5000 + 0) // QQQM 亏损拉低
  })
})
