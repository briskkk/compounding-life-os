import { describe, expect, it } from 'vitest'
import { groupByStyle, isStyleEligibleClass, sumByKey, UNCLASSIFIED_STYLE_KEY } from '@/lib/engine/composition'
import type { AssetStyle } from '@/lib/engine/types'

describe('组合构成聚合', () => {
  it('sumByKey 合并同键、按市值降序、占比合计 100%', () => {
    const slices = sumByKey([
      { key: 'A', value: 100 },
      { key: 'B', value: 300 },
      { key: 'A', value: 100 },
    ])
    expect(slices.map((s) => s.key)).toEqual(['B', 'A'])
    expect(slices.find((s) => s.key === 'A')!.value).toBe(200)
    expect(slices.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(1)
  })

  it('sumByKey 忽略非正市值；空输入返回空数组', () => {
    expect(sumByKey([{ key: 'A', value: 0 }, { key: 'B', value: -5 }])).toEqual([])
    expect(sumByKey([])).toEqual([])
  })

  it('投资风格维度只统计股票/基金/ETF，排除现金、黄金、房产等', () => {
    expect(isStyleEligibleClass('STOCK')).toBe(true)
    expect(isStyleEligibleClass('FUND')).toBe(true)
    expect(isStyleEligibleClass('ETF')).toBe(true)
    expect(isStyleEligibleClass('CASH')).toBe(false)
    expect(isStyleEligibleClass('GOLD')).toBe(false)
    expect(isStyleEligibleClass('REAL_ESTATE')).toBe(false)
    expect(isStyleEligibleClass('HUAWEI_STOCK')).toBe(false)

    const styles = new Map<string, AssetStyle | null>([['f1', 'GROWTH']])
    const slices = groupByStyle(
      [
        { assetId: 'f1', cls: 'FUND', value: 100 },
        { assetId: 'c1', cls: 'CASH', value: 900 },
        { assetId: 'g1', cls: 'GOLD', value: 900 },
      ],
      styles,
    )
    expect(slices).toEqual([{ key: 'GROWTH', value: 100, pct: 1 }])
  })

  it('style 为 null 的资产归入「未分类」切片', () => {
    const styles = new Map<string, AssetStyle | null>([
      ['e1', 'BROAD_INDEX'],
      ['e2', null],
      // e3 无记录
    ])
    const slices = groupByStyle(
      [
        { assetId: 'e1', cls: 'ETF', value: 250 },
        { assetId: 'e2', cls: 'ETF', value: 150 },
        { assetId: 'e3', cls: 'STOCK', value: 100 },
      ],
      styles,
    )
    expect(slices.map((s) => s.key)).toEqual(['BROAD_INDEX', UNCLASSIFIED_STYLE_KEY])
    expect(slices[1].value).toBe(250)
    expect(slices[1].pct).toBeCloseTo(0.5)
  })

  it('空持仓返回空切片数组', () => {
    expect(groupByStyle([], new Map())).toEqual([])
  })
})
