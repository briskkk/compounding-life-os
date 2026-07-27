// 导出 → 导入回环：导出的 CSV 行可被导入解析器无损读回
import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { toCsv, txToCsvRecord, TX_CSV_HEADERS, type ExportTxRow } from '@/lib/export'
import { parseCsvRows, type CsvLookup } from '@/lib/csv'

const lookup: CsvLookup = {
  accountByName: new Map([['华泰证券', 'acc1']]),
  assetBySymbol: new Map([
    ['510300', 'asset1'],
    ['CASH-CNY', 'asset2'],
  ]),
}

describe('CSV 导出', () => {
  const rows: ExportTxRow[] = [
    { occurredAt: new Date('2026-01-15T10:00:00+08:00'), accountName: '华泰证券', symbol: '510300', type: 'BUY', quantity: 1000, price: 4.02, amount: 4020, fee: 1, note: '月定投' },
    { occurredAt: new Date('2026-01-10T10:00:00+08:00'), accountName: '华泰证券', symbol: 'CASH-CNY', type: 'DEPOSIT', quantity: null, price: null, amount: 30000, fee: 0, note: null },
    { occurredAt: new Date('2026-02-01T10:00:00+08:00'), accountName: '华泰证券', symbol: '510300', type: 'DIVIDEND', quantity: null, price: null, amount: 420, fee: 0, note: '含,逗号"引号"' },
  ]

  it('表头与导入模板一致，字段可回环解析', () => {
    const csv = toCsv(rows.map(txToCsvRecord), TX_CSV_HEADERS)
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
    const results = parseCsvRows(parsed.data, lookup)
    expect(results).toHaveLength(3)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results[0].tx?.type).toBe('BUY')
    expect(results[0].tx?.quantity).toBe(1000)
    expect(results[0].tx?.amount).toBe(4020)
    expect(results[1].tx?.type).toBe('DEPOSIT')
    expect(results[2].tx?.type).toBe('DIVIDEND')
    expect(results[2].tx?.note).toBe('含,逗号"引号"')
  })

  it('含特殊字符的单元格被正确转义', () => {
    const csv = toCsv([{ 日期: '2026-01-01', 备注: 'a,"b"\nc' }], ['日期', '备注'])
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true })
    expect(parsed.data[0].备注).toBe('a,"b"\nc')
  })
})
