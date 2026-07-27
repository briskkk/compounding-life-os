// 财富轨迹快照：按日回放账本 + 历史行情估值 + 负债余额 + 净投入，落库为 Snapshot 行
import type { PrismaClient } from '@prisma/client'
import { foldTransactions, type LedgerTx } from './engine/ledger'
import { valuePositions } from './engine/valuation'
import { totalLiabilities, type LiabilityEntryInput } from './engine/liabilities'
import { cumulativeContributions, dailyNetFlows } from './engine/attribution'
import type { AssetInfo, TxInput } from './engine/types'
import { loadPriceSeries, priceAtFn } from './market/persist'
import { cnyRateFor, fxRates } from './market/fx'

const DAY = 86400000
const MAX_DAYS = 1400

export interface WealthPoint {
  date: Date
  assets: number
  liabilities: number
  netWorth: number
  investable: number
  contributions: number
}

export type PriceAtFn = (symbol: string, date: Date) => number | undefined

/** 纯计算：流水 + 负债条目 → 逐日五元组序列（可测试，价格函数注入） */
export function computeWealthSeries(
  txs: LedgerTx[],
  assets: AssetInfo[],
  liabilityEntries: LiabilityEntryInput[],
  from: Date,
  to: Date,
  priceAt: PriceAtFn,
  currencyRate: (currency: string) => number = () => 1,
): WealthPoint[] {
  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const flows = dailyNetFlows(txs, currencyRate)
  const startMs = Math.floor(from.getTime() / DAY) * DAY
  const endMs = Math.floor(to.getTime() / DAY) * DAY
  const days = Math.min(MAX_DAYS, Math.round((endMs - startMs) / DAY) + 1)
  const dates = Array.from({ length: days }, (_, i) => new Date(startMs + i * DAY))
  const contributions = cumulativeContributions(dates, flows)

  return dates.map((date, i) => {
    const positions = foldTransactions(txs, date)
    const valued = valuePositions(positions, assetMap, (symbol) => priceAt(symbol, date), currencyRate)
    let assetsTotal = 0
    let investable = 0
    for (const v of valued) {
      assetsTotal += v.value
      investable += v.investable
    }
    const liab = totalLiabilities(liabilityEntries, date)
    return {
      date,
      assets: Math.round(assetsTotal),
      liabilities: Math.round(liab),
      netWorth: Math.round(assetsTotal - liab),
      investable: Math.round(investable),
      contributions: Math.round(contributions[i]),
    }
  })
}

/** 全量重建某家庭空间的快照（幂等：先清后写） */
export async function rebuildSnapshots(db: PrismaClient, familyId: string): Promise<number> {
  const txsRaw = await db.transaction.findMany({
    where: { familyId },
    include: { asset: true },
    orderBy: { occurredAt: 'asc' },
  })
  await db.snapshot.deleteMany({ where: { familyId } })
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
    accountId: t.accountId,
    assetId: t.assetId,
    type: t.type,
    quantity: t.quantity == null ? null : Number(t.quantity),
    price: t.price == null ? null : Number(t.price),
    amount: Number(t.amount),
    fee: Number(t.fee),
    occurredAt: t.occurredAt,
    assetClass: t.asset.cls,
    internal: t.internal,
    voidedAt: t.voidedAt,
    currency: t.asset.currency,
  }))
  const entries: LiabilityEntryInput[] = entriesRaw.map((e) => ({
    liabilityId: e.liabilityId,
    type: e.type,
    amount: Number(e.amount),
    occurredAt: e.occurredAt,
  }))

  // 价格函数：PriceBar 落库历史优先，缺失回落模拟器；US/HK 标的按当前汇率折人民币（历史汇率未逐日还原，见 README 口径说明）
  const symbols = assetsRaw.filter((a) => !a.manual && a.cls !== 'CASH' && a.cls !== 'REAL_ESTATE').map((a) => a.symbol)
  const priceMap = await loadPriceSeries(db, symbols)
  const basePriceAt = priceAtFn(priceMap)
  const rates = await fxRates()
  const priceAt: PriceAtFn = (symbol, date) => {
    const v = basePriceAt(symbol, date)
    return v == null ? undefined : v * cnyRateFor(symbol, rates)
  }

  const from = txsRaw[0].occurredAt
  const currencyRate = (cur: string) => (cur === 'USD' ? rates.USDCNY : cur === 'HKD' ? rates.HKDCNY : 1)
  const points = computeWealthSeries(txs, assets, entries, from, new Date(), priceAt, currencyRate)
  await db.snapshot.createMany({
    data: points.map((p) => ({
      familyId,
      date: p.date,
      assets: p.assets,
      liabilities: p.liabilities,
      netWorth: p.netWorth,
      investable: p.investable,
      contributions: p.contributions,
    })),
  })
  return points.length
}
