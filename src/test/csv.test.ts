import { describe, expect, it } from 'vitest'
import { parseCsvRows, type CsvLookup } from '@/lib/csv'

const lookup: CsvLookup = {
  accountByName: new Map([['华泰证券', 'acc1']]),
  assetBySymbol: new Map([
    ['510300', 'asset1'],
    ['CASH-CNY', 'asset2'],
  ]),
}

describe('CSV 导入解析', () => {
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
})
