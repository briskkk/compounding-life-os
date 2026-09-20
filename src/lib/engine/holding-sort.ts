export type HoldingSort =
  | 'value-desc'
  | 'value-asc'
  | 'dayPnl-desc'
  | 'dayPnl-asc'
  | 'changePct-desc'
  | 'changePct-asc'
  | 'unrealizedPnl-desc'
  | 'unrealizedPnl-asc'
  | 'weight-desc'
  | 'weight-asc'
  | 'name-asc'

export type HoldingSortKey = 'name' | 'value' | 'changePct' | 'dayPnl' | 'unrealizedPnl' | 'weight'

export interface SortableHolding {
  name: string
  valueCny: number
  dayPnlCny: number | null
  /** 当日涨跌幅（小数）。缺失（无行情/无昨收）时该行始终沉底。 */
  changePct?: number | null
  /** 未实现盈亏（人民币）。持仓页用。 */
  unrealizedPnlCny?: number | null
  /** 组合权重（小数）。持仓页用。 */
  weight?: number | null
}

export const DEFAULT_HOLDING_SORT: HoldingSort = 'value-desc'

const HOLDING_SORTS: HoldingSort[] = [
  'value-desc',
  'value-asc',
  'dayPnl-desc',
  'dayPnl-asc',
  'changePct-desc',
  'changePct-asc',
  'unrealizedPnl-desc',
  'unrealizedPnl-asc',
  'weight-desc',
  'weight-asc',
  'name-asc',
]

export function parseHoldingSort(value: string | undefined): HoldingSort {
  return value != null && (HOLDING_SORTS as string[]).includes(value)
    ? value as HoldingSort
    : DEFAULT_HOLDING_SORT
}

const SORT_KEYS: Record<HoldingSort, HoldingSortKey> = {
  'value-desc': 'value',
  'value-asc': 'value',
  'dayPnl-desc': 'dayPnl',
  'dayPnl-asc': 'dayPnl',
  'changePct-desc': 'changePct',
  'changePct-asc': 'changePct',
  'unrealizedPnl-desc': 'unrealizedPnl',
  'unrealizedPnl-asc': 'unrealizedPnl',
  'weight-desc': 'weight',
  'weight-asc': 'weight',
  'name-asc': 'name',
}

/** 排序作用的列，用于列头 aria-sort 与方向箭头。 */
export function holdingSortKey(sort: HoldingSort): HoldingSortKey {
  return SORT_KEYS[sort]
}

export function holdingSortDescending(sort: HoldingSort): boolean {
  return sort.endsWith('-desc')
}

/** 点击列头：同列反向，换列则从大到小开始。 */
export function toggleHoldingSort(sort: HoldingSort, key: HoldingSortKey): HoldingSort {
  if (key === 'name') return 'name-asc'
  if (holdingSortKey(sort) !== key) return `${key}-desc` as HoldingSort
  return (holdingSortDescending(sort) ? `${key}-asc` : `${key}-desc`) as HoldingSort
}

export function holdingAriaSort(sort: HoldingSort, key: HoldingSortKey): 'ascending' | 'descending' | 'none' {
  if (holdingSortKey(sort) !== key) return 'none'
  // 名称列只有升序一档，口径不随 aria 变化
  if (key === 'name') return 'ascending'
  return holdingSortDescending(sort) ? 'descending' : 'ascending'
}

/** 列头文案，也是该列排序控件的唯一文案来源（含单位，与表格列名一致）。 */
export const HOLDING_SORT_HEADERS: Record<HoldingSortKey, string> = {
  name: '资产',
  value: '市值（¥）',
  changePct: '涨跌幅',
  dayPnl: '当日盈亏（¥）',
  unrealizedPnl: '未实现盈亏',
  weight: '权重',
}

/** 名称列的无障碍名用「名称」而不是列头上的「资产」，说清排序依据是名称。 */
const SORT_TITLE_LABELS: Record<HoldingSortKey, string> = {
  ...HOLDING_SORT_HEADERS,
  name: '名称',
}

/**
 * 列头排序按钮的标题/无障碍名：说明**当前**排序状态，点下去则切到相反方向。
 * 之所以描述现状而不是下一步：按钮的无障碍名会随状态变化，描述现状读起来才不会有歧义
 * （「升序」在同一个控件上同时意味着两件事时，读屏与测试都会读错）。
 */
export function holdingSortTitle(sort: HoldingSort, key: HoldingSortKey): string {
  const label = SORT_TITLE_LABELS[key]
  if (holdingSortKey(sort) !== key || key === 'name') return `按${label}排序`
  return holdingSortDescending(sort) ? `按${label}降序排序` : `按${label}升序排序`
}

function compareName(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN')
}

/** 缺失值恒沉底：升降序都不改变「没有当日数据」这一点。 */
function compareNullLast(direction: number, a: number | null | undefined, b: number | null | undefined, tie: () => number): number {
  if (a == null && b == null) return tie()
  if (a == null) return 1
  if (b == null) return -1
  // 主键相等时用名称兜底，保证同一份数据每次渲染顺序一致（避免轮询改价时抖动）
  return direction * (a - b) || tie()
}

export function sortHoldings<T extends SortableHolding>(rows: T[], sort: HoldingSort): T[] {
  const direction = holdingSortDescending(sort) ? -1 : 1
  const tieByName = (a: T, b: T) => compareName(a.name, b.name)
  const compare = (a: T, b: T): number => {
    if (sort === 'name-asc') return compareName(a.name, b.name)
    if (holdingSortKey(sort) === 'value') {
      // 市值几乎不可能相等，但相等时同样按名称兜底
      return direction * (a.valueCny - b.valueCny) || tieByName(a, b)
    }
    if (holdingSortKey(sort) === 'changePct') {
      return compareNullLast(direction, a.changePct, b.changePct, () => tieByName(a, b))
    }
    if (holdingSortKey(sort) === 'unrealizedPnl') {
      // 未实现盈亏与权重同向：盈亏大的权重也大，用市值兜底更符合读表习惯
      return compareNullLast(direction, a.unrealizedPnlCny, b.unrealizedPnlCny, () => direction * (a.valueCny - b.valueCny) || tieByName(a, b))
    }
    if (holdingSortKey(sort) === 'weight') {
      return compareNullLast(direction, a.weight, b.weight, () => direction * (a.valueCny - b.valueCny) || tieByName(a, b))
    }
    return compareNullLast(direction, a.dayPnlCny, b.dayPnlCny, () => direction * (a.valueCny - b.valueCny) || tieByName(a, b))
  }
  return [...rows].sort(compare)
}
