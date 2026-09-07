// 自定义分组：按资产标签聚合持仓（一个资产可属于多个分组，分别计入）
import type { ValuedPosition } from './valuation'

export interface TagGroup {
  tag: string
  value: number
  costCny: number
  unrealized: number
  unrealizedPct: number | null
  realizedCny: number
  investable: number
  count: number // 持仓行数
}

export const UNTAGGED = '未分组'

/** "美元基金, 长期" → ["美元基金", "长期"]（去重、去空） */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
}

/** 筛选与聚合共用未分组语义；兼容同名显式标签。 */
export function matchesTag(tags: string[] | undefined, tag: string): boolean {
  return (tags?.length ? tags : [UNTAGGED]).includes(tag)
}

/** 标签数组 → 规范存储串（去重、逗号分隔） */
export function serializeTags(tags: string[]): string {
  return [...new Set(tags.map((s) => s.trim()).filter(Boolean))].join(',')
}

/** 按标签聚合；assetTags: assetId → 标签数组；无标签资产归入「未分组」 */
export function groupByTag(valued: ValuedPosition[], assetTags: Map<string, string[]>): TagGroup[] {
  const map = new Map<string, TagGroup>()
  const touch = (tag: string): TagGroup => {
    let g = map.get(tag)
    if (!g) {
      g = { tag, value: 0, costCny: 0, unrealized: 0, unrealizedPct: null, realizedCny: 0, investable: 0, count: 0 }
      map.set(tag, g)
    }
    return g
  }
  for (const p of valued) {
    const tags = assetTags.get(p.assetId)
    const buckets = tags && tags.length > 0 ? tags : [UNTAGGED]
    for (const tag of buckets) {
      const g = touch(tag)
      g.value += p.value
      g.costCny += p.costCny
      g.unrealized += p.unrealized
      g.realizedCny += p.realizedCny
      g.investable += p.investable
      g.count += 1
    }
  }
  for (const g of map.values()) {
    g.unrealizedPct = g.costCny > 0 ? g.unrealized / g.costCny : null
  }
  return [...map.values()].sort((a, b) => b.value - a.value)
}
