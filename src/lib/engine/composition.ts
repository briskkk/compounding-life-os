// 组合构成聚合：把持仓市值按维度聚成切片（金额 + 占比），供持仓页构成图使用
import type { AssetClass, AssetStyle } from './types'
import { marketGroupOf, type MarketGroup } from './market-group'

export interface CompositionSlice {
  key: string
  value: number
  pct: number // 0–1；总额为 0 时全部为 0
}

export const UNCLASSIFIED_STYLE_KEY = 'UNCLASSIFIED'

/** 投资风格维度只统计可投资行情类资产（股票 / 基金 / ETF） */
export function isStyleEligibleClass(cls: AssetClass): boolean {
  return cls === 'STOCK' || cls === 'FUND' || cls === 'ETF'
}

/** 通用按键聚合：忽略非正市值，按市值降序，pct 为占总值比例 */
export function sumByKey(entries: { key: string; value: number }[]): CompositionSlice[] {
  const map = new Map<string, number>()
  let total = 0
  for (const e of entries) {
    if (e.value <= 0) continue
    map.set(e.key, (map.get(e.key) ?? 0) + e.value)
    total += e.value
  }
  return [...map.entries()]
    .map(([key, value]) => ({ key, value, pct: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value)
}

/** 按投资风格聚合；style 为 null 的资产归入「未分类」切片 */
export function groupByStyle(
  positions: { assetId: string; cls: AssetClass; value: number }[],
  assetStyles: Map<string, AssetStyle | null>,
): CompositionSlice[] {
  return sumByKey(
    positions
      .filter((p) => isStyleEligibleClass(p.cls))
      .map((p) => ({ key: assetStyles.get(p.assetId) ?? UNCLASSIFIED_STYLE_KEY, value: p.value })),
  )
}

/** 市场维度与投资风格使用同一可投资行情类资产范围。 */
export function groupByMarket(
  positions: {
    cls: AssetClass
    symbol: string
    name: string
    currency: string
    value: number
  }[],
): (CompositionSlice & { key: MarketGroup })[] {
  return sumByKey(
    positions
      .filter((position) => isStyleEligibleClass(position.cls))
      .map((position) => ({ key: marketGroupOf(position), value: position.value })),
  ) as (CompositionSlice & { key: MarketGroup })[]
}
