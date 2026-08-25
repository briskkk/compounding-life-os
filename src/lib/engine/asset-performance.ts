import { foldTransactions, type LedgerTx } from './ledger'
import { dateKeyAt } from './watch-market'
import type { AssetInfo } from './types'
import type { ValuationGap, ValuationStatus } from './valuation-status'

const DAY = 86400000
const MAX_SUPPORTED_DAYS = 36525

export interface AssetNavPoint {
  date: string
  nav: number
  source?: string
  valuationStatus?: ValuationStatus
}

export interface AssetPerformancePoint {
  date: string
  netWorth: number
  contributions: number
  quantity: number
  nav: number | null
  valuationStatus: ValuationStatus
  valuationCoverage: number | null
  latestValuationDate: string | null
  valuationGaps: ValuationGap[]
}

export type AssetCurrencyRate = number | ((date: Date) => number)

function currencyRateAt(rate: AssetCurrencyRate, date: Date): number {
  return typeof rate === 'function' ? rate(date) : rate
}

/** 行情时间统一归属到北京时间自然估值日，避免基金本地零点被 UTC 截成前一天。 */
export function toAssetNavPoint(
  date: Date,
  nav: number,
  source?: string,
  valuationStatus?: ValuationStatus,
): AssetNavPoint {
  return { date: dateKeyAt(date), nav, source, valuationStatus }
}

function utcDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`)
}

function shiftDateKey(key: string, days: number): string {
  const date = utcDate(key)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function transactionFlow(
  tx: LedgerTx,
  nav: number | null,
  rate: number,
  assetClass: AssetInfo['cls'],
): number {
  if (tx.voidedAt) return 0
  const quantity = tx.quantity ?? 0
  const gross = (tx.amount > 0 ? tx.amount : quantity * (tx.price ?? nav ?? 0)) * rate
  const fee = tx.fee * rate

  if (tx.type === 'BUY') return gross + fee
  if (tx.type === 'SELL') return -(gross - fee)
  if (tx.type === 'DEPOSIT') return gross
  if (tx.type === 'WITHDRAW') return -gross
  if (tx.type === 'TRANSFER_IN') return gross
  if (tx.type === 'TRANSFER_OUT') return -gross
  if (tx.type === 'DIVIDEND' || tx.type === 'INTEREST') {
    // 现金利息会直接增加现金余额，不是从该资产转出的资金流；其他资产的
    // 分红不留在资产市值内，因此视作转出，才能计入单资产总回报。
    return assetClass === 'CASH' ? 0 : -(gross - fee)
  }
  if (tx.type === 'FEE') return gross
  return 0
}

/**
 * 从单资产流水回放每日持仓，并以历史净值/价格计算每日市值与累计资金流。
 * 资金流用于 TWR：买入/转入为正，卖出/转出/分红为负，费用为正。
 */
export function buildAssetPerformanceSeries({
  asset,
  transactions,
  prices,
  to = new Date(),
  currencyRate = 1,
}: {
  asset: AssetInfo
  transactions: LedgerTx[]
  prices: AssetNavPoint[]
  to?: Date
  currencyRate?: AssetCurrencyRate
}): AssetPerformancePoint[] {
  const txs = transactions
    .filter((tx) => tx.assetId === asset.id && !tx.voidedAt)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  if (txs.length === 0) return []

  const endKey = dateKeyAt(to)
  const earliestKey = dateKeyAt(txs[0].occurredAt)
  const startKey = shiftDateKey(earliestKey, -1)
  const totalDays = Math.round((utcDate(endKey).getTime() - utcDate(startKey).getTime()) / DAY) + 1
  if (totalDays <= 0) return []
  if (totalDays > MAX_SUPPORTED_DAYS) {
    throw new Error(`资产历史区间超过 ${MAX_SUPPORTED_DAYS} 天，请检查流水日期是否异常`)
  }

  const sortedPrices = [...prices]
    .filter((point) => Number.isFinite(point.nav) && point.date <= endKey)
    .sort((a, b) => a.date.localeCompare(b.date))
  const transactionsByDate = new Map<string, LedgerTx[]>()
  for (const tx of txs) {
    const key = dateKeyAt(tx.occurredAt)
    const sameDay = transactionsByDate.get(key) ?? []
    sameDay.push(tx)
    transactionsByDate.set(key, sameDay)
  }

  let priceIndex = 0
  let lastMarketNav: number | null = null
  let lastMarketDate: string | null = null
  let lastPriceStatus: ValuationStatus | undefined
  let previousCurrencyRate: number | null = null
  let cumulativeFlow = 0
  const result: AssetPerformancePoint[] = []

  for (let index = 0; index < totalDays; index++) {
    const date = shiftDateKey(startKey, index)
    while (priceIndex < sortedPrices.length && sortedPrices[priceIndex].date <= date) {
      lastMarketNav = sortedPrices[priceIndex].nav
      lastMarketDate = sortedPrices[priceIndex].date
      lastPriceStatus = sortedPrices[priceIndex].valuationStatus
      priceIndex += 1
    }

    const replayDate = utcDate(date)
    const dailyRate = currencyRateAt(currencyRate, replayDate)
    const positions = foldTransactions(txs, replayDate)
    const quantity = positions.reduce((sum, position) => sum + position.quantity, 0)
    const costBasis = positions.reduce((sum, position) => sum + position.costBasis, 0)
    let nav: number | null = null
    let netWorth = 0

    if (asset.cls === 'CASH') {
      nav = 1
      netWorth = quantity * dailyRate
    } else if (asset.manual || asset.cls === 'REAL_ESTATE') {
      netWorth = positions.reduce(
        (sum, position) => sum + (position.manualValue ?? position.costBasis * dailyRate),
        0,
      )
      nav = quantity > 0 ? netWorth / quantity / dailyRate : null
    } else if (lastMarketNav != null) {
      nav = lastMarketNav
      netWorth = quantity * nav * dailyRate
    } else {
      nav = quantity > 0 ? costBasis / quantity : null
      netWorth = costBasis * dailyRate
    }

    const dailyTxs = transactionsByDate.get(date) ?? []
    for (const tx of dailyTxs) {
      cumulativeFlow += transactionFlow(
        tx,
        nav,
        currencyRateAt(currencyRate, tx.occurredAt),
        asset.cls,
      )
    }

    const hasReturnEvent = dailyTxs.some((tx) => ['DIVIDEND', 'INTEREST', 'FEE', 'VALUATION'].includes(tx.type))
    const hasCurrencyReturn = previousCurrencyRate != null
      && Math.abs(dailyRate - previousCurrencyRate) >= 1e-12
      && Math.abs(netWorth) >= 0.005
    const hasAssetFlow = dailyTxs.some((tx) => Math.abs(transactionFlow(
      tx,
      nav,
      currencyRateAt(currencyRate, tx.occurredAt),
      asset.cls,
    )) >= 0.005)
    const weekend = utcDate(date).getUTCDay() === 0 || utcDate(date).getUTCDay() === 6
    const nextMarketDate = sortedPrices[priceIndex]?.date ?? null
    const hasFreshPrice = lastMarketDate === date
    const confirmedClosed = nextMarketDate != null && nextMarketDate > date
    const latestManualValuation = positions.reduce<Date | null>(
      (latest, position) => position.lastValuationAt && (!latest || position.lastValuationAt > latest)
        ? position.lastValuationAt
        : latest,
      null,
    )
    let valuationStatus: ValuationStatus
    if (asset.cls === 'CASH' || asset.manual || asset.cls === 'REAL_ESTATE') {
      valuationStatus = hasReturnEvent || hasCurrencyReturn ? 'SETTLED' : hasAssetFlow ? 'FLOW_ONLY' : 'NO_UPDATE'
    } else if (hasFreshPrice) {
      valuationStatus = lastPriceStatus ?? 'SETTLED'
    } else if (hasReturnEvent || hasCurrencyReturn) {
      valuationStatus = 'PARTIAL'
    } else if (hasAssetFlow) {
      valuationStatus = 'FLOW_ONLY'
    } else if (weekend || confirmedClosed) {
      valuationStatus = 'CLOSED'
    } else {
      valuationStatus = 'NO_UPDATE'
    }
    const valuationGaps: ValuationGap[] = !hasFreshPrice && !asset.manual && asset.cls !== 'CASH' && asset.cls !== 'REAL_ESTATE'
      ? [{
          symbol: asset.symbol,
          name: asset.name,
          valuationDate: lastMarketDate,
          valueCny: Math.round(netWorth),
          reason: lastMarketNav == null ? 'NO_PRICE' : valuationStatus === 'CLOSED' ? 'MARKET_CLOSED' : 'PENDING',
        }]
      : []

    result.push({
      date,
      netWorth,
      contributions: cumulativeFlow,
      quantity,
      nav,
      valuationStatus,
      valuationCoverage: hasFreshPrice ? 1 : 0,
      latestValuationDate: asset.manual && latestManualValuation
        ? dateKeyAt(latestManualValuation)
        : lastMarketDate,
      valuationGaps,
    })
    previousCurrencyRate = dailyRate
  }

  return result
}
