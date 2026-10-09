import { describe, expect, it } from 'vitest'
import { applyCsvMapping, csvDuplicateKeys, parseCsvRows, parsedTxKey, suggestCsvMapping, type CsvLookup } from '@/lib/csv'

const lookup: CsvLookup = {
  accountByName: new Map([['华泰证券', 'acc1']]),
  assetBySymbol: new Map([
    ['510300', 'asset1'],
    ['CASH-CNY', 'asset2'],
  ]),
}

describe('CSV 导入解析', () => {
  it('A股日期导入默认北京时间10点，明确成交时间保留；识别旧版日期占位时间', () => {
    const withInfo = { ...lookup, assetInfoById: new Map([['asset1', { symbol: '510300', cls: 'ETF' }]]) }
    const raw = { 日期: '2026-10-09', 账户: '华泰证券', 代码: '510300', 类型: '买入', 数量: '100', 单价: '1' }
    const [dateOnly, explicit] = parseCsvRows([raw, { ...raw, 时间: '11:23:45' }], withInfo)
    expect(dateOnly.tx?.occurredAt.toISOString()).toBe('2026-10-09T02:00:00.000Z')
    expect(explicit.tx?.occurredAt.toISOString()).toBe('2026-10-09T03:23:45.000Z')
    const keys = csvDuplicateKeys(dateOnly, withInfo)
    expect(keys).toContain(parsedTxKey({ ...dateOnly.tx!, occurredAt: new Date('2026-10-09T08:00:00+08:00') }))
    expect(keys).toContain(parsedTxKey({ ...dateOnly.tx!, occurredAt: new Date('2026-10-09T12:00:00+08:00') }))
    expect(csvDuplicateKeys(explicit, withInfo)).toEqual([parsedTxKey(explicit.tx!)])
  })

  it('场内LOF采用10点，场外基金不受A股默认时间影响', () => {
    const raw = { 日期: '2026-10-09', 账户: '华泰证券', 代码: '161128', 类型: '买入', 数量: '100', 单价: '1' }
    const lofLookup = { ...lookup, assetBySymbol: new Map([['161128', 'lof']]), assetInfoById: new Map([['lof', { symbol: '161128', cls: 'ETF' }]]) }
    expect(parseCsvRows([raw], lofLookup)[0].tx?.occurredAt.toISOString()).toBe('2026-10-09T02:00:00.000Z')
    const fundLookup = { ...lofLookup, assetInfoById: new Map([['lof', { symbol: '161128', cls: 'FUND' }]]) }
    expect(parseCsvRows([raw], fundLookup)[0].tx?.occurredAt.toISOString()).toBe(new Date(raw.日期).toISOString())
  })
  it('标准行解析成功（买入缺省金额 = 量×价）', () => {
    const [r] = parseCsvRows(
      [{ 日期: '2026-01-15', 账户: '华泰证券', 代码: '510300', 类型: '买入', 数量: '1000', 单价: '4.02', 费用: '0' }],
      lookup,
    )
    expect(r.ok).toBe(true)
    expect(r.tx?.amount).toBeCloseTo(4020)
    expect(r.tx?.type).toBe('BUY')
  })

  it('中文类型别名：存入 / 估值；归属已停用', () => {
    const rows = parseCsvRows(
      [
        { 日期: '2026-01-15', 账户: '华泰证券', 代码: 'CASH-CNY', 类型: '存入', 金额: '30000' },
        { 日期: '2026-01-15', 账户: '华泰证券', 代码: '510300', 类型: '估值', 金额: '1000' },
        { 日期: '2026-01-15', 账户: '华泰证券', 代码: '510300', 类型: '归属', 数量: '300', 金额: '0' },
      ],
      lookup,
    )
    expect(rows.slice(0, 2).map((r) => r.tx?.type)).toEqual(['DEPOSIT', 'VALUATION'])
    expect(rows.slice(0, 2).every((r) => r.ok)).toBe(true)
    expect(rows[2].ok).toBe(false)
    expect(rows[2].errors.join()).toContain('类型无法识别')
  })

  it('金额带 ¥ 与千分位也可解析', () => {
    const [r] = parseCsvRows(
      [{ 日期: '2026-01-15', 账户: '华泰证券', 代码: 'CASH-CNY', 类型: '存入', 金额: '¥1,234,500' }],
      lookup,
    )
    expect(r.ok).toBe(true)
    expect(r.tx?.amount).toBe(1234500)
  })

  it('错误行收集原因：未知账户 / 未知资产 / 坏日期 / 缺数量', () => {
    const rows = parseCsvRows(
      [
        { 日期: '2026-01-15', 账户: '不存在', 代码: '510300', 类型: '买入', 数量: '1', 单价: '1' },
        { 日期: '2026-01-15', 账户: '华泰证券', 代码: 'XXXX', 类型: '买入', 数量: '1', 单价: '1' },
        { 日期: 'not-a-date', 账户: '华泰证券', 代码: '510300', 类型: '买入', 数量: '1', 单价: '1' },
        { 日期: '2026-01-15', 账户: '华泰证券', 代码: '510300', 类型: '买入', 单价: '1' },
      ],
      lookup,
    )
    expect(rows[0].errors.join()).toContain('账户不存在')
    expect(rows[1].errors.join()).toContain('资产代码不存在')
    expect(rows[2].errors.join()).toContain('日期')
    expect(rows[3].errors.join()).toContain('数量')
  })

  it('英文表头与类型亦可识别', () => {
    const [r] = parseCsvRows(
      [{ date: '2026-01-15', account: '华泰证券', symbol: '510300', type: 'buy', quantity: '10', price: '4', amount: '40' }],
      lookup,
    )
    expect(r.ok).toBe(true)
    expect(r.tx?.type).toBe('BUY')
  })

  it('自定义券商列可手动映射后进入统一预检', () => {
    const source = [{ 成交日期: '2026-01-15', 资金账号: '华泰证券', 标的: '510300', 买卖: '买入', 成交数量: '10', 成交价格: '4' }]
    const mapped = applyCsvMapping(source, {
      date: '成交日期',
      account: '资金账号',
      symbol: '标的',
      type: '买卖',
      quantity: '成交数量',
      price: '成交价格',
    })
    const [result] = parseCsvRows(mapped, lookup)
    expect(result.ok).toBe(true)
    expect(result.tx?.amount).toBe(40)
  })

  it('标准别名自动生成字段映射，逐行指纹忽略备注差异', () => {
    expect(suggestCsvMapping(['日期', '证券代码', '方向', '成交额'])).toMatchObject({
      date: '日期',
      symbol: '证券代码',
      type: '方向',
    })
    const [a, b] = parseCsvRows([
      { 日期: '2026-01-15', 账户: '华泰证券', 代码: '510300', 类型: '买入', 数量: '10', 单价: '4', 备注: '第一次导入' },
      { 日期: '2026-01-15', 账户: '华泰证券', 代码: '510300', 类型: '买入', 数量: '10', 单价: '4', 备注: '另一份文件' },
    ], lookup)
    expect(parsedTxKey(a.tx!)).toBe(parsedTxKey(b.tx!))
  })

  it('常见券商导出表头可自动映射', () => {
    expect(suggestCsvMapping(['交易日期', '账户名称', '基金代码', '交易类型', '成交金额', '交易费用'])).toEqual({
      date: '交易日期',
      account: '账户名称',
      symbol: '基金代码',
      type: '交易类型',
      amount: '成交金额',
      fee: '交易费用',
    })
  })
})
