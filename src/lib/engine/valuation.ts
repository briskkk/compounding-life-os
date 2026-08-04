// 估值：持仓 × 价格来源 → 市值；同时给出「可自由投资」口径的切分
import type { Position } from './ledger'
import type { AssetInfo, PriceSource } from './types'

export interface ValuedPosition extends Position {
  asset: AssetInfo
  price: number | null
  priceSource: PriceSource
  value: number // 当前市值（人民币口径，计入净资产）
  investable: number // 可自由投资部分（人民币口径）
  costCny: number // 持仓成本（人民币口径，成本原值 × 汇率）
  realizedCny: number // 已实现盈亏（人民币口径）
  unrealized: number // 未实现盈亏（人民币口径 = value − costCny）
  unrealizedPct: number | null
}

export type PriceFn = (symbol: string) => number | undefined
export type CurrencyRateFn = (currency: string) => number

export function valuePosition(
  pos: Position,
  asset: AssetInfo,
  priceOf: PriceFn,
  currencyRate: CurrencyRateFn = () => 1,
): ValuedPosition {
  let price: number | null = null
  let priceSource: PriceSource = 'FACE'
  let value = 0
  let investable = 0

  if (asset.cls === 'CASH') {
    // 现金按其币种汇率折算人民币口径（CASH-CNY=1，CASH-USD≈6.77）
    price = currencyRate(asset.currency)
    priceSource = 'FACE'
    value = pos.quantity * price
    investable = value
  } else if (asset.cls === 'REAL_ESTATE' || asset.manual) {
    // 手动估值资产：最近估值优先，缺省回落到成本
    priceSource = pos.manualValue != null ? 'MANUAL' : 'COST'
    value = pos.manualValue ?? pos.costBasis * currencyRate(asset.currency)
    investable = 0 // 不动产 / 手动估值资产默认不可自由投资
    price = pos.quantity > 0 ? value / pos.quantity : null
  } else {
    const mkt = priceOf(asset.symbol) // 行情价已在查询层折算为人民币
    price = mkt ?? (pos.quantity > 0 ? pos.costBasis / pos.quantity : null)
    priceSource = mkt != null ? 'MARKET' : 'COST'
    if (mkt != null) {
      value = pos.quantity * mkt
      investable = value
    } else {
      // 无行情回落：以成本×汇率计值，保持人民币口径一致
      value = pos.costBasis * currencyRate(asset.currency)
      investable = value
    }
  }

  // 成本与已实现盈亏同样折算人民币，再与市值相减（修复外币成本未折算导致的虚假盈亏）
  const rate = currencyRate(asset.currency)
  const costCny = pos.costBasis * rate
  const realizedCny = pos.realizedPnl * rate
  // 现金不产生「未实现盈亏」（透支时成本钳制会产生幻象值，且汇率影响已体现在市值中）
  const unrealized = asset.cls === 'CASH' ? 0 : value - costCny
  const unrealizedPct = asset.cls !== 'CASH' && costCny > 0 ? unrealized / costCny : null
  return { ...pos, asset, price, priceSource, value, investable, costCny, realizedCny, unrealized, unrealizedPct }
}

export function valuePositions(
  positions: Position[],
  assets: Map<string, AssetInfo>,
  priceOf: PriceFn,
  currencyRate: CurrencyRateFn = () => 1,
): ValuedPosition[] {
  return positions
    .filter((p) => assets.has(p.assetId))
    .map((p) => valuePosition(p, assets.get(p.assetId)!, priceOf, currencyRate))
}
