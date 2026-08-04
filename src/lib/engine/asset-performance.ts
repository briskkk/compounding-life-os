import { foldTransactions, type LedgerTx } from './ledger'
import { dateKeyAt } from './watch-market'
import type { AssetInfo } from './types'

const DAY = 86400000
const MAX_DAYS = 1400

export interface AssetNavPoint {
  date: string
  nav: number
}

export interface AssetPerformancePoint {
  date: string
  netWorth: number
  contributions: number
  quantity: number
  nav: number | null
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
  currencyRate?: number
}): AssetPerformancePoint[] {
  const txs = transactions
    .filter((tx) => tx.assetId === asset.id && !tx.voidedAt)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  if (txs.length === 0) return []

  const endKey = dateKeyAt(to)
  const earliestKey = dateKeyAt(txs[0].occurredAt)
  const windowStart = shiftDateKey(endKey, -(MAX_DAYS - 1))
  const startKey = earliestKey > windowStart ? shiftDateKey(earliestKey, -1) : windowStart
  const totalDays = Math.round((utcDate(endKey).getTime() - utcDate(startKey).getTime()) / DAY) + 1
  if (totalDays <= 0) return []

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
  let cumulativeFlow = 0
  const result: AssetPerformancePoint[] = []

  for (let index = 0; index < totalDays; index++) {
    const date = shiftDateKey(startKey, index)
    while (priceIndex < sortedPrices.length && sortedPrices[priceIndex].date <= date) {
      lastMarketNav = sortedPrices[priceIndex].nav
      priceIndex += 1
    }

    const replayDate = utcDate(date)
    const positions = foldTransactions(txs, replayDate)
    const quantity = positions.reduce((sum, position) => sum + position.quantity, 0)
    const costBasis = positions.reduce((sum, position) => sum + position.costBasis, 0)
    let nav: number | null = null
    let netWorth = 0

    if (asset.cls === 'CASH') {
      nav = 1
      netWorth = quantity * currencyRate
    } else if (asset.manual || asset.cls === 'REAL_ESTATE') {
      netWorth = positions.reduce(
        (sum, position) => sum + (position.manualValue ?? position.costBasis * currencyRate),
        0,
      )
      nav = quantity > 0 ? netWorth / quantity / currencyRate : null
    } else if (lastMarketNav != null) {
      nav = lastMarketNav
      netWorth = quantity * nav * currencyRate
    } else {
      nav = quantity > 0 ? costBasis / quantity : null
      netWorth = costBasis * currencyRate
    }

    for (const tx of transactionsByDate.get(date) ?? []) {
      cumulativeFlow += transactionFlow(tx, nav, currencyRate, asset.cls)
    }

    result.push({
      date,
      netWorth,
      contributions: cumulativeFlow,
      quantity,
      nav,
    })
  }

  return result
}
