import type { AssetClass } from './types'

export interface AccountPositionInput {
  accountId: string
  assetId: string
  quantity: number
  value: number
  unrealized: number
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
  position: Pick<AccountPositionInput, 'quantity' | 'value'>,
  prevCloseCny: number | null | undefined,
): number | null {
  if (prevCloseCny == null || !Number.isFinite(prevCloseCny)) return null
  return position.value - position.quantity * prevCloseCny
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
    if (active && dayPnl != null) {
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
