// 持仓页与导出共享同一范围、跨账户合并、筛选及排序口径。
import type { AssetClass } from './types'
import type { ValuedPosition } from './valuation'
import type { PositionQuoteView } from './position-view'
import { isPortfolioAssetClass } from '../asset-classification'
import { mergePositionsByAsset } from './merge'
import { matchesTag } from './groups'
import { parseHoldingSort, sortHoldings } from './holding-sort'
import { livePreviousClose } from './portfolio-day'

export const POSITION_CLASSES: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE']

export interface PositionFilters {
  tag?: string
  cls?: string
  sort?: string
}

export function buildPositionTable(
  valued: ValuedPosition[],
  quotes: Map<string, PositionQuoteView>,
  assetTags: Map<string, string[]>,
  sp: PositionFilters = {},
  now = new Date(),
) {
  const allRows = valued
    .filter((v) => isPortfolioAssetClass(v.asset.cls) && (Math.abs(v.quantity) > 1e-9 || v.value > 0))
    .sort((a, b) => b.value - a.value)
  // 同一资产跨账户合并展示
  const mergedRows = mergePositionsByAsset(allRows)
  const activeTag = sp.tag ?? null
  const activeSort = parseHoldingSort(sp.sort)
  const classOrder = POSITION_CLASSES
  const activeClass = classOrder.includes(sp.cls as AssetClass) ? sp.cls as AssetClass : null
  // 组合权重（与表格权重列同一分母）先算出来，排序才能按权重重排
  const totalHeld = mergedRows.reduce((sum, position) => sum + position.value, 0)
  const positionRows = mergedRows.map((position) => {
    const quote = quotes.get(position.asset.symbol)
    const previousCloseCny = livePreviousClose({
      asset: { symbol: position.asset.symbol, currency: position.asset.currency, cls: position.asset.cls },
      exchangeTradingDate: quote?.tradingDate,
      prevClose: quote?.prevCloseCny,
      now,
    })
    const previousValueCny = previousCloseCny == null ? null : position.quantity * previousCloseCny
    const dayPnlCny = previousValueCny == null ? null : position.value - previousValueCny
    return {
      position,
      name: position.asset.name,
      valueCny: position.value,
      dayPnlCny,
      dayPnlPct: previousValueCny != null && previousValueCny > 0 && dayPnlCny != null
        ? dayPnlCny / previousValueCny
        : null,
      unrealizedPnlCny: position.unrealized,
      weight: totalHeld > 0 ? position.value / totalHeld : 0,
    }
  })
  const filteredRows = positionRows.filter((row) => {
    if (activeTag && !matchesTag(assetTags.get(row.position.assetId), activeTag)) return false
    if (activeClass && row.position.asset.cls !== activeClass) return false
    return true
  })
  const rows = sortHoldings(filteredRows, activeSort)

  // 每个资产涉及的账户（合并展示用）
  const accountsByAsset = new Map<string, Set<string>>()
  for (const v of allRows) {
    const set = accountsByAsset.get(v.assetId) ?? new Set<string>()
    set.add(v.accountId)
    accountsByAsset.set(v.assetId, set)
  }

  return { allRows, mergedRows, activeTag, activeSort, activeClass, totalHeld, rows, accountsByAsset }
}

export type PositionTableRow = ReturnType<typeof buildPositionTable>['rows'][number]
