// 长期复盘数据装配：全部可投资资产结果桥 + TWR 资格 + 证据水位
// 只读派生，不写任何表；范围默认成立以来，可选近五年/自然年。
import { createHash } from 'node:crypto'
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSession } from './session'
import { fxRateAtFactory } from './market/fx'
import { loadPriceSeries } from './market/persist'
import { dateKeyAt } from './engine/watch-market'
import { buildAssetPerformanceSeries, type AssetNavPoint } from './engine/asset-performance'
import type { AssetClass } from './engine/types'
import {
  annualPath,
  assetClassContributions,
  assetContributions,
  buildInvestablePortfolioSeries,
  investmentHistoryResult,
  marketContributions,
  monthlyPath,
  resolveHistoryRange,
  sleeveEventsFromTxs,
  styleContributions,
  type ContributionResult,
  type EvidenceWatermark,
  type AssetClassContributionRow,
  type PortfolioFlowSummary,
  type HistoryScope,
  type HistoryRange,
  type MarketContributionRow,
  type SleeveEventPoint,
  type StyleContributionRow,
} from './engine/investment-history'
import { isQdiiFund } from './engine/fund-order'
import { pendingSettlementsAt, roundMoney } from './engine/ledger'
import type { LedgerTx } from './engine/ledger'
import { cumulativeContributions, dailyNetFlows, xirrFlowsFromTxs } from './engine/attribution'
import { isInvestableAsset } from './asset-classification'
import { parseSymbol } from './market/symbols'

const METHOD_VERSION = 'investment-history 0.4'

export interface HistoryScopeOption {
  value: HistoryScope
  label: string
  active: boolean
}

export interface ContributionDimensionView {
  byAsset: ContributionResult
  byClass: AssetClassContributionRow[]
  byMarket: MarketContributionRow[]
  byStyle: StyleContributionRow[]
  attributedAmount: number
  reconciliationAmount: number | null
}

export interface InvestmentHistoryPageData {
  ctx: FamilyCtx
  range: HistoryRange
  scopes: HistoryScopeOption[]
  assetsCount: number
  flows: PortfolioFlowSummary
  result: ReturnType<typeof investmentHistoryResult>
  annual: ReturnType<typeof import('./engine/investment-history').annualPath>
  monthly: ReturnType<typeof import('./engine/investment-history').monthlyPath>
  contributions: ContributionDimensionView
  events: SleeveEventPoint[]
  pendingPurchaseCount: number
  empty: boolean
}

function scopeFrom(value?: string): HistoryScope {
  if (value === 'FIVE_YEAR') return 'FIVE_YEAR'
  if (/^\d{4}$/.test(value ?? '')) return { year: value! }
  return 'INCEPTION'
}

function buildScopes(scope: HistoryScope, currentYear: string): HistoryScopeOption[] {
  const yearValue = typeof scope === 'object' ? scope.year : null
  const options: HistoryScopeOption[] = [
    { value: 'INCEPTION', label: '成立以来', active: scope === 'INCEPTION' },
    { value: 'FIVE_YEAR', label: '近五年', active: scope === 'FIVE_YEAR' },
  ]
  const current = Number(currentYear)
  for (let year = current; year >= current - 5; year--) {
    const value: HistoryScope = { year: String(year) }
    options.push({ value, label: `${year} 年`, active: yearValue === String(year) })
  }
  return options
}

function navPoints(symbol: string, priceMap: Awaited<ReturnType<typeof loadPriceSeries>>): AssetNavPoint[] {
  const series = priceMap.get(symbol)
  if (!series) return []
  return series.times.map((_, index) => ({
    date: series.valuationDates[index],
    nav: series.closes[index],
    source: series.sources[index],
  }))
}

/** 活动统计；结果桥净投入不读取这些数，而从外部现金流贡献曲线派生。 */
function summarizePortfolioFlows(
  txs: LedgerTx[],
  startDate: string,
  endDate: string,
  rateAt: (currency: string, date: Date) => number,
): PortfolioFlowSummary {
  const flows: PortfolioFlowSummary = { deposits: 0, withdrawals: 0, buys: 0, sells: 0, dividends: 0, fees: 0, interestIncome: 0 }
  for (const tx of txs) {
    if (tx.voidedAt || tx.internal) continue
    const date = dateKeyAt(tx.occurredAt)
    if (date < startDate || date > endDate) continue
    const rate = rateAt(tx.currency ?? 'CNY', tx.occurredAt)
    if (tx.type === 'DEPOSIT') {
      flows.deposits = roundMoney(flows.deposits + tx.amount * rate)
    } else if (tx.type === 'WITHDRAW') {
      flows.withdrawals = roundMoney(flows.withdrawals + tx.amount * rate)
    } else if (tx.type === 'BUY') {
      flows.buys = roundMoney(flows.buys + tx.amount * rate)
      flows.fees = roundMoney(flows.fees + tx.fee * rate)
    } else if (tx.type === 'SELL') {
      flows.sells = roundMoney(flows.sells + Math.max(0, tx.amount - tx.fee) * rate)
      flows.fees = roundMoney(flows.fees + tx.fee * rate)
    } else if (tx.type === 'DIVIDEND') {
      flows.dividends = roundMoney(flows.dividends + tx.amount * rate)
    } else if (tx.type === 'FEE') {
      flows.fees = roundMoney(flows.fees + tx.amount * rate)
    } else if (tx.type === 'INTEREST') {
      flows.interestIncome = roundMoney(flows.interestIncome + tx.amount * rate)
    }
  }
  return flows
}

function marketLabel(asset: { cls: AssetClass; symbol: string; name: string; currency: string }): string {
  if (asset.cls === 'CASH') return asset.currency === 'CNY' ? '人民币现金' : `${asset.currency} 现金`
  if (asset.cls === 'GOLD') return '黄金'
  if (isQdiiFund(asset.symbol, asset.name)) return 'QDII（境外市场）'
  const market = parseSymbol(asset.symbol).market
  if (market === 'US') return '美国市场'
  if (market === 'HK') return '香港市场'
  if (market === 'CN_A' || market === 'FUND') return '境内市场'
  return '其他市场'
}

function digestLines(prefix: string, lines: string[]): string {
  if (lines.length === 0) return `${prefix}-EMPTY`
  const digest = createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)
  return `${prefix}-SHA256-${digest}-${lines.length}`
}

export async function getInvestmentHistoryPageData(
  options: { scope?: string } = {},
  ctxOverride?: FamilyCtx,
): Promise<InvestmentHistoryPageData | null> {
  const ctx = ctxOverride ?? await getSession()
  if (!ctx) return null
  const now = new Date()
  const today = dateKeyAt(now)
  const currentYear = today.slice(0, 4)
  const db = scopedDb(prisma, ctx)
  const scope = scopeFrom(options.scope)
  const scopes = buildScopes(scope, currentYear)

  const allAssets = await db.asset.findMany({ orderBy: { createdAt: 'asc' } })
  const rawAssets = allAssets.filter((asset) => isInvestableAsset({ cls: asset.cls as AssetClass, manual: asset.manual }))
  const assetIds = new Set(rawAssets.map((asset) => asset.id))
  const pricedSymbols = rawAssets.filter((asset) => asset.cls !== 'CASH').map((asset) => asset.symbol)

  const [txRows, priceMap, rateAt] = await Promise.all([
    db.transaction.findMany({
      where: { assetId: { in: [...assetIds] } },
      include: { asset: true },
      orderBy: { occurredAt: 'asc' },
    }),
    loadPriceSeries(prisma, pricedSymbols),
    fxRateAtFactory(prisma, rawAssets.map((asset) => asset.currency)),
  ])

  const firstTx = txRows.find((tx) => !tx.voidedAt)
  const inceptionDate = firstTx ? dateKeyAt(firstTx.occurredAt) : today
  const range = resolveHistoryRange(scope, now, inceptionDate)

  // 证据水位：账本末笔有效流水 / 行情最后净值日 / 待确认申购
  const lastTx = [...txRows].reverse().find((tx) => !tx.voidedAt)
  const priceDates = [...priceMap.values()].flatMap((series) => series.valuationDates)
  const ledgerLines = [...txRows]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
    .map((tx) => [
      tx.id,
      tx.accountId,
      tx.assetId,
      tx.asset.symbol,
      tx.asset.cls,
      tx.asset.currency,
      tx.asset.manual ? '1' : '0',
      tx.asset.style ?? '',
      tx.type,
      tx.occurredAt.toISOString(),
      tx.amount.toString(),
      tx.fee.toString(),
      tx.quantity?.toString() ?? '',
      tx.price?.toString() ?? '',
      tx.navDate?.toISOString() ?? '',
      tx.settlementDate?.toISOString() ?? '',
      tx.navSource ?? '',
      tx.internal ? '1' : '0',
      tx.voidedAt?.toISOString() ?? '',
      tx.settleOfId ?? '',
    ].join('|'))
  const priceLines = [...priceMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([symbol, series]) => series.valuationDates.map((date, index) => [
      symbol,
      date,
      String(series.closes[index]),
      series.sources[index] ?? '',
    ].join('|')))
  const watermark: EvidenceWatermark = {
    ledgerWatermark: lastTx ? digestLines('LEDGER', ledgerLines) : 'LEDGER-EMPTY',
    priceWatermark: priceDates.length > 0 ? digestLines('PRICE', priceLines) : null,
    asOf: range.endDate,
    methodVersion: METHOD_VERSION,
  }
  const pendingPurchaseCount = txRows.filter((tx) => !tx.voidedAt && tx.navSource === 'PENDING' && tx.type === 'BUY').length

  if (rawAssets.length === 0 || !firstTx) {
    const emptyFlows: PortfolioFlowSummary = { deposits: 0, withdrawals: 0, buys: 0, sells: 0, dividends: 0, fees: 0, interestIncome: 0 }
    const emptyResult = investmentHistoryResult({ range, sleeveSeries: [], flows: emptyFlows, watermark })
    return {
      ctx,
      range,
      scopes,
      assetsCount: rawAssets.length,
      flows: emptyFlows,
      result: emptyResult,
      annual: [],
      monthly: [],
      contributions: {
        byAsset: { rows: [], attributedAmount: 0, blockedCount: 0, reconciliationAmount: 0 },
        byClass: [],
        byMarket: [],
        byStyle: [],
        attributedAmount: 0,
        reconciliationAmount: 0,
      },
      events: [],
      pendingPurchaseCount,
      empty: true,
    }
  }

  const ledgerTxs: LedgerTx[] = txRows.map((tx) => ({
    id: tx.id,
    accountId: tx.accountId,
    assetId: tx.assetId,
    type: tx.type,
    quantity: tx.quantity == null ? null : Number(tx.quantity),
    price: tx.price == null ? null : Number(tx.price),
    amount: Number(tx.amount),
    fee: Number(tx.fee),
    occurredAt: tx.occurredAt,
    navDate: tx.navDate,
    settlementDate: tx.settlementDate,
    navSource: tx.navSource,
    assetClass: tx.asset.cls,
    internal: tx.internal,
    voidedAt: tx.voidedAt,
    settleOfId: tx.settleOfId,
    currency: tx.asset.currency,
    note: tx.note,
  }))

  const assetNameSymbol = new Map(rawAssets.map((asset) => [asset.id, { name: asset.name, symbol: asset.symbol }]))
  const assets = rawAssets.map((asset) => {
    const cls = asset.cls as AssetClass
    return {
      assetId: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      style: asset.style,
      qdii: isQdiiFund(asset.symbol, asset.name),
      assetClass: cls,
      marketLabel: marketLabel({ cls, symbol: asset.symbol, name: asset.name, currency: asset.currency }),
      series: buildAssetPerformanceSeries({
        asset: {
          id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          cls,
          manual: asset.manual,
          currency: asset.currency,
        },
        transactions: ledgerTxs,
        prices: navPoints(asset.symbol, priceMap),
        to: new Date(`${range.endDate}T23:59:59Z`),
        currencyRate: (date) => rateAt(asset.currency, date),
      }),
    }
  })

  // 下界前移 7 天，让范围起点前的最近估值点进入序列，作为期初基准与 TWR 首段分母。
  const paddedStart = (() => {
    const d = new Date(`${range.startDate}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7)
    return d.toISOString().slice(0, 10)
  })()
  const combinedSeries = buildInvestablePortfolioSeries(
    assets,
    paddedStart,
    range.endDate,
  )
  const contributionDates = combinedSeries.map((point) => new Date(`${point.date}T00:00:00Z`))
  const externalContributions = cumulativeContributions(
    contributionDates,
    dailyNetFlows(ledgerTxs, (currency, date) => rateAt(currency, date)),
  )
  const sleeveSeries = combinedSeries.map((point, index) => {
    const asOf = new Date(`${point.date}T23:59:59Z`)
    const inTransit = pendingSettlementsAt(ledgerTxs, asOf).reduce(
      (sum, settlement) => sum + settlement.amount * rateAt(settlement.currency, asOf),
      0,
    )
    return {
      ...point,
      netWorth: roundMoney(point.netWorth + inTransit),
      // 与 /review 的既有组合口径一致：累计外部净投入按人民币元归一，
      // 避免同一月份因两条页面采用不同小数精度而出现 0.10 元差异。
      contributions: Math.round(externalContributions[index]),
    }
  })
  const flows = summarizePortfolioFlows(ledgerTxs, range.startDate, range.endDate, (currency, date) => rateAt(currency, date))
  const xirrFlows = xirrFlowsFromTxs(
    ledgerTxs.filter((tx) => {
      const date = dateKeyAt(tx.occurredAt)
      return date >= range.startDate && date <= range.endDate
    }),
    (currency, date) => rateAt(currency, date),
  )
  const result = investmentHistoryResult({
    range,
    sleeveSeries,
    flows,
    xirrFlows,
    pendingPurchaseCount: 0,
    watermark,
  })
  result.metrics.push({
    key: 'benchmark',
    label: '可投资组合政策基准',
    status: 'BLOCKED',
    eligibleCount: 0,
    totalCount: 1,
    coveragePct: null,
    asOf: null,
    methodVersion: METHOD_VERSION,
    limitations: ['尚未配置按时期生效的多资产政策基准；不能用单一指数替代现金、基金、ETF、股票与黄金的混合组合'],
  })

  const annual = annualPath(sleeveSeries, range.startDate, range.endDate)
  const monthly = monthlyPath(sleeveSeries, range.startDate, range.endDate)

  const contributionInput = assets.map((asset) => ({
    key: asset.assetId,
    name: asset.name,
    symbol: asset.symbol,
    style: asset.style,
    qdii: asset.qdii,
    assetClass: asset.assetClass,
    marketLabel: asset.marketLabel,
    series: asset.series,
  }))
  const byAsset = assetContributions({
    assets: contributionInput,
    startDate: range.startDate,
    endDate: range.endDate,
    sleeveInvestGain: result.bridge.investGain,
  })
  const bridgeMetric = result.metrics.find((metric) => metric.key === 'bridge')
  const contributionEligibleCount = byAsset.rows.length - byAsset.blockedCount
  result.metrics.push({
    key: 'contribution',
    label: '收益贡献（资产/类别/市场/策略桶）',
    status: byAsset.blockedCount > 0
      ? 'BLOCKED'
      : bridgeMetric?.status === 'PARTIAL' ? 'PARTIAL' : 'ELIGIBLE',
    eligibleCount: contributionEligibleCount,
    totalCount: byAsset.rows.length,
    coveragePct: byAsset.rows.length > 0 ? contributionEligibleCount / byAsset.rows.length : null,
    asOf: bridgeMetric?.asOf ?? null,
    methodVersion: METHOD_VERSION,
    limitations: byAsset.blockedCount > 0
      ? [`${byAsset.blockedCount} 项资产缺少足够价格，归因与残差均不可发布`]
      : bridgeMetric?.status === 'PARTIAL'
        ? ['贡献金额使用各资产最近可得价格，期末不是同一估值日']
        : [],
  })
  const contributions: ContributionDimensionView = {
    byAsset,
    byClass: assetClassContributions(byAsset.rows),
    byMarket: marketContributions(byAsset.rows),
    byStyle: styleContributions(byAsset.rows),
    attributedAmount: byAsset.attributedAmount,
    reconciliationAmount: byAsset.reconciliationAmount,
  }
  const events = sleeveEventsFromTxs(
    ledgerTxs,
    assetNameSymbol,
    range.startDate,
    range.endDate,
    (currency, date) => rateAt(currency, date),
  )

  return {
    ctx,
    range,
    scopes,
    assetsCount: rawAssets.length,
    flows,
    result,
    annual,
    monthly,
    contributions,
    events,
    pendingPurchaseCount,
    empty: false,
  }
}
