// 看盘筛选状态的取值与 URL 解析。
//
// 放在纯引擎模块里而不是组件文件里：`'use client'` 模块的导出在服务端会编译成客户端引用，
// 服务端组件直接调用会报 "Attempted to call … from the server but … is on the client"。
import type { AssetClass } from '@prisma/client'
import { parseHoldingSort, type HoldingSort } from './holding-sort'

export function parseWatchSort(value: string | undefined): HoldingSort {
  const sort = parseHoldingSort(value)
  if (sort === 'weight-asc') return 'value-asc'
  if (sort === 'weight-desc') return 'value-desc'
  if (sort === 'changePct-asc' || sort === 'changePct-desc') return 'value-desc'
  return sort
}

/** 筛选条只在看盘会出现的大类上提供 chip；其余大类（现金/房产）归入「其他」。 */
export const WATCH_FILTER_CLASSES: AssetClass[] = ['STOCK', 'ETF', 'FUND', 'GOLD']
export const WATCH_OTHER_CLASS = 'OTHER'

export type WatchClassFilter = AssetClass | typeof WATCH_OTHER_CLASS | null

export interface WatchFilterValue {
  query: string
  classFilter: WatchClassFilter
  onlyExcluded: boolean
}

/** 只接受登记过的筛选取值，非法参数按「不筛选」处理（与 sort 的回落口径一致）。 */
export function parseWatchClassFilter(value: string | null | undefined): WatchClassFilter {
  if (value == null) return null
  if (value === WATCH_OTHER_CLASS) return WATCH_OTHER_CLASS
  return WATCH_FILTER_CLASSES.includes(value as AssetClass) ? value as AssetClass : null
}
