import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { emptyPosition, foldTransactions } from '@/lib/engine/ledger'
import type { AssetInfo } from '@/lib/engine/types'
import { valuePositions } from '@/lib/engine/valuation'
import { buildPositionTable } from '@/lib/engine/position-table'
import { positionToCsvRecord, POSITION_CSV_HEADERS } from '@/lib/position-export'
import { toCsv } from '@/lib/export'

const now = new Date('2026-10-08T07:00:00Z')
const stock: AssetInfo = { id: 'stock', symbol: 'usAAPL', name: '苹果', cls: 'STOCK', currency: 'USD', manual: false }
const cash: AssetInfo = { id: 'cash', symbol: 'CASH-CNY', name: '现金', cls: 'CASH', currency: 'CNY', manual: false }
const fund: AssetInfo = { id: 'fund', symbol: '110022', name: '基金', cls: 'FUND', currency: 'CNY', manual: false }

describe('持仓明细导出', () => {
  it('合并账户，排除已清仓和长期员工持股，筛选后保留全组合权重', () => {
    const longTerm: AssetInfo = { ...stock, id: 'long', cls: 'HUAWEI_STOCK' }
    const assets = new Map([stock, cash, fund, longTerm].map((a) => [a.id, a]))
    const positions = [
      { ...emptyPosition('a', 'stock'), quantity: 2, availableQty: 2, costBasis: 20 },
      { ...emptyPosition('b', 'stock'), quantity: 3, availableQty: 3, costBasis: 30 },
      { ...emptyPosition('a', 'cash'), quantity: 350, availableQty: 350, costBasis: 350 },
      { ...emptyPosition('a', 'long'), quantity: 100, costBasis: 100 },
      emptyPosition('a', 'fund'),
    ]
    const valued = valuePositions(positions, assets, () => undefined, (currency) => currency === 'USD' ? 7 : 1)
    const tags = new Map([['stock', ['长期']]])
    const table = buildPositionTable(valued, new Map(), tags, { cls: 'STOCK', tag: '长期' }, now)
    expect(table.mergedRows).toHaveLength(2)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0].weight).toBe(0.5)
    expect([...table.accountsByAsset.get('stock')!]).toEqual(['b', 'a'])
    const record = positionToCsvRecord(table.rows[0], { accounts: ['B', 'A'], tags: ['长期'], exportedAt: now })
    expect(record).toMatchObject({ 数量: '5', '成本(CNY)': '350', '估值单价(CNY)': '70', '市值(CNY)': '350', '当日盈亏(CNY)': '', '当日涨跌幅(%)': '', '占全部持仓权重(%)': '50', 估值来源: '成本回退', 报价时间: '' })
    expect(buildPositionTable(valued, new Map(), tags, { tag: '未分组' }).rows.map((r) => r.position.assetId)).toEqual(['cash'])
  })

  it('份额未知的申购不生成持仓，已知但未确认的份额保留可用数量', () => {
    const positions = foldTransactions([
      { accountId: 'a', assetId: 'fund', type: 'BUY', amount: 100, fee: 0, quantity: null, price: null, navSource: 'PENDING', occurredAt: now },
      { accountId: 'a', assetId: 'stock', type: 'BUY', amount: 20, fee: 0, quantity: 2, price: 10, occurredAt: now, confirmationDate: new Date('2099-01-01') },
    ])
    const valued = valuePositions(positions, new Map([stock, fund].map((a) => [a.id, a])), () => undefined)
    const { rows } = buildPositionTable(valued, new Map(), new Map(), {}, now)
    expect(rows).toHaveLength(1)
    expect(positionToCsvRecord(rows[0], { accounts: ['A'], tags: [], exportedAt: now })).toMatchObject({ 数量: '2', 可用数量: '0', 确认中数量: '2' })
  })

  it('排序、行情日期与当日盈亏缺口沿用页面，CSV 保留中文、特殊字符及负数', () => {
    const valued = valuePositions([
      { ...emptyPosition('a', 'stock'), quantity: 2, availableQty: 2, costBasis: 100 },
      { ...emptyPosition('a', 'fund'), quantity: 20, availableQty: 20, costBasis: 30 },
    ], new Map([stock, fund].map((a) => [a.id, a])), () => 10)
    const quote = { priceCny: 10, prevCloseCny: 9, tradingDate: '2026-10-06', source: 'PERSISTED:TENCENT', asOf: '2026-10-06T20:00:00Z' }
    const { rows } = buildPositionTable(valued, new Map([[stock.symbol, quote]]), new Map(), { sort: 'value-asc' }, now)
    expect(rows.map((r) => r.position.assetId)).toEqual(['stock', 'fund'])
    const record = positionToCsvRecord(rows[0], { accounts: ['账户,"一"\n二'], tags: ['=1+1'], quote, exportedAt: now })
    expect(record).toMatchObject({ '未实现盈亏(CNY)': '-80', '当日盈亏(CNY)': '', 估值来源: '历史收盘', 行情交易日: '2026-10-06', 报价时间: quote.asOf, 标签: "'=1+1" })
    const csv = toCsv([record], POSITION_CSV_HEADERS)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data).toEqual([record])
    expect(toCsv([], POSITION_CSV_HEADERS)).toBe('\uFEFF' + POSITION_CSV_HEADERS.join(',') + '\r\n')
  })
})
