import {
  performanceBetween,
  performancePresetRange,
  type PerformancePoint,
  type PerformanceRange,
  type PeriodPerformanceResult,
} from './period-performance'
import { riskMetrics } from './risk'
import { dateKeyAt } from './watch-market'
import type { AssetPerformancePoint } from './asset-performance'
import type { AssetClass, AssetStyle } from './types'
import { pendingSettlementsAt, type LedgerTx } from './ledger'

export type ReviewPeriod = 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_QUARTER'

function quarterRange(now: Date): PerformanceRange {
  const endDate = dateKeyAt(now)
  const month = Number(endDate.slice(5, 7))
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1
  return {
    label: '本季度',
    startDate: `${endDate.slice(0, 4)}-${String(quarterMonth).padStart(2, '0')}-01`,
    endDate,
  }
}

export function reviewRange(period: ReviewPeriod, now = new Date()): PerformanceRange {
  return period === 'THIS_QUARTER' ? quarterRange(now) : performancePresetRange(period, now)
}

export interface ReviewAssetInput {
  assetId: string
  name: string
  symbol: string
  cls: AssetClass
  style: AssetStyle | null
  currency: string
  series: AssetPerformancePoint[]
}

export interface ReviewContribution {
  key: string
  name: string
  code: string
  amount: number
  contributionPct: number | null
  returnPct: number | null
  averageWeight: number | null
  tradeCount: number
  marketAmount: number
  incomeAmount: number
  feeAmount: number
  cls?: AssetClass
  style?: AssetStyle | null
  currency?: string
}

export interface ReviewSourceContribution {
  key: 'MARKET' | 'INCOME' | 'FEES' | 'RECONCILIATION'
  name: string
  amount: number
  contributionPct: number | null
}

export interface ReviewClassContribution {
  key: AssetClass
  amount: number
  contributionPct: number | null
  averageWeight: number | null
}

export interface ReviewDay {
  date: string
  amount: number
  pct: number
}

export interface ReviewTiming {
  days: ReviewDay[]
  grossProfit: number
  grossLoss: number
  positiveDays: number
  observedDays: number
  bestDay: ReviewDay | null
  worstDay: ReviewDay | null
  maxLossStreak: number
  profitConcentration: number | null
}

export interface ReviewDecision {
  id: string
  date: string
  assetId: string
  name: string
  symbol: string
  action: '建仓' | '加仓' | '减仓' | '清仓'
  amount: number
  quantity: number
  afterReturnPct: number | null
  note: string | null
}

export interface ReviewBehavior {
  decisions: ReviewDecision[]
  buyAmount: number
  sellAmount: number
  turnover: number | null
  feeRate: number | null
}

export interface ReviewRiskPoint {
  key: 'TOP_ONE' | 'TOP_THREE' | 'CASH' | 'FOREIGN' | 'VALUATION_GAP'
  start: number
  end: number
}

export interface ReviewResult {
  performance: PeriodPerformanceResult
  benchmarkPct: number | null
  alphaPct: number | null
  assets: ReviewContribution[]
  sources: ReviewSourceContribution[]
  classes: ReviewClassContribution[]
  attributedAmount: number
  attributedPct: number | null
  reconciliationAmount: number
  reconciliationPct: number | null
  reconciliationStatus: 'MATCHED' | 'MINOR' | 'REVIEW'
  timing: ReviewTiming
  behavior: ReviewBehavior
  risks: ReviewRiskPoint[]
  maxDrawdown: number | null
  valuationCoverage: number | null
  latestValuationDate: string | null
  valuationGapCount: number
}

/**
 * 用资产级日序列重建组合可投资市值，并补回非持仓形态的赎回在途资金。
 * 组合与标的共用同一批价格/汇率，避免 Snapshot 尾部与实时报价混算产生伪差额。
 */
export function reconstructReviewPortfolioSeries({
  series,
  assets,
  transactions,
  rateAt = () => 1,
}: {
  series: PerformancePoint[]
  assets: ReviewAssetInput[]
  transactions: LedgerTx[]
  rateAt?: (currency: string, date: Date) => number
}): PerformancePoint[] {
  const valuesByDate = assets.map((asset) => new Map(
    asset.series.map((point) => [point.date, point.netWorth]),
  ))
  return series.map((point) => {
    const valuationDate = new Date(`${point.date}T12:00:00+08:00`)
    const assetsValue = valuesByDate.reduce((sum, values) => sum + (values.get(point.date) ?? 0), 0)
    const inTransit = pendingSettlementsAt(transactions, valuationDate).reduce(
      (sum, settlement) => sum + settlement.amount * rateAt(settlement.currency, valuationDate),
      0,
    )
    return { ...point, netWorth: assetsValue + inTransit }
  })
}

type DailyBuckets = Map<string, Map<string, number>>

function addDaily(buckets: DailyBuckets, date: string, key: string, amount: number) {
  const day = buckets.get(date) ?? new Map<string, number>()
  day.set(key, (day.get(key) ?? 0) + amount)
  buckets.set(date, day)
}

function finiteOrZero(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0
}

function valueAt(series: AssetPerformancePoint[], date: string): number {
  return [...series].filter((point) => point.date <= date).at(-1)?.netWorth ?? 0
}

function linkedContributionPct(
  performance: PeriodPerformanceResult,
  buckets: DailyBuckets,
): Map<string, number> {
  const result = new Map<string, number>()
  const totalReturn = performance.pct
  if (totalReturn == null || performance.curve.length < 2) return result
  const overallLink = totalReturn === 0 ? 1 : Math.log1p(totalReturn) / totalReturn
  if (!Number.isFinite(overallLink) || overallLink === 0) return result

  for (let index = 1; index < performance.curve.length; index++) {
    const point = performance.curve[index]
    const previous = performance.curve[index - 1]
    if (point.dailyPct == null || point.dailyAmount == null || previous.netWorth <= 0) continue
    const dailyLink = point.dailyPct === 0 ? 1 : Math.log1p(point.dailyPct) / point.dailyPct
    if (!Number.isFinite(dailyLink)) continue
    for (const [key, amount] of buckets.get(point.date) ?? []) {
      const arithmeticContribution = amount / previous.netWorth
      result.set(key, (result.get(key) ?? 0) + arithmeticContribution * dailyLink / overallLink)
    }
  }
  return result
}

function periodTransactions(
  transactions: LedgerTx[],
  startDate: string,
  endDate: string,
): LedgerTx[] {
  return transactions.filter((tx) => {
    if (tx.voidedAt) return false
    const date = dateKeyAt(tx.occurredAt)
    return date >= startDate && date <= endDate
  })
}

function transactionIncome(tx: LedgerTx, rate: number): number {
  return tx.type === 'DIVIDEND' || tx.type === 'INTEREST' ? tx.amount * rate : 0
}

function transactionFee(tx: LedgerTx, rate: number): number {
  const explicit = tx.type === 'FEE' ? tx.amount : 0
  return -(explicit + tx.fee) * rate
}

function reviewTiming(performance: PeriodPerformanceResult): ReviewTiming {
  const days = performance.curve
    .filter((point) => point.dailyAmount != null && point.dailyPct != null)
    .map((point) => ({ date: point.date, amount: point.dailyAmount!, pct: point.dailyPct! }))
  const grossProfit = days.reduce((sum, day) => sum + Math.max(0, day.amount), 0)
  const grossLoss = days.reduce((sum, day) => sum + Math.min(0, day.amount), 0)
  const bestDay = days.length > 0 ? [...days].sort((a, b) => b.amount - a.amount)[0] : null
  const worstDay = days.length > 0 ? [...days].sort((a, b) => a.amount - b.amount)[0] : null
  let currentLossStreak = 0
  let maxLossStreak = 0
  for (const day of days) {
    if (day.amount < 0) {
      currentLossStreak += 1
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak)
    } else {
      currentLossStreak = 0
    }
  }
  return {
    days,
    grossProfit,
    grossLoss,
    positiveDays: days.filter((day) => day.amount > 0).length,
    observedDays: days.length,
    bestDay,
    worstDay,
    maxLossStreak,
    profitConcentration: bestDay && bestDay.amount > 0 && grossProfit > 0 ? bestDay.amount / grossProfit : null,
  }
}

function buildDecisions(
  transactions: LedgerTx[],
  assets: ReviewAssetInput[],
  startDate: string,
  endDate: string,
  rateAt: (currency: string, date: Date) => number,
): ReviewDecision[] {
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]))
  const quantityByAsset = new Map<string, number>()
  const decisions: ReviewDecision[] = []
  const sorted = [...transactions]
    .filter((tx) => !tx.voidedAt)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  for (const tx of sorted) {
    const before = quantityByAsset.get(tx.assetId) ?? 0
    const quantity = tx.quantity ?? 0
    let after = before
    if (tx.type === 'BUY' || tx.type === 'TRANSFER_IN') after += quantity
    if (tx.type === 'SELL' || tx.type === 'TRANSFER_OUT') after -= Math.min(quantity, Math.max(0, before))
    quantityByAsset.set(tx.assetId, after)

    const date = dateKeyAt(tx.occurredAt)
    if (tx.internal || (tx.type !== 'BUY' && tx.type !== 'SELL') || date < startDate || date > endDate) continue
    const asset = assetById.get(tx.assetId)
    if (!asset) continue
    const result = performanceBetween(asset.series, date, endDate)
    const gross = tx.amount > 0 ? tx.amount : quantity * (tx.price ?? 0)
    decisions.push({
      id: tx.id ?? `${tx.assetId}-${tx.occurredAt.getTime()}`,
      date,
      assetId: tx.assetId,
      name: asset.name,
      symbol: asset.symbol,
      action: tx.type === 'BUY'
        ? before <= 1e-9 ? '建仓' : '加仓'
        : after <= 1e-9 ? '清仓' : '减仓',
      amount: gross * rateAt(tx.currency ?? asset.currency, tx.occurredAt),
      quantity,
      afterReturnPct: result.pct,
      note: tx.note ?? null,
    })
  }
  return decisions.sort((a, b) => b.date.localeCompare(a.date))
}

function exposureAt(
  assets: ReviewAssetInput[],
  date: string,
  total: number,
): { topOne: number; topThree: number; cash: number; foreign: number } {
  if (total <= 0) return { topOne: 0, topThree: 0, cash: 0, foreign: 0 }
  const values = assets.map((asset) => ({ asset, value: Math.max(0, valueAt(asset.series, date)) }))
  const market = values.filter((entry) => entry.asset.cls !== 'CASH').sort((a, b) => b.value - a.value)
  return {
    topOne: (market[0]?.value ?? 0) / total,
    topThree: market.slice(0, 3).reduce((sum, entry) => sum + entry.value, 0) / total,
    cash: values.filter((entry) => entry.asset.cls === 'CASH').reduce((sum, entry) => sum + entry.value, 0) / total,
    foreign: values.filter((entry) => entry.asset.currency !== 'CNY').reduce((sum, entry) => sum + entry.value, 0) / total,
  }
}

export function buildReviewResult({
  portfolioSeries,
  assets,
  transactions,
  startDate,
  endDate,
  label,
  benchmarkPct = null,
  rateAt = () => 1,
}: {
  portfolioSeries: PerformancePoint[]
  assets: ReviewAssetInput[]
  transactions: LedgerTx[]
  startDate: string
  endDate: string
  label: string
  benchmarkPct?: number | null
  rateAt?: (currency: string, date: Date) => number
}): ReviewResult {
  const performance = performanceBetween(portfolioSeries, startDate, endDate, label)
  const basisDate = performance.basisDate ?? startDate
  const actualEndDate = performance.endDate ?? endDate
  const periodTxs = periodTransactions(transactions, startDate, actualEndDate)
  const assetDaily: DailyBuckets = new Map()
  const sourceDaily: DailyBuckets = new Map()
  const assetRows: ReviewContribution[] = []

  for (const asset of assets) {
    const assetPerformance = performanceBetween(asset.series, startDate, actualEndDate, asset.name)
    const relevantTxs = periodTxs.filter((tx) => tx.assetId === asset.assetId)
    const incomeAmount = relevantTxs.reduce(
      (sum, tx) => sum + transactionIncome(tx, rateAt(tx.currency ?? asset.currency, tx.occurredAt)),
      0,
    )
    const feeAmount = relevantTxs.reduce(
      (sum, tx) => sum + transactionFee(tx, rateAt(tx.currency ?? asset.currency, tx.occurredAt)),
      0,
    )
    for (const point of assetPerformance.curve) {
      if (point.dailyAmount != null) addDaily(assetDaily, point.date, asset.assetId, point.dailyAmount)
    }
    const startWeight = performance.baseNetWorth && performance.baseNetWorth > 0
      ? valueAt(asset.series, basisDate) / performance.baseNetWorth
      : null
    const endWeight = performance.endNetWorth && performance.endNetWorth > 0
      ? valueAt(asset.series, actualEndDate) / performance.endNetWorth
      : null
    const amount = finiteOrZero(assetPerformance.amount)
    assetRows.push({
      key: asset.assetId,
      name: asset.name,
      code: asset.symbol,
      amount,
      contributionPct: null,
      returnPct: assetPerformance.pct,
      averageWeight: startWeight != null && endWeight != null ? (startWeight + endWeight) / 2 : startWeight ?? endWeight,
      tradeCount: relevantTxs.filter((tx) => !tx.internal && (tx.type === 'BUY' || tx.type === 'SELL')).length,
      marketAmount: amount - incomeAmount - feeAmount,
      incomeAmount,
      feeAmount,
      cls: asset.cls,
      style: asset.style,
      currency: asset.currency,
    })
  }

  for (let index = 1; index < performance.curve.length; index++) {
    const point = performance.curve[index]
    if (point.dailyAmount == null) continue
    const assetAmounts = assetDaily.get(point.date) ?? new Map()
    const assetTotal = [...assetAmounts.values()].reduce((sum, amount) => sum + amount, 0)
    let income = 0
    let fees = 0
    for (const tx of periodTxs.filter((item) => dateKeyAt(item.occurredAt) === point.date)) {
      const rate = rateAt(tx.currency ?? 'CNY', tx.occurredAt)
      income += transactionIncome(tx, rate)
      fees += transactionFee(tx, rate)
    }
    addDaily(sourceDaily, point.date, 'MARKET', assetTotal - income - fees)
    addDaily(sourceDaily, point.date, 'INCOME', income)
    addDaily(sourceDaily, point.date, 'FEES', fees)
    addDaily(sourceDaily, point.date, 'RECONCILIATION', point.dailyAmount - assetTotal)
    addDaily(assetDaily, point.date, 'RECONCILIATION', point.dailyAmount - assetTotal)
  }

  const assetLinked = linkedContributionPct(performance, assetDaily)
  for (const row of assetRows) row.contributionPct = assetLinked.get(row.key) ?? 0
  const assetAmount = assetRows.reduce((sum, row) => sum + row.amount, 0)
  const attributedPct = assetRows.reduce((sum, row) => sum + finiteOrZero(row.contributionPct), 0)
  const reconciliationAmount = finiteOrZero(performance.amount) - assetAmount
  const reconciliationPct = assetLinked.get('RECONCILIATION') ?? 0
  const reconciliationMagnitude = Math.abs(reconciliationPct)
  const reconciliationStatus = Math.abs(reconciliationAmount) < 0.005 || reconciliationMagnitude < 0.001
    ? 'MATCHED'
    : reconciliationMagnitude < 0.005 ? 'MINOR' : 'REVIEW'

  const sourceLinked = linkedContributionPct(performance, sourceDaily)
  const sourceKeys: ReviewSourceContribution['key'][] = ['MARKET', 'INCOME', 'FEES', 'RECONCILIATION']
  const sourceNames: Record<ReviewSourceContribution['key'], string> = {
    MARKET: '市场价格与汇率',
    INCOME: '分红与利息',
    FEES: '交易费用',
    RECONCILIATION: '待对账差额',
  }
  const sourceAmounts = new Map<ReviewSourceContribution['key'], number>()
  for (const day of sourceDaily.values()) {
    for (const key of sourceKeys) sourceAmounts.set(key, (sourceAmounts.get(key) ?? 0) + (day.get(key) ?? 0))
  }
  const sources = sourceKeys.map((key) => ({
    key,
    name: sourceNames[key],
    amount: sourceAmounts.get(key) ?? 0,
    contributionPct: sourceLinked.get(key) ?? 0,
  }))

  const classMap = new Map<ReviewClassContribution['key'], ReviewClassContribution>()
  for (const row of assetRows) {
    const key = row.cls!
    const current = classMap.get(key) ?? { key, amount: 0, contributionPct: 0, averageWeight: 0 }
    current.amount += row.amount
    current.contributionPct = finiteOrZero(current.contributionPct) + finiteOrZero(row.contributionPct)
    current.averageWeight = finiteOrZero(current.averageWeight) + finiteOrZero(row.averageWeight)
    classMap.set(key, current)
  }

  const decisions = buildDecisions(transactions, assets, startDate, actualEndDate, rateAt)
  const buyAmount = decisions.filter((item) => item.action === '建仓' || item.action === '加仓').reduce((sum, item) => sum + item.amount, 0)
  const sellAmount = decisions.filter((item) => item.action === '减仓' || item.action === '清仓').reduce((sum, item) => sum + item.amount, 0)
  const tradingFees = periodTxs
    .filter((tx) => !tx.internal && (tx.type === 'BUY' || tx.type === 'SELL' || tx.type === 'FEE'))
    .reduce((sum, tx) => sum - transactionFee(tx, rateAt(tx.currency ?? 'CNY', tx.occurredAt)), 0)
  const averageCapital = performance.baseNetWorth != null && performance.endNetWorth != null
    ? (performance.baseNetWorth + performance.endNetWorth) / 2
    : null
  const behavior: ReviewBehavior = {
    decisions,
    buyAmount,
    sellAmount,
    turnover: averageCapital && averageCapital > 0 ? (buyAmount + sellAmount) / averageCapital : null,
    feeRate: buyAmount + sellAmount > 0 ? tradingFees / (buyAmount + sellAmount) : null,
  }

  const startExposure = exposureAt(assets, basisDate, performance.baseNetWorth ?? 0)
  const endExposure = exposureAt(assets, actualEndDate, performance.endNetWorth ?? 0)
  const endPoint = performance.curve.at(-1)
  const valuationGapStart = portfolioSeries.find((point) => point.date === basisDate)?.valuationCoverage
  const valuationGapEnd = endPoint?.valuationCoverage
  const risks: ReviewRiskPoint[] = [
    { key: 'TOP_ONE', start: startExposure.topOne, end: endExposure.topOne },
    { key: 'TOP_THREE', start: startExposure.topThree, end: endExposure.topThree },
    { key: 'CASH', start: startExposure.cash, end: endExposure.cash },
    { key: 'FOREIGN', start: startExposure.foreign, end: endExposure.foreign },
    { key: 'VALUATION_GAP', start: valuationGapStart == null ? 0 : 1 - valuationGapStart, end: valuationGapEnd == null ? 0 : 1 - valuationGapEnd },
  ]

  return {
    performance,
    benchmarkPct,
    alphaPct: performance.pct != null && benchmarkPct != null ? performance.pct - benchmarkPct : null,
    assets: assetRows.sort((a, b) => b.amount - a.amount),
    sources,
    classes: [...classMap.values()].sort((a, b) => b.amount - a.amount),
    attributedAmount: assetAmount,
    attributedPct,
    reconciliationAmount,
    reconciliationPct,
    reconciliationStatus,
    timing: reviewTiming(performance),
    behavior,
    risks,
    maxDrawdown: riskMetrics(performance.curve).maxDrawdown,
    valuationCoverage: endPoint?.valuationCoverage ?? null,
    latestValuationDate: endPoint?.latestValuationDate ?? null,
    valuationGapCount: endPoint?.valuationGaps?.length ?? 0,
  }
}
