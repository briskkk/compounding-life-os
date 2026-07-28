// 聚合指标：净资产 / 可自由投资资产 双口径 + 风险敞口 + 流动性水位
import type { AssetClass } from './types'
import type { ValuedPosition } from './valuation'

export interface LiquidityTiers {
  cash: number // 现金及等价物
  market: number // 高流动性证券（股/基/ETF/金）
  restricted: number // 受限（RSU 未归属）
  illiquid: number // 不动产及其他手动估值资产
}

export interface HoldingWeight {
  symbol: string
  name: string
  cls: AssetClass
  value: number
  weight: number // 占净资产
}

export interface Metrics {
  netWorth: number
  investable: number
  realizedPnl: number
  unrealizedPnl: number
  cashRatio: number // 现金 / 净资产
  byClass: Record<AssetClass, number>
  liquidity: LiquidityTiers
  holdings: HoldingWeight[] // 按市值降序（不含现金）
  concentration: HoldingWeight | null // 最大单一非现金持仓
}

const ALL_CLASSES: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'REAL_ESTATE', 'RSU']

export function aggregate(valued: ValuedPosition[]): Metrics {
  const byClass = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0])) as Record<AssetClass, number>
  const liquidity: LiquidityTiers = { cash: 0, market: 0, restricted: 0, illiquid: 0 }
  let netWorth = 0
  let investable = 0
  let realizedPnl = 0

  for (const p of valued) {
    netWorth += p.value
    investable += p.investable
    realizedPnl += p.realizedCny
    byClass[p.asset.cls] += p.value

    if (p.asset.cls === 'CASH') liquidity.cash += p.value
    else if (p.asset.cls === 'REAL_ESTATE' || p.asset.manual) liquidity.illiquid += p.value
    else if (p.asset.cls === 'RSU') {
      liquidity.market += p.investable
      liquidity.restricted += p.value - p.investable
    } else liquidity.market += p.value
  }

  // 风险集中度按资产合并，避免同一标的分散在多个账户时被低估。
  const holdingValues = new Map<string, Omit<HoldingWeight, 'weight'>>()
  for (const p of valued) {
    if (p.asset.cls === 'CASH' || p.value <= 0) continue
    const current = holdingValues.get(p.assetId)
    if (current) current.value += p.value
    else {
      holdingValues.set(p.assetId, {
        symbol: p.asset.symbol,
        name: p.asset.name,
        cls: p.asset.cls,
        value: p.value,
      })
    }
  }
  const holdings: HoldingWeight[] = [...holdingValues.values()]
    .map((p) => ({ ...p, weight: netWorth > 0 ? p.value / netWorth : 0 }))
    .sort((a, b) => b.value - a.value)

  const unrealizedPnl = valued.reduce((s, p) => s + p.unrealized, 0)

  return {
    netWorth,
    investable,
    realizedPnl,
    unrealizedPnl,
    cashRatio: netWorth > 0 ? liquidity.cash / netWorth : 0,
    byClass,
    liquidity,
    holdings,
    concentration: holdings[0] ?? null,
  }
}
