import type { AssetClass, AssetStyle } from './types'
import { ASSET_CLASS_LABEL, ASSET_STYLE_LABEL } from '../labels'
import { marketGroupLabel, marketGroupOf } from './market-group'
import { parseTags } from './groups'
import { strategyName } from './strategy-allocation'

export interface ScopeAsset {
  cls: AssetClass
  style: AssetStyle | null
  symbol: string
  name: string
  currency: string
  strategyGroup: string
  tags: string
}

export interface PerformanceScope {
  key: string
  label: string
  matches: (asset: ScopeAsset) => boolean
}

export function performanceScopes(assets: ScopeAsset[]): PerformanceScope[] {
  const classes = [...new Set(assets.map((asset) => asset.cls))]
  const styles = [...new Set(assets.map((asset) => asset.style).filter((style): style is AssetStyle => style != null))]
  const markets = [...new Set(assets.filter((asset) => ['STOCK', 'FUND', 'ETF'].includes(asset.cls)).map(marketGroupOf))]
  const strategies = [...new Set(assets.map((asset) => strategyName(asset.strategyGroup)))]
  const tags = [...new Set(assets.flatMap((asset) => parseTags(asset.tags)))]
  return [
    { key: 'all', label: '全部可投资资产', matches: () => true },
    ...classes.map((cls) => ({ key: `class:${cls}`, label: `大类 · ${ASSET_CLASS_LABEL[cls]}`, matches: (asset: ScopeAsset) => asset.cls === cls })),
    ...styles.map((style) => ({ key: `style:${style}`, label: `风格 · ${ASSET_STYLE_LABEL[style]}`, matches: (asset: ScopeAsset) => asset.style === style })),
    ...markets.map((market) => ({ key: `market:${market}`, label: `市场 · ${marketGroupLabel(market)}`, matches: (asset: ScopeAsset) => ['STOCK', 'FUND', 'ETF'].includes(asset.cls) && marketGroupOf(asset) === market })),
    ...strategies.map((name) => ({ key: `strategy:${name}`, label: `组合 · ${name}`, matches: (asset: ScopeAsset) => strategyName(asset.strategyGroup) === name })),
    ...tags.map((tag) => ({ key: `tag:${tag}`, label: `标签 · ${tag}`, matches: (asset: ScopeAsset) => parseTags(asset.tags).includes(tag) })),
  ]
}

export function resolvePerformanceScope(scopes: PerformanceScope[], key: string | null | undefined): PerformanceScope {
  return scopes.find((scope) => scope.key === key) ?? scopes[0]
}

/** 组合分组描述当前组合；其他维度仍可回看已清仓资产的历史表现。 */
export function filterActiveStrategyScopes<T extends ScopeAsset & { id: string }>(
  scopes: PerformanceScope[],
  assets: T[],
  heldIds: ReadonlySet<string>,
): PerformanceScope[] {
  const active = new Set(assets
    .filter((asset) => heldIds.has(asset.id))
    .map((asset) => `strategy:${strategyName(asset.strategyGroup)}`))
  return scopes.filter((scope) => !scope.key.startsWith('strategy:') || active.has(scope.key))
}

export function assetsForPerformanceScope<T extends ScopeAsset & { id: string }>(
  assets: T[],
  scope: PerformanceScope,
  heldIds: ReadonlySet<string>,
): T[] {
  const activeOnly = scope.key.startsWith('strategy:')
  return assets.filter((asset) => scope.matches(asset) && (!activeOnly || heldIds.has(asset.id)))
}
