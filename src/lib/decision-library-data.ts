// 决策库数据装配（P1）：派生决策事件 + 行为统计，纯只读、不建表、不写决策记录
import { prisma } from './db'
import { scopedDb, type FamilyCtx } from './scoped'
import { getSession } from './session'
import { fxRateAtFactory } from './market/fx'
import { loadPriceSeries } from './market/persist'
import { dateKeyAt } from './engine/watch-market'
import { deriveDecisionEvents, type DecisionEvent } from './engine/decision-events'
import { behaviorSummary, type BehaviorSummary } from './engine/behavior-analysis'
import { isQdiiFund } from './engine/fund-order'
import type { LedgerTx } from './engine/ledger'
import type { AssetClass } from './engine/types'
import { isInvestableAsset } from './asset-classification'
import { parseSymbol } from './market/symbols'

const METHOD_VERSION = 'decision-events 0.2'

export interface DecisionLibraryPageData {
  ctx: FamilyCtx
  rangeStart: string
  rangeEnd: string
  events: DecisionEvent[]
  behavior: BehaviorSummary
  /** 交易费用合计（CNY） */
  tradingFees: number
  pendingCount: number
  assetsCount: number
  empty: boolean
  methodVersion: string
}

export async function getDecisionLibraryPageData(
  ctxOverride?: FamilyCtx,
): Promise<DecisionLibraryPageData | null> {
  const ctx = ctxOverride ?? await getSession()
  if (!ctx) return null
  const db = scopedDb(prisma, ctx)

  const allAssets = await db.asset.findMany({ orderBy: { createdAt: 'asc' } })
  const rawAssets = allAssets.filter((asset) => isInvestableAsset({ cls: asset.cls as AssetClass, manual: asset.manual }))
  if (rawAssets.length === 0) {
    return {
      ctx,
      rangeStart: '',
      rangeEnd: '',
      events: [],
      behavior: behaviorSummary({ events: [], txs: [], startDate: '', endDate: '', averageCapital: null, tradingFees: 0 }),
      tradingFees: 0,
      pendingCount: 0,
      assetsCount: 0,
      empty: true,
      methodVersion: METHOD_VERSION,
    }
  }
  const assetIds = new Set(rawAssets.map((asset) => asset.id))
  const symbols = rawAssets.filter((asset) => asset.cls !== 'CASH').map((asset) => asset.symbol)

  const [txRows, priceMap, rateAt] = await Promise.all([
    db.transaction.findMany({
      where: { assetId: { in: [...assetIds] } },
      include: { asset: true },
      orderBy: { occurredAt: 'asc' },
    }),
    loadPriceSeries(prisma, symbols),
    fxRateAtFactory(prisma, rawAssets.map((asset) => asset.currency)),
  ])
  const valid = txRows.filter((tx) => !tx.voidedAt)
  const first = valid[0]
  const last = valid.at(-1)
  if (!first || !last) {
    return {
      ctx,
      rangeStart: '',
      rangeEnd: '',
      events: [],
      behavior: behaviorSummary({ events: [], txs: [], startDate: '', endDate: '', averageCapital: null, tradingFees: 0 }),
      tradingFees: 0,
      pendingCount: 0,
      assetsCount: rawAssets.length,
      empty: true,
      methodVersion: METHOD_VERSION,
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

  const navByAsset = new Map<string, { date: string; nav: number }[]>()
  for (const asset of rawAssets) {
    const series = priceMap.get(asset.symbol)
    if (!series) continue
    navByAsset.set(
      asset.id,
      series.times.map((_, index) => ({
        date: series.valuationDates[index],
        nav: series.closes[index],
      })),
    )
  }
  const assetMeta = new Map(
    rawAssets.map((asset) => {
      const cls = asset.cls as AssetClass
      const parsed = parseSymbol(asset.symbol).market
      const qdii = isQdiiFund(asset.symbol, asset.name)
      const marketLabel = cls === 'GOLD' ? '黄金'
        : qdii ? 'QDII（境外市场）'
          : parsed === 'US' ? '美国市场'
            : parsed === 'HK' ? '香港市场'
              : parsed === 'CN_A' || parsed === 'FUND' ? '境内市场' : '其他市场'
      return [asset.id, {
        name: asset.name,
        symbol: asset.symbol,
        qdii,
        assetClass: cls,
        marketLabel,
      }] as const
    }),
  )

  const rangeStart = dateKeyAt(first.occurredAt)
  const latestPriceDate = [...priceMap.values()]
    .flatMap((series) => series.valuationDates)
    .sort()
    .at(-1)
  const rangeEnd = [dateKeyAt(last.occurredAt), latestPriceDate].filter(Boolean).sort().at(-1)!
  const events = deriveDecisionEvents({
    txs: ledgerTxs,
    navByAsset,
    assetMeta,
    currencyRate: (currency, date) => rateAt(currency, date),
    startDate: rangeStart,
    endDate: rangeEnd,
  })

  const rateOf = (tx: LedgerTx) => rateAt(tx.currency ?? 'CNY', tx.occurredAt)
  const tradingFees = ledgerTxs
    .filter((tx) => !tx.internal && !tx.voidedAt && (tx.type === 'BUY' || tx.type === 'SELL' || tx.type === 'FEE'))
    .reduce((sum, tx) => sum + (tx.type === 'FEE' ? tx.amount : tx.fee) * rateOf(tx), 0)
  const pendingCount = ledgerTxs.filter((tx) => tx.type === 'BUY' && tx.navSource === 'PENDING').length

  const behavior = behaviorSummary({
    events,
    txs: ledgerTxs,
    startDate: rangeStart,
    endDate: rangeEnd,
    averageCapital: null,
    tradingFees,
  })

  return {
    ctx,
    rangeStart,
    rangeEnd,
    events,
    behavior,
    tradingFees: Math.round(tradingFees * 100) / 100,
    pendingCount,
    assetsCount: rawAssets.length,
    empty: false,
    methodVersion: METHOD_VERSION,
  }
}
