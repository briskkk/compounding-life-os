// 聚合指标：净资产 / 可自由投资资产 双口径 + 风险敞口 + 流动性水位
import type { AssetClass } from './types'
import type { ValuedPosition } from './valuation'
import { isInvestableAsset, isPortfolioAssetClass } from '../asset-classification'

export interface LiquidityTiers {
  cash: number // 现金及等价物
  market: number // 高流动性证券（股/基/ETF/可交易黄金）
  illiquid: number // 不动产、长期持股及其他非投资资产
}

export interface HoldingWeight {
  symbol: string
  name: string
  cls: AssetClass
  value: number
  weight: number // 占投资组合（排除长期资产）
}

export interface Metrics {
  netWorth: number
  portfolioValue: number // 排除华为股票等长期资产后的投资组合总值
  investable: number
  realizedPnl: number
  unrealizedPnl: number
  cashRatio: number // 现金 / 投资组合价值
  byClass: Record<AssetClass, number>
  liquidity: LiquidityTiers
  holdings: HoldingWeight[] // 按市值降序（不含现金）
  concentration: HoldingWeight | null // 最大单一非现金持仓
}

/** 资产类别全量清单（composition 等按此顺序输出） */
export const ALL_CLASSES: AssetClass[] = ['STOCK', 'FUND', 'ETF', 'CASH', 'GOLD', 'HUAWEI_STOCK', 'REAL_ESTATE']

export function aggregate(valued: ValuedPosition[]): Metrics {
  const byClass = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0])) as Record<AssetClass, number>
  const liquidity: LiquidityTiers = { cash: 0, market: 0, illiquid: 0 }
  let netWorth = 0
  let portfolioValue = 0
  let investable = 0
  let realizedPnl = 0

  for (const p of valued) {
    netWorth += p.value
    investable += p.investable
    byClass[p.asset.cls] += p.value
    if (isPortfolioAssetClass(p.asset.cls)) {
      portfolioValue += p.value
      realizedPnl += p.realizedCny
    }

    if (p.asset.cls === 'CASH') liquidity.cash += p.value
    else if (!isInvestableAsset(p.asset)) liquidity.illiquid += p.value
    else liquidity.market += p.value
  }

  // 风险集中度按资产合并，避免同一标的分散在多个账户时被低估。
  const holdingValues = new Map<string, Omit<HoldingWeight, 'weight'>>()
  for (const p of valued) {
    if (p.asset.cls === 'CASH' || !isPortfolioAssetClass(p.asset.cls) || p.value <= 0) continue
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
    .map((p) => ({ ...p, weight: portfolioValue > 0 ? p.value / portfolioValue : 0 }))
    .sort((a, b) => b.value - a.value)

  const unrealizedPnl = valued
    .filter((p) => isPortfolioAssetClass(p.asset.cls))
    .reduce((s, p) => s + p.unrealized, 0)

  return {
    netWorth,
    portfolioValue,
    investable,
    realizedPnl,
    unrealizedPnl,
    cashRatio: portfolioValue > 0 ? liquidity.cash / portfolioValue : 0,
    byClass,
    liquidity,
    holdings,
    concentration: holdings[0] ?? null,
  }
}
