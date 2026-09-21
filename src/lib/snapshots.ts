// 财富轨迹快照：按日回放账本 + 历史行情估值 + 负债余额 + 净投入，落库为 Snapshot 行
import type { Prisma, PrismaClient } from '@prisma/client'
import { foldTransactions, pendingFundPurchasesAt, pendingSettlementsAt, roundMoney, type LedgerTx } from './engine/ledger'
import { valuePositions } from './engine/valuation'
import { totalLiabilities, type LiabilityEntryInput } from './engine/liabilities'
import { cumulativeContributions, dailyNetFlows } from './engine/attribution'
import type { AssetInfo, TxInput } from './engine/types'
import { loadPriceSeries, priceAtFn, priceObservationAtFn, type PriceObservation } from './market/persist'
import { cnyRateFor, fxRateAtFactory } from './market/fx'
import { isPortfolioAssetClass } from './asset-classification'
import type { ValuationGap, ValuationStatus } from './engine/valuation-status'
import { fundConfirmationDate, isQdiiFund } from './engine/fund-order'
import { dateKeyAt } from './engine/watch-market'

const DAY = 86400000
const MAX_SUPPORTED_DAYS = 36525

/** 北京日历日的零点（快照格与归属日都以北京日期为准，见 ADR-027）。 */
function dayStartMs(value: Date): number {
  return Date.parse(`${dateKeyAt(value)}T00:00:00Z`)
}

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

/** 纯计算：流水 + 负债条目 → 逐日五元组序列（可测试，价格函数注入）。
 * 日格按**北京日历日**切分（ADR-027）：价格序列的日期键同样按北京归属日，
 * 美股美东 D 日的日线出现在北京 D+1 格。 */
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
  const endMs = dayStartMs(to)
  const requestedStartMs = dayStartMs(from)
  if (requestedStartMs > endMs) return []
  const startMs = requestedStartMs
  const days = Math.round((endMs - startMs) / DAY) + 1
  if (days > MAX_SUPPORTED_DAYS) {
    throw new Error(`快照区间超过 ${MAX_SUPPORTED_DAYS} 天，请检查流水日期是否异常`)
  }
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
    // 在途资产：赎回未到账 + 只已知金额、净值份额待确认的申购（ADR-012 / ADR-019）
    const inTransit = roundMoney(
      pendingSettlementsAt(txs, date).reduce((s, p) => s + p.amount * currencyRate(p.currency, date), 0)
      + pendingFundPurchasesAt(txs, date).reduce((s, p) => s + p.amount * currencyRate(p.currency, date), 0),
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

/** 删除阈值与写入起点必须取自同一个北京日界毫秒值（见 rebuildSnapshots 注释）。 */
async function deleteSnapshotsFrom(
  db: PrismaClient | Prisma.TransactionClient,
  familyId: string,
  startMs: number | null,
): Promise<void> {
  await db.snapshot.deleteMany({
    where: startMs == null ? { familyId } : { familyId, date: { gte: new Date(startMs) } },
  })
}

/**
 * 重建后的完整性自检：本次写入的区间必须逐日连续。
 * 只有「删掉却没写回来」这类静默残缺会被这里拦住——残缺快照会让区间收益
 * 的期初回退到很久以前（并让基准序列整体失效），必须在写入处报错而不是留在库里。
 */
async function assertSnapshotCoverage(
  db: PrismaClient,
  familyId: string,
  points: WealthPoint[],
): Promise<void> {
  if (points.length === 0) return
  const firstMs = dayStartMs(points[0].date)
  const lastMs = dayStartMs(points.at(-1)!.date)
  const rows = await db.snapshot.findMany({
    where: { familyId, date: { gte: new Date(firstMs), lte: new Date(lastMs) } },
    orderBy: { date: 'asc' },
    select: { date: true },
  })
  const expected = Math.round((lastMs - firstMs) / DAY) + 1
  if (rows.length !== expected || rows.length !== points.length) {
    throw new Error(
      `快照重建不完整：${points[0].date.toISOString().slice(0, 10)} 起应有 ${expected} 天，实际 ${rows.length} 天`,
    )
  }
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].date.getTime() !== firstMs + index * DAY) {
      throw new Error(`快照重建日期不连续：${rows[index].date.toISOString().slice(0, 10)}`)
    }
  }
}

/**
 * 重建某家庭空间的快照。
 * - 不传 since：全量重建，用于初始化与行情刷新。
 * - 传 since：增量重建——只重算 affectedSince 所属**北京日**及之后的快照；
 *   早于该日的快照保留（流水/负债只影响其发生日之后的值）。
 *   内部仍以最早流水日为起点重放，保证期初持仓与净投入正确。
 *
 * 两个不变量（都曾因破坏而产生静默残缺的快照表）：
 * 1. 增量重建的删除阈值与写入起点必须用**同一个北京日界**。写入起点若按 UTC 日
 *    取整，在北京 00:00–08:00 之间会比删除阈值早一天，于是去重写一条没被删除的
 *    已有行，命中 (familyId, date) 唯一约束让整批写入失败——而删除已经生效。
 * 2. 先算完所有点位，再把「删除 + 写入」放进同一个事务。计算失败或写入失败都不能
 *    留下已被清空、尚未回填的快照表。
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
  const endMs = dayStartMs(now)
  // 增量重建的删除阈值 = 写入起点（同为北京日零点），钳制到今日以兼容未来日期。
  const startMs = opts?.affectedSince ? Math.min(dayStartMs(opts.affectedSince), endMs) : null
  if (txsRaw.length === 0) {
    await deleteSnapshotsFrom(db, familyId, startMs)
    return 0
  }

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
    navSource: t.navSource,
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

  // 价格函数：PriceBar 落库历史优先，缺失由财富引擎标记估值缺口。
  // 汇率函数：纯人民币组合不访问汇率源；外币组合按 RateBar 历史折算，缺失时回落最近真实汇率。
  const symbols = assetsRaw.filter((a) => !a.manual && a.cls !== 'CASH' && a.cls !== 'REAL_ESTATE').map((a) => a.symbol)
  const priceMap = await loadPriceSeries(db, symbols)
  const basePriceAt = priceAtFn(priceMap)
  const observationAt = priceObservationAtFn(priceMap)
  const rateAt = await fxRateAtFactory(db, assets.map((asset) => asset.currency))
  const priceAt: PriceAtFn = (symbol, date) => {
    const v = basePriceAt(symbol, date)
    return v == null ? undefined : v * cnyRateFor(symbol, { USDCNY: rateAt('USD', date), HKDCNY: rateAt('HKD', date) })
  }

  // 增量：只从受影响日（北京日零点）起重算，并带入此前的累计净投入；
  // 全量：从最早流水日重建全部，不再静默截断长历史。future 日期已在 startMs 钳制到今日。
  const from = startMs != null ? new Date(startMs) : txsRaw[0].occurredAt
  const points = computeWealthSeries(txs, assets, entries, from, now, priceAt, rateAt, observationAt)
  const data = points.map((p) => ({
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
  }))
  // 删除与写入必须同生共死：两者分开执行时，任何写入失败都会把尾部快照永久删掉。
  await db.$transaction(async (tx) => {
    await deleteSnapshotsFrom(tx, familyId, startMs)
    if (data.length > 0) await tx.snapshot.createMany({ data })
  }, { timeout: 30000 })
  await assertSnapshotCoverage(db, familyId, points)
  return points.length
}
