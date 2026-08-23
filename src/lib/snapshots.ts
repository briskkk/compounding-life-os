// 财富轨迹快照：按日回放账本 + 历史行情估值 + 负债余额 + 净投入，落库为 Snapshot 行
import type { PrismaClient } from '@prisma/client'
import { foldTransactions, pendingSettlementsAt, roundMoney, type LedgerTx } from './engine/ledger'
import { valuePositions } from './engine/valuation'
import { totalLiabilities, type LiabilityEntryInput } from './engine/liabilities'
import { cumulativeContributions, dailyNetFlows } from './engine/attribution'
import type { AssetInfo, TxInput } from './engine/types'
import { loadPriceSeries, priceAtFn, priceObservationAtFn, type PriceObservation } from './market/persist'
import { cnyRateFor, fxRateAtFactory } from './market/fx'
import { isPortfolioAssetClass } from './asset-classification'
import type { ValuationGap, ValuationStatus } from './engine/valuation-status'
import { fundConfirmationDate, isQdiiFund } from './engine/fund-order'

const DAY = 86400000
const MAX_DAYS = 1400

export interface WealthPoint {
  date: Date
  assets: number
  liabilities: number
  netWorth: number
  investable: number
  contributions: number
  valuationStatus: ValuationStatus
  valuationCoverage: number | null
  freshValue: number
  pricedValue: number
  latestValuationDate: string | null
  valuationDetails: string
}

export type PriceAtFn = (symbol: string, date: Date) => number | undefined
export type PriceObservationAtFn = (symbol: string, date: Date) => PriceObservation | undefined

/** 纯计算：流水 + 负债条目 → 逐日五元组序列（可测试，价格函数注入） */
export function computeWealthSeries(
  txs: LedgerTx[],
  assets: AssetInfo[],
  liabilityEntries: LiabilityEntryInput[],
  from: Date,
  to: Date,
  priceAt: PriceAtFn,
  currencyRate: (currency: string, date?: Date) => number = () => 1,
  observationAt?: PriceObservationAtFn,
): WealthPoint[] {
  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const flows = dailyNetFlows(txs.filter((tx) => isPortfolioAssetClass(tx.assetClass)), currencyRate)
  const endMs = Math.floor(to.getTime() / DAY) * DAY
  const requestedStartMs = Math.floor(from.getTime() / DAY) * DAY
  // 超过窗口时保留最近 MAX_DAYS，而不是从最早日期截取一段已经过时的历史。
  const startMs = Math.max(requestedStartMs, endMs - (MAX_DAYS - 1) * DAY)
  const days = Math.min(MAX_DAYS, Math.round((endMs - startMs) / DAY) + 1)
  const dates = Array.from({ length: days }, (_, i) => new Date(startMs + i * DAY))
  // 截窗前的净投入需要作为期初累计值带入，否则最近窗口的净投入会被重置。
  const startDay = Math.floor(startMs / DAY)
  const contributionCarry = [...flows.entries()]
    .filter(([day]) => day < startDay)
    .reduce((sum, [, amount]) => sum + amount, 0)
  const contributions = cumulativeContributions(dates, flows).map((amount) => amount + contributionCarry)
  const returnEventDays = new Set(
    txs
      .filter((tx) => !tx.voidedAt && ['DIVIDEND', 'INTEREST', 'FEE'].includes(tx.type))
      .map((tx) => Math.floor(tx.occurredAt.getTime() / DAY)),
  )

  return dates.map((date, i) => {
    const positions = foldTransactions(txs, date)
    const valued = valuePositions(positions, assetMap, (symbol) => priceAt(symbol, date), currencyRate, date)
    let assetsTotal = 0
    let investable = 0
    for (const v of valued) {
      assetsTotal += v.value
      investable += v.investable
    }
    // 在途资金：赎回已申报（份额已扣）但现金结算腿发生在当日之后 —— 并入总资产与可自由投资（ADR-012）
    const inTransit = roundMoney(
      pendingSettlementsAt(txs, date).reduce((s, p) => s + p.amount * currencyRate(p.currency, date), 0),
    )
    assetsTotal += inTransit
    investable += inTransit
    const liab = totalLiabilities(liabilityEntries, date)
    const valuationDate = date.toISOString().slice(0, 10)
    const byAsset = new Map<string, { symbol: string; name: string; value: number; observation?: PriceObservation }>()
    for (const position of valued) {
      if (
        position.asset.cls === 'CASH'
        || position.asset.cls === 'REAL_ESTATE'
        || position.asset.manual
        || !isPortfolioAssetClass(position.asset.cls)
        || Math.abs(position.investable) < 0.005
      ) continue
      const current = byAsset.get(position.assetId) ?? {
        symbol: position.asset.symbol,
        name: position.asset.name,
        value: 0,
        observation: observationAt?.(position.asset.symbol, date),
      }
      current.value += position.investable
      byAsset.set(position.assetId, current)
    }
    let freshValue = 0
    let pricedValue = 0
    let freshAssetCount = 0
    const gaps: ValuationGap[] = []
    let pendingGapCount = 0
    let latestValuationDate: string | null = null
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
    for (const item of byAsset.values()) {
      const absoluteValue = Math.abs(item.value)
      pricedValue += absoluteValue
      const priceDate = item.observation?.valuationDate ?? null
      if (priceDate && (!latestValuationDate || priceDate > latestValuationDate)) latestValuationDate = priceDate
      if (priceDate === valuationDate) {
        freshValue += absoluteValue
        freshAssetCount += 1
      } else {
        const confirmedClosed = item.observation?.nextValuationDate != null
          && item.observation.nextValuationDate > valuationDate
        const reason: ValuationGap['reason'] = !item.observation
          ? 'NO_PRICE'
          : confirmedClosed || weekend
            ? 'MARKET_CLOSED'
            : 'PENDING'
        if (reason !== 'MARKET_CLOSED') pendingGapCount += 1
        gaps.push({
          symbol: item.symbol,
          name: item.name,
          valuationDate: priceDate,
          valueCny: Math.round(item.value),
          reason,
        })
      }
    }
    const currentDay = Math.floor(date.getTime() / DAY)
    const hasExternalFlow = Math.abs(flows.get(currentDay) ?? 0) >= 0.005
    const hasReturnEvent = returnEventDays.has(currentDay)
    let valuationStatus: ValuationStatus
    if (!observationAt) valuationStatus = 'LEGACY'
    else if (pricedValue < 0.005) valuationStatus = hasReturnEvent ? 'SETTLED' : hasExternalFlow ? 'FLOW_ONLY' : weekend ? 'CLOSED' : 'NO_UPDATE'
    else if (freshAssetCount === 0) valuationStatus = hasReturnEvent ? 'PARTIAL' : hasExternalFlow ? 'FLOW_ONLY' : pendingGapCount === 0 || weekend ? 'CLOSED' : 'NO_UPDATE'
    else if (pendingGapCount > 0) valuationStatus = 'PARTIAL'
    else valuationStatus = 'SETTLED'
    const valuationCoverage = pricedValue > 0 ? freshValue / pricedValue : null
    return {
      date,
      assets: Math.round(assetsTotal),
      liabilities: Math.round(liab),
      netWorth: Math.round(assetsTotal - liab),
      investable: Math.round(investable),
      contributions: Math.round(contributions[i]),
      valuationStatus,
      valuationCoverage,
      freshValue: Math.round(freshValue),
      pricedValue: Math.round(pricedValue),
      latestValuationDate,
      valuationDetails: JSON.stringify(gaps),
    }
  })
}

/**
 * 重建某家庭空间的快照。
 * - 不传 since：全量重建（先清后写），用于初始化与行情刷新。
 * - 传 since：增量重建——只删除并重算 affectedSince 当日及之后的快照；
 *   早于该日的快照保留（流水/负债只影响其发生日之后的值）。
 *   内部仍以最早流水日为起点重放，保证期初持仓与净投入正确。
 */
export async function rebuildSnapshots(
  db: PrismaClient,
  familyId: string,
  opts?: { affectedSince?: Date },
): Promise<number> {
  const txsRaw = await db.transaction.findMany({
    where: { familyId },
    include: { asset: true },
    orderBy: { occurredAt: 'asc' },
  })
  const now = new Date()
  // 与 computeWealthSeries 一致的窗口起点：增量时把受影响日钳制到最近 MAX_DAYS 窗口内，
  // 保证「删除范围」与「重算范围」完全一致，避免唯一约束冲突或残留过期快照。
  const endMs = Math.floor(now.getTime() / DAY) * DAY
  const windowStart = endMs - (MAX_DAYS - 1) * DAY
  if (opts?.affectedSince) {
    const since = Math.min(Math.max(Math.floor(opts.affectedSince.getTime() / DAY) * DAY, windowStart), endMs)
    await db.snapshot.deleteMany({ where: { familyId, date: { gte: new Date(since) } } })
  } else {
    await db.snapshot.deleteMany({ where: { familyId } })
  }
  if (txsRaw.length === 0) return 0

  const [assetsRaw, entriesRaw] = await Promise.all([
    db.asset.findMany({ where: { familyId } }),
    db.liabilityEntry.findMany({ where: { familyId } }),
  ])
  const assets: AssetInfo[] = assetsRaw.map((a) => ({
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    cls: a.cls,
    manual: a.manual,
    currency: a.currency,
  }))
  const txs: LedgerTx[] = txsRaw.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    assetId: t.assetId,
    type: t.type,
    quantity: t.quantity == null ? null : Number(t.quantity),
    price: t.price == null ? null : Number(t.price),
    amount: Number(t.amount),
    fee: Number(t.fee),
    occurredAt: t.occurredAt,
    navDate: t.navDate,
    confirmationDate: t.navDate && t.asset.cls === 'FUND'
      ? fundConfirmationDate(t.navDate, { qdii: isQdiiFund(t.asset.symbol, t.asset.name) })
      : t.navDate,
    settlementDate: t.settlementDate,
    assetClass: t.asset.cls,
    internal: t.internal,
    voidedAt: t.voidedAt,
    settleOfId: t.settleOfId,
    currency: t.asset.currency,
  }))
  const entries: LiabilityEntryInput[] = entriesRaw.map((e) => ({
    liabilityId: e.liabilityId,
    type: e.type,
    amount: Number(e.amount),
    occurredAt: e.occurredAt,
  }))

  // 价格函数：PriceBar 落库历史优先，缺失回落模拟器。
  // 汇率函数：RateBar 历史按日折算（当日优先，缺失回落最近可用）；早于 RateBar 最早记录的历史日期回落实时/固定汇率。
  const symbols = assetsRaw.filter((a) => !a.manual && a.cls !== 'CASH' && a.cls !== 'REAL_ESTATE').map((a) => a.symbol)
  const priceMap = await loadPriceSeries(db, symbols)
  const basePriceAt = priceAtFn(priceMap)
  const observationAt = priceObservationAtFn(priceMap)
  const rateAt = await fxRateAtFactory(db)
  const priceAt: PriceAtFn = (symbol, date) => {
    const v = basePriceAt(symbol, date)
    return v == null ? undefined : v * cnyRateFor(symbol, { USDCNY: rateAt('USD', date), HKDCNY: rateAt('HKD', date) })
  }

  // 增量：只从受影响日起重算（computeWealthSeries 内部按 MAX_DAYS 截窗并带入期初净投入）；
  // 全量：从最早流水日重建全部。future 日期已被钳制到窗口内。
  const from = opts?.affectedSince
    ? new Date(Math.min(Math.max(Math.floor(opts.affectedSince.getTime() / DAY) * DAY, windowStart), endMs))
    : txsRaw[0].occurredAt
  const points = computeWealthSeries(txs, assets, entries, from, now, priceAt, rateAt, observationAt)
  await db.snapshot.createMany({
    data: points.map((p) => ({
      familyId,
      date: p.date,
      assets: p.assets,
      liabilities: p.liabilities,
      netWorth: p.netWorth,
      investable: p.investable,
      contributions: p.contributions,
      valuationStatus: p.valuationStatus,
      valuationCoverage: p.valuationCoverage,
      freshValue: p.freshValue,
      pricedValue: p.pricedValue,
      latestValuationDate: p.latestValuationDate ? new Date(`${p.latestValuationDate}T00:00:00Z`) : null,
      valuationDetails: p.valuationDetails,
    })),
  })
  return points.length
}
