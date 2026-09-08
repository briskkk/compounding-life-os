// Investment Intelligence · 长期复盘纯引擎（P0）
// 全部可投资资产结果桥、范围解析、TWR/回撤资格与真实截止日、证据水位。
// 纯函数：只消费流水/资产日序列与派生输入，不依赖 Prisma、React、网络。
import { xirr, type XirrFlow } from './attribution'
import type { AssetClass } from './types'
import { performanceBetween, type PerformanceCurvePoint, type PerformancePoint } from './period-performance'
import { riskMetrics } from './risk'

export type HistoryScope =
  | 'INCEPTION' // 成立以来（首笔有效可投资资产流水起）
  | 'FIVE_YEAR' // 近五年
  | { year: string } // 自然年，如 '2022'

export interface HistoryRange {
  label: string
  scope: HistoryScope
  startDate: string // YYYY-MM-DD（含）
  endDate: string // YYYY-MM-DD（含）
  /** 可投资组合首笔有效流水日（成立以来） */
  inceptionDate: string
}

const YEAR = /^\d{4}$/

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function shiftYear(key: string, delta: number): string {
  const date = new Date(`${key}T00:00:00Z`)
  date.setUTCFullYear(date.getUTCFullYear() + delta)
  return date.toISOString().slice(0, 10)
}

export function resolveHistoryRange(
  scope: HistoryScope,
  now = new Date(),
  inceptionDate?: string,
): HistoryRange {
  const today = dateKey(now)
  const inception = inceptionDate ?? today
  if (scope === 'INCEPTION') {
    return { label: '成立以来', scope, startDate: inception, endDate: today, inceptionDate: inception }
  }
  if (scope === 'FIVE_YEAR') {
    const fiveYearsAgo = shiftYear(today, -5)
    const start = inception > fiveYearsAgo ? inception : fiveYearsAgo
    return { label: '近五年', scope, startDate: start, endDate: today, inceptionDate: inception }
  }
  const year = YEAR.test(scope.year) ? scope.year : today.slice(0, 4)
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const endDate = end > today ? today : end
  return { label: `${Number(year)} 年`, scope, startDate: start, endDate, inceptionDate: inception }
}

/**
 * 把多只基金资产日序列合并为基金子组合（FUND_SLEEVE）日序列。
 * 基金资产日序列的 contributions 已含“该基金投资者现金流”（BUY+、SELL−、现金分红−、
 * 申购费并入），求和即为子组合净投入累计；现金不属于子组合，因此在途赎回不回到基金市值。
 */
export function buildInvestablePortfolioSeries(
  assetSeries: Array<{ assetId: string; series: PerformancePoint[] }>,
  startDate: string,
  endDate: string,
): PerformancePoint[] {
  const dates = new Set<string>()
  const byAsset = assetSeries.map((asset) => {
    const byDate = new Map(asset.series.map((point) => [point.date, point]))
    return { assetId: asset.assetId, byDate }
  })
  for (const { byDate } of byAsset) {
    for (const date of byDate.keys()) {
      if (date >= startDate && date <= endDate) dates.add(date)
    }
  }
  const result: PerformancePoint[] = [...dates].sort().map((date) => {
    let netWorth = 0
    let contributions = 0
    let valued = 0
    let settled = 0
    let partial = 0
    let stale = 0 // CLOSED/NO_UPDATE/FLOW_ONLY 但有市值
    let coverageValue = 0
    let coveragePriced = 0
    let latestValuationDate: string | null = null
    const valuationGaps = [] as NonNullable<PerformancePoint['valuationGaps']>
    for (const { byDate } of byAsset) {
      const point = byDate.get(date)
      if (!point) continue
      netWorth += point.netWorth
      contributions += point.contributions
      if (Math.abs(point.netWorth) < 1e-6) continue
      valued += 1
      const status = point.valuationStatus
      if (status == null || status === 'SETTLED' || status === 'LIVE') settled += 1
      else if (status === 'PARTIAL') partial += 1
      else stale += 1
      const value = Math.abs(point.netWorth)
      coverageValue += value
      coveragePriced += (point.valuationCoverage ?? 0) * value
      // sleeve 只需要保留会阻断计算的 NO_PRICE；休市/待更新已由状态与覆盖率表达，
      // 避免在五年日序列中重复保留数万个缺口对象。
      valuationGaps.push(...(point.valuationGaps ?? []).filter((gap) => gap.reason === 'NO_PRICE'))
      if (point.latestValuationDate && (!latestValuationDate || point.latestValuationDate > latestValuationDate)) {
        latestValuationDate = point.latestValuationDate
      }
    }
    const valuationStatus = valued === 0
      ? 'NO_UPDATE'
      : settled > 0 && partial === 0 && stale === 0 ? 'SETTLED'
      : partial > 0 ? 'PARTIAL'
      : settled > 0 ? 'PARTIAL' // 部分有当日价、部分沿用旧价
      : 'CLOSED'
    return {
      date,
      netWorth: Math.round(netWorth * 100) / 100,
      contributions: Math.round(contributions * 100) / 100,
      valuationStatus,
      valuationCoverage: coverageValue > 0 ? coveragePriced / coverageValue : null,
      latestValuationDate,
      valuationGaps,
    }
  })
  return result
}

/** @deprecated 兼容旧测试/调用；新代码使用 buildInvestablePortfolioSeries。 */
export const buildFundSleeveSeries = buildInvestablePortfolioSeries

export interface PortfolioFlowSummary {
  deposits: number // 组合外存入
  withdrawals: number // 组合外取出
  buys: number // 主腿买入金额（活动统计，不进入净投入）
  sells: number // 主腿卖出到账（活动统计，不进入净投入）
  dividends: number // 现金分红合计
  fees: number // 主腿费用 + 独立 FEE
  interestIncome: number // 利息收入合计
}

export interface ResultBridge {
  openingValue: number | null // 期初可投资资产（成立以来为 0）
  netInflow: number | null // 区间外部净投入；内部买卖及结算腿不计入
  investGain: number | null // 投资收益 = 期末 − 期初 − 外部净投入
  endingValue: number | null // 期末可投资资产
}

/** TWR 与资格：净值链不完整时不得把较早净值标成当前截止日。
 *  - ELIGIBLE：最后有效收益观察日等于范围截止日
 *  - PARTIAL：范围尾部缺少新净值（最后有效观察日早于截止日），asOf 显示真实截止日
 *  - BLOCKED：无任何有效收益观察点
 */
export interface TwrEvidence {
  pct: number | null // 区间累计 TWR
  annualizedPct: number | null
  asOf: string | null // TWR 真实有效到哪一天
  status: 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED'
  observedDays: number
  limitations: string[]
}

export interface XirrEvidence {
  pct: number | null
  asOf: string | null
  status: 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED'
  cashFlowCount: number
  pendingPurchaseCount: number
  limitations: string[]
}

export interface DrawdownEvidence {
  maxDrawdown: number | null
  annualizedVolatility: number | null
  returnDrawdownRatio: number | null
  peakDate: string | null
  troughDate: string | null
  recoveryDate: string | null
  longestUnderwaterDays: number | null
  longestUnderwaterStartDate: string | null
  longestUnderwaterEndDate: string | null
  longestUnderwaterRecovered: boolean | null
  asOf: string | null
  status: 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED'
  observedDays: number
  limitations: string[]
}

export function twrEvidence(series: PerformancePoint[], startDate: string, endDate: string): TwrEvidence {
  const performance = performanceBetween(series, startDate, endDate, '长期')
  const observed = performance.curve.filter((point) => point.dailyPct != null)
  const lastObserved = observed.at(-1)
  if (!lastObserved || performance.curve.length < 2) {
    return {
      pct: null,
      annualizedPct: null,
      asOf: null,
      status: 'BLOCKED',
      observedDays: observed.length,
      limitations: ['区间内没有可用的净值收益观察点，TWR 不可计算'],
    }
  }
  const asOf = lastObserved.latestValuationDate ?? lastObserved.date
  const trailing = performance.curve.at(-1)
  const noPriceGap = lastObserved.valuationGaps?.some((gap) => gap.reason === 'NO_PRICE') ?? false
  const staleTail = trailing != null && asOf < endDate
  const partialObservation = lastObserved.valuationStatus === 'PARTIAL'
    || (lastObserved.valuationCoverage != null && lastObserved.valuationCoverage < 0.999999)
  const status: TwrEvidence['status'] = noPriceGap ? 'BLOCKED' : staleTail || partialObservation ? 'PARTIAL' : 'ELIGIBLE'
  const limitations: string[] = []
  if (noPriceGap) {
    limitations.push('存在持仓资产无任何可用价格，TWR 不可确定性计算')
  }
  if (staleTail) {
    limitations.push(`净值链在 ${asOf} 后不完整：TWR 只计算到真实截止日 ${asOf}，不早于 ${endDate} 冒充当前结果`)
  }
  if (trailing?.valuationStatus && ['PARTIAL', 'NO_UPDATE', 'CLOSED'].includes(trailing.valuationStatus)) {
    limitations.push(`期末组合估值状态为 ${trailing.valuationStatus}，结果仅代表到 ${asOf} 的观察区间`)
  }
  const spanDays = Math.max(1, (new Date(`${asOf}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86400000)
  const pct = performance.pct ?? null
  const annualizedPct = pct != null && pct > -1 ? Math.pow(1 + pct, 365 / spanDays) - 1 : null
  return { pct, annualizedPct, asOf, status, observedDays: observed.length, limitations }
}

function utcDateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`)
}

function daysBetween(start: string, end: string): number {
  return Math.max(0, Math.round((utcDateFromKey(end).getTime() - utcDateFromKey(start).getTime()) / 86400000))
}

/**
 * 可投资组合 XIRR：区间期初资产视为起日投入，区间内只纳入真实外部存入/取出，
 * 内部买卖和结算腿不作为资金流；期末可投资资产作为终值。
 */
export function xirrEvidence(input: {
  flows: XirrFlow[]
  openingValue: number
  openingDate: string
  endingValue: number | null
  terminalDate: string
  valuationAsOf: string | null
  valuationStatus: 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED'
  pendingPurchaseCount?: number
}): XirrEvidence {
  const pendingPurchaseCount = input.pendingPurchaseCount ?? 0
  const flows = [...input.flows]
  if (input.openingValue > 0) {
    flows.push({ date: utcDateFromKey(input.openingDate), amount: -input.openingValue })
  }
  flows.sort((a, b) => a.date.getTime() - b.date.getTime())

  const limitations: string[] = []
  if (input.valuationStatus === 'BLOCKED' || input.endingValue == null) {
    return {
      pct: null,
      asOf: input.valuationAsOf,
      status: 'BLOCKED',
      cashFlowCount: flows.length,
      pendingPurchaseCount,
      limitations: ['期末可投资资产不可确定，XIRR 不可计算'],
    }
  }

  const allAmounts = [...flows.map((flow) => flow.amount), input.endingValue]
  const hasInvestment = allAmounts.some((amount) => amount < -0.000001)
  const hasRecovery = allAmounts.some((amount) => amount > 0.000001)
  const distinctDates = new Set([...flows.map((flow) => flow.date.toISOString().slice(0, 10)), input.terminalDate])
  if (!hasInvestment || !hasRecovery || distinctDates.size < 2) {
    return {
      pct: null,
      asOf: input.valuationAsOf,
      status: 'BLOCKED',
      cashFlowCount: flows.length,
      pendingPurchaseCount,
      limitations: ['现金流缺少跨日期的投入与回收两端，XIRR 不可求解'],
    }
  }

  const pct = xirr(flows, input.endingValue, utcDateFromKey(input.terminalDate))
  if (pct == null || !Number.isFinite(pct)) {
    return {
      pct: null,
      asOf: input.valuationAsOf,
      status: 'BLOCKED',
      cashFlowCount: flows.length,
      pendingPurchaseCount,
      limitations: ['当前现金流不存在可稳定求解的 XIRR'],
    }
  }

  if (input.valuationStatus === 'PARTIAL') {
    limitations.push(`期末价值使用混合净值日期，XIRR 只能限定引用至估值证据 ${input.valuationAsOf ?? input.terminalDate}`)
  }
  if (pendingPurchaseCount > 0) {
    limitations.push(`${pendingPurchaseCount} 笔待确认申购仅按已知本金计入期末在途资产，不生成份额收益`)
  }
  return {
    pct,
    asOf: input.valuationAsOf,
    status: input.valuationStatus === 'PARTIAL' || pendingPurchaseCount > 0 ? 'PARTIAL' : 'ELIGIBLE',
    cashFlowCount: flows.length,
    pendingPurchaseCount,
    limitations,
  }
}

/** TWR 累计净值曲线上的最大回撤与最长水下期；现金流已由 TWR 路径剔除。 */
export function drawdownEvidence(
  curve: PerformanceCurvePoint[],
  twr: TwrEvidence,
): DrawdownEvidence {
  const limitations = [...twr.limitations]
  if (twr.status === 'BLOCKED' || !twr.asOf) {
    return {
      maxDrawdown: null,
      annualizedVolatility: null,
      returnDrawdownRatio: null,
      peakDate: null,
      troughDate: null,
      recoveryDate: null,
      longestUnderwaterDays: null,
      longestUnderwaterStartDate: null,
      longestUnderwaterEndDate: null,
      longestUnderwaterRecovered: null,
      asOf: twr.asOf,
      status: 'BLOCKED',
      observedDays: twr.observedDays,
      limitations: limitations.length > 0 ? limitations : ['缺少有效 TWR 路径，回撤与恢复期不可计算'],
    }
  }

  const asOf = twr.asOf
  const points = curve.filter((point) => point.date <= asOf && Number.isFinite(point.pct) && 1 + point.pct > 0)
  if (points.length < 2 || twr.observedDays < 1) {
    return {
      maxDrawdown: null,
      annualizedVolatility: null,
      returnDrawdownRatio: null,
      peakDate: null,
      troughDate: null,
      recoveryDate: null,
      longestUnderwaterDays: null,
      longestUnderwaterStartDate: null,
      longestUnderwaterEndDate: null,
      longestUnderwaterRecovered: null,
      asOf,
      status: 'BLOCKED',
      observedDays: twr.observedDays,
      limitations: ['有效 TWR 路径不足两个时点，回撤与恢复期不可计算'],
    }
  }

  const EPSILON = 1e-12
  let peakLevel = 1 + points[0].pct
  let peakDate = points[0].date
  let maxDrawdown = 0
  let maxPeakDate = peakDate
  let troughDate = peakDate
  let maxPeakLevel = peakLevel
  let underwaterStart: string | null = null
  let longestDays = 0
  let longestStart: string | null = null
  let longestEnd: string | null = null
  let longestRecovered: boolean | null = null

  const considerUnderwater = (start: string, end: string, recovered: boolean) => {
    const days = daysBetween(start, end)
    if (days > longestDays) {
      longestDays = days
      longestStart = start
      longestEnd = end
      longestRecovered = recovered
    }
  }

  for (const point of points.slice(1)) {
    const level = 1 + point.pct
    if (level + EPSILON >= peakLevel) {
      if (underwaterStart) considerUnderwater(underwaterStart, point.date, true)
      underwaterStart = null
      if (level > peakLevel + EPSILON) {
        peakLevel = level
        peakDate = point.date
      }
      continue
    }

    if (!underwaterStart) underwaterStart = peakDate
    const drawdown = level / peakLevel - 1
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown
      maxPeakDate = peakDate
      maxPeakLevel = peakLevel
      troughDate = point.date
    }
  }
  if (underwaterStart) considerUnderwater(underwaterStart, asOf, false)

  const recovery = points.find((point) => point.date > troughDate && 1 + point.pct + EPSILON >= maxPeakLevel)
  const risk = riskMetrics(points)
  const returnDrawdownRatio = twr.annualizedPct != null && maxDrawdown < -EPSILON
    ? twr.annualizedPct / Math.abs(maxDrawdown)
    : null
  return {
    maxDrawdown,
    annualizedVolatility: risk.volatility,
    returnDrawdownRatio,
    peakDate: maxPeakDate,
    troughDate,
    recoveryDate: maxDrawdown < 0 ? recovery?.date ?? null : peakDate,
    longestUnderwaterDays: longestStart ? longestDays : 0,
    longestUnderwaterStartDate: longestStart,
    longestUnderwaterEndDate: longestEnd,
    longestUnderwaterRecovered: longestStart ? longestRecovered : true,
    asOf,
    status: twr.status,
    observedDays: twr.observedDays,
    limitations,
  }
}

export interface MetricEvidence {
  key: string
  label: string
  status: 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED'
  eligibleCount: number
  totalCount: number
  coveragePct: number | null
  asOf: string | null
  methodVersion: string
  limitations: string[]
}

export interface EvidenceWatermark {
  ledgerWatermark: string
  priceWatermark: string | null
  asOf: string
  methodVersion: string
}

export interface HistoryResult {
  range: HistoryRange
  sleeveSeries: PerformancePoint[]
  bridge: ResultBridge
  flows: PortfolioFlowSummary
  twr: TwrEvidence
  xirr: XirrEvidence
  drawdown: DrawdownEvidence
  metrics: MetricEvidence[]
  watermark: EvidenceWatermark
}

/**
 * P0 长期复盘结果：桥 + TWR/回撤资格 + 数据资格矩阵。
 * 金额路径：期初价值（sleeve base） + 净投入（flows 汇总） + 投资收益 = 期末价值；
 * 用 performanceBetween 在同一条 sleeve 序列上验证金额与 TWR 的同源。
 */
export function investmentHistoryResult(input: {
  range: HistoryRange
  sleeveSeries: PerformancePoint[]
  flows: PortfolioFlowSummary
  xirrFlows?: XirrFlow[]
  pendingPurchaseCount?: number
  watermark: EvidenceWatermark
}): HistoryResult {
  const { range, sleeveSeries, flows, watermark } = input

  // 期初/期末可投资资产：期初取范围起点前最近组合点（成立以来 = 0，起点前无持仓）
  const openingPoint = range.scope === 'INCEPTION'
    ? null
    : [...sleeveSeries].filter((point) => point.date < range.startDate).at(-1)
  const endingPoint = [...sleeveSeries].filter((point) => point.date <= range.endDate).at(-1)
  const openingValue = range.scope === 'INCEPTION'
    ? 0
    : openingPoint
      ? openingPoint.netWorth
      : 0
  const endingValue = endingPoint?.netWorth ?? null
  const openingContributions = openingPoint?.contributions ?? 0
  const endingContributions = endingPoint?.contributions ?? null
  // 组合曲线的 contributions 已把基金/ETF/股票买卖与现金结算腿互相抵消，
  // 这里只取累计贡献差额，避免把组合内部换仓误当成新增投入。
  const netInflow = endingContributions == null ? null : endingContributions - openingContributions
  const investGain = openingValue != null && endingValue != null && netInflow != null
    ? endingValue - openingValue - netInflow
    : null

  const twr = twrEvidence(sleeveSeries, range.startDate, range.endDate)
  const drawdownCurve = performanceBetween(sleeveSeries, range.startDate, range.endDate, '长期').curve

  const hasNoPriceGap = endingPoint?.valuationGaps?.some((gap) => gap.reason === 'NO_PRICE') ?? false
  const bridgeCoverage = endingPoint?.valuationCoverage ?? null
  const bridgeHasCurrentValuation = endingPoint != null
    && ['SETTLED', 'LIVE'].includes(endingPoint.valuationStatus ?? 'SETTLED')
    && (bridgeCoverage == null || bridgeCoverage >= 0.999999)
  const bridgeStatus: MetricEvidence['status'] = endingValue == null || hasNoPriceGap
    ? 'BLOCKED'
    : bridgeHasCurrentValuation ? 'ELIGIBLE' : 'PARTIAL'
  const bridgeLimitations: string[] = []
  if (endingValue == null) bridgeLimitations.push('期末可投资资产缺失，结果桥不可计算')
  if (hasNoPriceGap) bridgeLimitations.push('存在持仓资产无任何可用价格，结果桥不可发布')
  if (bridgeStatus === 'PARTIAL') {
    bridgeLimitations.push(`期末估值为混合价格日期，截止日实时估值覆盖 ${((bridgeCoverage ?? 0) * 100).toFixed(1)}%；金额只能按各资产最近可得价格限定引用`)
  }

  const xirrResult = xirrEvidence({
    flows: input.xirrFlows ?? [],
    openingValue,
    openingDate: range.startDate,
    endingValue,
    terminalDate: range.endDate,
    valuationAsOf: endingPoint?.latestValuationDate ?? endingPoint?.date ?? null,
    valuationStatus: bridgeStatus,
    pendingPurchaseCount: input.pendingPurchaseCount,
  })
  const drawdown = drawdownEvidence(drawdownCurve, twr)
  const riskStatisticsStatus: MetricEvidence['status'] = drawdown.annualizedVolatility == null
    ? 'BLOCKED'
    : drawdown.returnDrawdownRatio == null ? 'PARTIAL' : drawdown.status
  const riskStatisticsLimitations = drawdown.annualizedVolatility == null
    ? ['有效日收益样本不足两个，年化波动率与收益回撤比不可计算']
    : drawdown.returnDrawdownRatio == null
      ? ['区间内没有负回撤，收益回撤比缺少有效分母；年化波动率仍可引用']
      : drawdown.limitations
  const rangePointCount = sleeveSeries.filter((point) => point.date >= range.startDate && point.date <= range.endDate).length
  const pathCoverage = rangePointCount > 0 ? twr.observedDays / rangePointCount : null
  const riskEligibleCount = drawdown.annualizedVolatility == null ? 0 : drawdown.observedDays
  const riskCoverage = rangePointCount > 0 ? riskEligibleCount / rangePointCount : null
  const xirrEligibleCount = xirrResult.status === 'BLOCKED'
    ? 0
    : Math.max(0, xirrResult.cashFlowCount - xirrResult.pendingPurchaseCount)
  const xirrCoverage = xirrResult.cashFlowCount > 0
    ? xirrEligibleCount / xirrResult.cashFlowCount
    : null

  const metrics: MetricEvidence[] = [
    {
      key: 'bridge',
      label: '结果桥（金额）',
      status: bridgeStatus,
      eligibleCount: bridgeStatus === 'ELIGIBLE' ? 1 : 0,
      totalCount: 1,
      coveragePct: bridgeCoverage,
      asOf: endingPoint?.latestValuationDate ?? endingPoint?.date ?? null,
      methodVersion: watermark.methodVersion,
      limitations: bridgeLimitations,
    },
    {
      key: 'twr',
      label: 'TWR（净值路径）',
      status: twr.status,
      eligibleCount: twr.observedDays,
      totalCount: rangePointCount,
      coveragePct: pathCoverage,
      asOf: twr.asOf,
      methodVersion: watermark.methodVersion,
      limitations: twr.limitations,
    },
    {
      key: 'xirr',
      label: 'XIRR（资金体验）',
      status: xirrResult.status,
      eligibleCount: xirrEligibleCount,
      totalCount: xirrResult.cashFlowCount,
      coveragePct: xirrCoverage,
      asOf: xirrResult.asOf,
      methodVersion: watermark.methodVersion,
      limitations: xirrResult.limitations,
    },
    {
      key: 'drawdown',
      label: '最大回撤与恢复期',
      status: drawdown.status,
      eligibleCount: drawdown.observedDays,
      totalCount: rangePointCount,
      coveragePct: pathCoverage,
      asOf: drawdown.asOf,
      methodVersion: watermark.methodVersion,
      limitations: drawdown.limitations,
    },
    {
      key: 'risk-statistics',
      label: '波动率与收益回撤比',
      status: riskStatisticsStatus,
      eligibleCount: riskEligibleCount,
      totalCount: rangePointCount,
      coveragePct: riskCoverage,
      asOf: drawdown.asOf,
      methodVersion: watermark.methodVersion,
      limitations: riskStatisticsLimitations,
    },
  ]

  return {
    range,
    sleeveSeries,
    bridge: { openingValue, netInflow, investGain, endingValue },
    flows,
    twr,
    xirr: xirrResult,
    drawdown,
    metrics,
    watermark,
  }
}

/* ============ P0 扩展：年度路径 / 贡献归因 / 决策时间带数据 ============ */

export interface AnnualPathRow {
  /** 自然年 */
  year: number
  /** 年度区间（首尾年可能只覆盖部分自然年） */
  startDate: string
  endDate: string
  openingValue: number | null
  netInflow: number | null
  investGain: number | null
  endingValue: number | null
  twr: TwrEvidence
}

export interface MonthlyPathRow {
  month: string
  startDate: string
  endDate: string
  openingValue: number | null
  netInflow: number | null
  investGain: number | null
  endingValue: number | null
  twr: TwrEvidence
}

/** 从 sleeve 日序列切出某年的首尾基准（年份不足当年则取当年内最优点）。 */
function sliceYears(rangeStart: string, rangeEnd: string): Array<{ startDate: string; endDate: string }> {
  const startYear = Number(rangeStart.slice(0, 4))
  const endYear = Number(rangeEnd.slice(0, 4))
  const out: Array<{ startDate: string; endDate: string }> = []
  for (let year = startYear; year <= endYear; year++) {
    const start = year === startYear ? rangeStart : `${year}-01-01`
    const end = year === endYear ? rangeEnd : `${year}-12-31`
    if (start <= end) out.push({ startDate: start, endDate: end })
  }
  return out
}

/** 年度路径：每个自然年在 sleeve 序列上的净投入 / 投资收益 / 期末价值与年度 TWR。 */
export function annualPath(series: PerformancePoint[], rangeStart: string, rangeEnd: string): AnnualPathRow[] {
  return sliceYears(rangeStart, rangeEnd).map(({ startDate, endDate }) => {
    const perf = performanceBetween(series, startDate, endDate, `${endDate.slice(0, 4)} 年`)
    const twr = twrEvidence(series, startDate, endDate)
    return {
      year: Number(startDate.slice(0, 4)),
      startDate: perf.startDate ?? startDate,
      endDate: perf.endDate ?? endDate,
      openingValue: perf.baseNetWorth,
      netInflow: perf.netFlow,
      investGain: perf.amount,
      endingValue: perf.endNetWorth,
      twr,
    }
  })
}

function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 7)
}

/** 月度路径：首尾月允许部分月；每月金额桥与 TWR 都复用同一 sleeve 证据链。 */
export function monthlyPath(series: PerformancePoint[], rangeStart: string, rangeEnd: string): MonthlyPathRow[] {
  const rows: MonthlyPathRow[] = []
  let month = rangeStart.slice(0, 7)
  const lastMonth = rangeEnd.slice(0, 7)
  while (month <= lastMonth) {
    const calendarStart = `${month}-01`
    const startDate = calendarStart < rangeStart ? rangeStart : calendarStart
    const calendarEnd = monthEnd(month)
    const endDate = calendarEnd > rangeEnd ? rangeEnd : calendarEnd
    const performance = performanceBetween(series, startDate, endDate, month)
    rows.push({
      month,
      startDate: performance.startDate ?? startDate,
      endDate: performance.endDate ?? endDate,
      openingValue: performance.baseNetWorth,
      netInflow: performance.netFlow,
      investGain: performance.amount,
      endingValue: performance.endNetWorth,
      twr: twrEvidence(series, startDate, endDate),
    })
    month = nextMonth(month)
  }
  return rows
}

export interface FundContributionInput {
  key: string
  name: string
  symbol: string
  /** 资产风格（策略桶）；null = 未分类 */
  style: string | null
  qdii: boolean
  assetClass?: AssetClass
  marketLabel?: string
  series: PerformancePoint[]
}

export interface FundContributionRow {
  key: string
  name: string
  symbol: string
  style: string | null
  qdii: boolean
  assetClass: AssetClass
  marketLabel: string
  /** 区间投资收益金额 = 期末 − 期初 − 区间净投入（ADR-014 同源） */
  amount: number | null
  /** 区间收益率（该基金 TWR） */
  returnPct: number | null
  /** 对 sleeve 投资收益的贡献占比（金额口径，仅 sleeveInvestGain > 0 时） */
  contributionPct: number | null
}

export interface ContributionResult {
  rows: FundContributionRow[]
  /** 已归属金额合计 */
  attributedAmount: number
  /** 无法确定性归因的基金数 */
  blockedCount: number
  /** sleeve 投资收益 − 已归属合计；ADR-014：残差独立展示，不摊入基金 */
  reconciliationAmount: number | null
}

/** 单基金贡献：每只基金在区间内的收益金额与收益率；残差按 ADR-014 独立对账。 */
export function fundContributions(input: {
  assets: FundContributionInput[]
  startDate: string
  endDate: string
  sleeveInvestGain: number | null
}): ContributionResult {
  const rows: FundContributionRow[] = []
  for (const asset of input.assets) {
    const perf = performanceBetween(asset.series, input.startDate, input.endDate, asset.name)
    const amount = perf.amount != null && Number.isFinite(perf.amount) ? perf.amount : null
    rows.push({
      key: asset.key,
      name: asset.name,
      symbol: asset.symbol,
      style: asset.style,
      qdii: asset.qdii,
      assetClass: asset.assetClass ?? 'FUND',
      marketLabel: asset.marketLabel ?? (asset.qdii ? 'QDII（境外市场）' : '境内市场'),
      amount,
      returnPct: perf.pct,
      contributionPct: amount != null && input.sleeveInvestGain != null && input.sleeveInvestGain > 0
        ? amount / input.sleeveInvestGain
        : null,
    })
  }
  rows.sort((a, b) => (b.amount ?? Number.NEGATIVE_INFINITY) - (a.amount ?? Number.NEGATIVE_INFINITY))
  const attributedAmount = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const blockedCount = rows.filter((row) => row.amount == null).length
  const reconciliationAmount = input.sleeveInvestGain != null && blockedCount === 0
    ? input.sleeveInvestGain - attributedAmount
    : null
  return { rows, attributedAmount, blockedCount, reconciliationAmount }
}

/** 全可投资资产贡献；保留 fundContributions 名称只为兼容旧调用。 */
export const assetContributions = fundContributions

export interface MarketContributionRow {
  key: string
  label: string
  amount: number
}

/** 市场贡献；金额合计与资产贡献口径一致。 */
export function marketContributions(
  rows: FundContributionRow[],
): MarketContributionRow[] {
  const byMarket = new Map<string, number>()
  for (const row of rows) {
    if (row.amount == null) continue
    const key = row.marketLabel
    byMarket.set(key, (byMarket.get(key) ?? 0) + row.amount)
  }
  return [...byMarket.entries()]
    .map(([key, amount]) => ({ key, label: key, amount }))
    .sort((a, b) => b.amount - a.amount)
}

export interface AssetClassContributionRow {
  key: AssetClass
  label: string
  amount: number
}

export function assetClassContributions(rows: FundContributionRow[]): AssetClassContributionRow[] {
  const amounts = new Map<AssetClass, number>()
  for (const row of rows) {
    if (row.amount == null) continue
    amounts.set(row.assetClass, (amounts.get(row.assetClass) ?? 0) + row.amount)
  }
  const labels: Record<AssetClass, string> = {
    CASH: '现金', FUND: '基金', ETF: 'ETF', STOCK: '股票', GOLD: '黄金',
    REAL_ESTATE: '房产', HUAWEI_STOCK: '华为长期持股',
  }
  return [...amounts.entries()]
    .map(([key, amount]) => ({ key, label: labels[key], amount }))
    .sort((a, b) => b.amount - a.amount)
}

export interface StyleContributionRow {
  key: string
  label: string
  amount: number
}

/** 策略桶贡献：按资产风格聚合；未分类单列，不并入其他桶。 */
export function styleContributions(rows: FundContributionRow[]): StyleContributionRow[] {
  const byStyle = new Map<string, number>()
  for (const row of rows) {
    if (row.amount == null) continue
    const key = row.style ?? 'UNCLASSIFIED'
    byStyle.set(key, (byStyle.get(key) ?? 0) + row.amount)
  }
  const labelOf = (key: string): string => {
    const map: Record<string, string> = {
      GROWTH: '成长', VALUE: '价值', BALANCED: '均衡', QUANT: '量化',
      SECTOR_THEME: '行业主题', BROAD_INDEX: '宽基指数', SECTOR_INDEX: '行业指数',
      UNCLASSIFIED: '未分类',
    }
    return map[key] ?? key
  }
  return [...byStyle.entries()]
    .map(([key, amount]) => ({ key, label: labelOf(key), amount }))
    .sort((a, b) => b.amount - a.amount)
}

export interface SleeveEventPoint {
  date: string
  direction: 'BUY' | 'SELL'
  name: string
  symbol: string
  amount: number
}

/** 决策时间带用：区间内主腿 BUY/SELL（内部结算腿不重复展示）。 */
export function sleeveEventsFromTxs(
  txs: Array<{ occurredAt: Date; type: string; internal?: boolean | null; voidedAt?: Date | null; amount: number; assetId: string; currency?: string | null }>,
  assetNameById: Map<string, { name: string; symbol: string }>,
  startDate: string,
  endDate: string,
  rateAt: (currency: string, date: Date) => number = () => 1,
): SleeveEventPoint[] {
  return txs
    .filter((tx) => !tx.voidedAt && !tx.internal && (tx.type === 'BUY' || tx.type === 'SELL'))
    .map((tx) => {
      const date = tx.occurredAt.toISOString().slice(0, 10)
      const asset = assetNameById.get(tx.assetId)
      return {
        date,
        direction: tx.type === 'BUY' ? 'BUY' as const : 'SELL' as const,
        name: asset?.name ?? '基金',
        symbol: asset?.symbol ?? '',
        amount: tx.amount * rateAt(tx.currency ?? 'CNY', tx.occurredAt),
      }
    })
    .filter((event) => event.date >= startDate && event.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/* ============ 可视化支持（P1 优化）：缺口段 / 季度买卖桶 ============ */

export interface GapSegment {
  from: string
  to: string
  days: number
}

/**
 * 把净值沿用旧值的连续日期聚合成缺口段，供决策时间带绘制，避免逐点堆叠。
 * minDays：少于该自然日数的孤立点忽略（休市/周末噪声不计入正式缺口展示）。
 */
export function summarizeGapSegments(points: PerformancePoint[], minDays = 3): GapSegment[] {
  const DAY = 86400000
  const segments: GapSegment[] = []
  let start: string | null = null
  let previous: string | null = null
  let count = 0
  const flush = (end: string | null) => {
    if (start && previous && end && count >= minDays) {
      const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY) + 1
      segments.push({ from: start, to: end, days })
    }
    start = null
    previous = null
    count = 0
  }
  for (const point of points) {
    const isGap = (point.valuationStatus === 'PARTIAL' || point.valuationStatus === 'NO_UPDATE') && Math.abs(point.netWorth) > 1e-6
    if (!isGap) {
      flush(previous)
      continue
    }
    if (start == null) start = point.date
    previous = point.date
    count += 1
  }
  flush(previous)
  return segments
}

export interface QuarterBucket {
  quarter: string // e.g. 2025-Q1
  buyCount: number
  buyAmount: number
  sellCount: number
  sellAmount: number
}

/** 把区间 BUY/SELL 事件按自然季分桶，用于决策时间带的密度表达。 */
export function bucketEventsByQuarter(
  events: SleeveEventPoint[],
  startDate: string,
  endDate: string,
): QuarterBucket[] {
  const out = new Map<string, QuarterBucket>()
  for (const event of events) {
    if (event.date < startDate || event.date > endDate) continue
    const q = `${event.date.slice(0, 4)}-Q${Math.floor((Number(event.date.slice(5, 7)) - 1) / 3) + 1}`
    const bucket = out.get(q) ?? { quarter: q, buyCount: 0, buyAmount: 0, sellCount: 0, sellAmount: 0 }
    if (event.direction === 'BUY') {
      bucket.buyCount += 1
      bucket.buyAmount += event.amount
    } else {
      bucket.sellCount += 1
      bucket.sellAmount += event.amount
    }
    out.set(q, bucket)
  }
  return [...out.entries()]
    .map(([quarter, bucket]) => bucket)
    .sort((a, b) => a.quarter.localeCompare(b.quarter))
}
