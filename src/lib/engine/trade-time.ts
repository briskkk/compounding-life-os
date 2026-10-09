import { parseSymbol } from '../market/symbols'

export function isAShareAsset(asset: { symbol: string; cls: string }): boolean {
  return (asset.cls === 'STOCK' || asset.cls === 'ETF')
    && parseSymbol(asset.symbol, 'EXCHANGE').market === 'CN_A'
}

/** 日期录入的产品默认时刻，不代表券商确认的真实成交时间。 */
export function defaultTransactionDate(date: string, asset?: { symbol: string; cls: string }): Date {
  return asset && isAShareAsset(asset)
    ? new Date(`${date}T10:00:00+08:00`)
    : new Date(`${date}T12:00:00`)
}
