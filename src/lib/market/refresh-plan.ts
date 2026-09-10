import type { AssetInfo } from '../engine/types'
import { foldTransactions, type LedgerTx } from '../engine/ledger'
import { BENCHMARK_INDICES } from '../engine/benchmark'
import { marketGroupOf } from '../engine/market-group'

export type RefreshSlot = 'manual' | 'us-close' | 'cn-close' | 'fund-nav' | 'full'

export interface MarketRefreshPlan {
  slot: RefreshSlot
  assets: AssetInfo[]
  fundSymbols: string[]
  marketSymbols: string[]
  hasForeignCurrency: boolean
}

export function refreshSlotOf(value: string | null | undefined, fallback: RefreshSlot = 'manual'): RefreshSlot {
  return ['manual', 'us-close', 'cn-close', 'fund-nav', 'full'].includes(value ?? '')
    ? value as RefreshSlot
    : fallback
}

export function activeAssetIdsFromLedger(txs: LedgerTx[]): Set<string> {
  return new Set(
    foldTransactions(txs)
      .filter((position) => Math.abs(position.quantity) > 1e-9)
      .map((position) => position.assetId),
  )
}

export function buildMarketRefreshPlan(
  assets: AssetInfo[],
  activeAssetIds: Set<string>,
  slot: RefreshSlot,
): MarketRefreshPlan {
  const eligible = assets.filter((asset) => (
    !asset.manual
    && asset.cls !== 'CASH'
    && asset.cls !== 'REAL_ESTATE'
    && (slot === 'full' || activeAssetIds.has(asset.id))
  ))
  const selected = eligible.filter((asset) => {
    if (slot === 'fund-nav') return asset.cls === 'FUND'
    if (slot === 'us-close') return asset.cls !== 'FUND' && marketGroupOf(asset) === 'OFFSHORE'
    if (slot === 'cn-close') return asset.cls !== 'FUND' && marketGroupOf(asset) === 'DOMESTIC'
    return true
  })
  const fundSymbols = [...new Set(selected.filter((asset) => asset.cls === 'FUND').map((asset) => asset.symbol))]
  const includeDomesticBenchmarks = slot === 'manual' || slot === 'cn-close' || slot === 'full'
  const marketSymbols = [...new Set([
    ...selected.filter((asset) => asset.cls !== 'FUND').map((asset) => asset.symbol),
    ...(includeDomesticBenchmarks ? BENCHMARK_INDICES.map((index) => index.symbol) : []),
  ])]
  return {
    slot,
    assets: selected,
    fundSymbols,
    marketSymbols,
    hasForeignCurrency: selected.some((asset) => asset.currency === 'USD' || asset.currency === 'HKD'),
  }
}
