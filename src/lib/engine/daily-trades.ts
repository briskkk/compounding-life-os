import { emptyPosition, positionKey, roundMoney, type LedgerTx, type Position } from './ledger'
import type { AssetInfo } from './types'
import { liveQuoteAttribution, portfolioDayOffset } from './portfolio-day'
import { dateKeyAt } from './watch-market'
import type { IntradayTrade } from './intraday'

/** 只读派生的当场交易影响；金额已按当前汇率折成人民币。 */
export interface DailyTradeActivity {
  tradingDate: string
  quantityDelta: number
  cashFlowCny: number // 卖出净额 + 收入 - 买入支出 - 费用；不含内部现金腿
  trades?: IntradayTrade[] // 按记录时刻重建分钟路径；日期录入时刻属于默认假设
}

export function transactionTradingDate(tx: LedgerTx, asset: AssetInfo): string {
  if (asset.cls === 'FUND') return dateKeyAt(tx.navDate ?? tx.occurredAt)
  return dateKeyAt(tx.occurredAt, portfolioDayOffset(asset) === 1 ? 'America/New_York' : 'Asia/Shanghai')
}

function eligible(tx: LedgerTx): boolean {
  return !tx.voidedAt && !tx.internal && !tx.settleOfId && tx.navSource !== 'PENDING'
    && ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE'].includes(tx.type)
}

export function isCurrentDailyTrade(tx: LedgerTx, asset: AssetInfo, now: Date): boolean {
  return eligible(tx) && liveQuoteAttribution({
    asset, exchangeTradingDate: transactionTradingDate(tx, asset), now,
  }).included
}

/** 保留今天清仓（包括历史累计盈亏恰为零）的账本行，才能加载昨收并计入已实现的当日损益。 */
export function positionsWithDailyActivity(
  positions: Position[], txs: LedgerTx[], assets: Map<string, AssetInfo>, now: Date,
): Position[] {
  const result = new Map(positions.map((p) => [positionKey(p.accountId, p.assetId), p]))
  for (const tx of txs) {
    const asset = assets.get(tx.assetId)
    if (!asset || !isCurrentDailyTrade(tx, asset, now)) continue
    const key = positionKey(tx.accountId, tx.assetId)
    if (!result.has(key)) result.set(key, emptyPosition(tx.accountId, tx.assetId))
  }
  return [...result.values()]
}

export function dailyTradeActivities(
  txs: LedgerTx[],
  assets: Map<string, AssetInfo>,
  tradingDateFor: (symbol: string) => string | null | undefined,
  rateFor: (currency: string) => number,
  now: Date,
): Map<string, DailyTradeActivity> {
  const result = new Map<string, DailyTradeActivity>()
  for (const tx of txs) {
    const asset = assets.get(tx.assetId)
    if (!asset || !eligible(tx) || asset.manual || asset.cls === 'CASH' || asset.cls === 'REAL_ESTATE') continue
    const tradingDate = tradingDateFor(asset.symbol)
    if (!tradingDate || transactionTradingDate(tx, asset) !== tradingDate
      || !liveQuoteAttribution({ asset, exchangeTradingDate: tradingDate, now }).included) continue
    const quantity = tx.quantity ?? 0
    if ((tx.type === 'BUY' || tx.type === 'SELL') && (quantity <= 0 || tx.price == null)) continue
    const key = positionKey(tx.accountId, tx.assetId)
    const activity = result.get(key) ?? { tradingDate, quantityDelta: 0, cashFlowCny: 0, trades: [] }
    const rate = rateFor(asset.currency)
    let quantityDelta = 0
    let cashFlowCny = 0
    // 与账本成本/已实现盈亏同源：成交数量 × 成交价；手续费单独扣除。
    if (tx.type === 'BUY' || tx.type === 'SELL') {
      const sign = tx.type === 'BUY' ? 1 : -1
      quantityDelta = sign * quantity
      cashFlowCny = roundMoney((-sign * quantity * tx.price! - tx.fee) * rate)
    } else {
      cashFlowCny = roundMoney((tx.type === 'FEE' ? -tx.amount : tx.amount - tx.fee) * rate)
    }
    activity.quantityDelta += quantityDelta
    activity.cashFlowCny = roundMoney(activity.cashFlowCny + cashFlowCny)
    activity.trades!.push({ t: tx.occurredAt.getTime(), quantityDelta, cashFlowCny })
    result.set(key, activity)
  }
  return result
}

/** 调整基准 = 昨日持仓市值 + 今日买入支出 - 今日卖出净额 - 今日收入。 */
export function dailyPnlBaseline(quantity: number, prevCloseCny: number, activity?: DailyTradeActivity): number {
  return (quantity - (activity?.quantityDelta ?? 0)) * prevCloseCny - (activity?.cashFlowCny ?? 0)
}

export function hasDailyPositionActivity(position: { quantity: number; dailyActivity?: DailyTradeActivity }): boolean {
  return Math.abs(position.quantity) > 1e-9 || position.dailyActivity != null
}
