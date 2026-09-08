import type { AssetClass } from './types'
import { isQdiiFund } from './fund-order'
import { parseSymbol } from '../market/symbols'

export type MarketGroup = 'DOMESTIC' | 'OFFSHORE'

/**
 * App 与网页贡献归因共用的市场边界：QDII、港股、美股及外币资产归为境外，
 * 其余人民币境内资产归为境内。该字段只描述市场暴露，不替代自定义 tags。
 */
export function marketGroupOf(asset: {
  cls: AssetClass
  symbol: string
  name: string
  currency: string
}): MarketGroup {
  if (isQdiiFund(asset.symbol, asset.name)) return 'OFFSHORE'
  const market = parseSymbol(asset.symbol).market
  if (market === 'US' || market === 'HK' || asset.currency === 'USD' || asset.currency === 'HKD') {
    return 'OFFSHORE'
  }
  return 'DOMESTIC'
}

export function marketGroupLabel(group: MarketGroup): string {
  return group === 'OFFSHORE' ? '境外市场' : '境内市场'
}
