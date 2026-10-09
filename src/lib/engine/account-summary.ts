import type { AssetClass } from './types'
import { dailyPnlBaseline, type DailyTradeActivity } from './daily-trades'

export interface AccountPositionInput {
  accountId: string
  assetId: string
  quantity: number
  value: number
  unrealized: number
  dailyActivity?: DailyTradeActivity
  asset: {
    symbol: string
    cls: AssetClass
  }
}

export interface AccountPositionSummary {
  valueCny: number
  cashCny: number
  unrealizedCny: number
  dayPnlCny: number | null
  holdingCount: number
}

export function positionDayPnlCny(
  position: Pick<AccountPositionInput, 'quantity' | 'value' | 'dailyActivity'>,
  prevCloseCny: number | null | undefined,
): number | null {
  if (prevCloseCny == null || !Number.isFinite(prevCloseCny)) return null
  return position.value - dailyPnlBaseline(position.quantity, prevCloseCny, position.dailyActivity)
}

export function summarizeAccountPositions(
  positions: AccountPositionInput[],
  prevCloseFor: (symbol: string) => number | null | undefined,
): AccountPositionSummary {
  let valueCny = 0
  let cashCny = 0
  let unrealizedCny = 0
  let dayPnlCny = 0
  let knownDayPnlCount = 0
  let holdingCount = 0

  for (const position of positions) {
    const active = Math.abs(position.quantity) > 1e-9 || Math.abs(position.value) > 1e-9
    valueCny += position.value
    unrealizedCny += position.unrealized
    if (position.asset.cls === 'CASH') cashCny += position.value
    if (active) holdingCount += 1

    const dayPnl = positionDayPnlCny(position, prevCloseFor(position.asset.symbol))
    if ((active || position.dailyActivity) && dayPnl != null) {
      dayPnlCny += dayPnl
      knownDayPnlCount += 1
    }
  }

  return {
    valueCny,
    cashCny,
    unrealizedCny,
    dayPnlCny: knownDayPnlCount > 0 ? dayPnlCny : null,
    holdingCount,
  }
}
