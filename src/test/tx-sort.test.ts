import { describe, expect, it } from 'vitest'
import { DEFAULT_TX_SORT, TX_SORT_OPTIONS, parseTxSort, txAriaSort } from '@/lib/engine/tx-sort'

describe('交易流水排序', () => {
  it('非法或缺省参数回落到日期倒序', () => {
    expect(parseTxSort(undefined)).toBe(DEFAULT_TX_SORT)
    expect(parseTxSort('')).toBe(DEFAULT_TX_SORT)
    expect(parseTxSort('amount-desc')).toBe(DEFAULT_TX_SORT)
    expect(parseTxSort('date-desc')).toBe(DEFAULT_TX_SORT)
  })

  it('只接受登记过的排序值', () => {
    for (const option of TX_SORT_OPTIONS) expect(parseTxSort(option.value)).toBe(option.value)
  })

  it('aria-sort 与当前排序一致，且只有一个列头是升/降序', () => {
    expect(txAriaSort('date-asc', 'date')).toBe('ascending')
    expect(txAriaSort('date-desc', 'date')).toBe('descending')
    expect(txAriaSort('navDate-desc', 'date')).toBe('other')
    expect(txAriaSort('navDate-desc', 'navDate')).toBe('descending')
    expect(txAriaSort('navDate-asc', 'navDate')).toBe('ascending')
    expect(txAriaSort('date-desc', 'navDate')).toBe('other')
  })
})
