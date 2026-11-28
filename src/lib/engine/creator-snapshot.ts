import { createHash } from 'node:crypto'
import type { CreatorCalendar, CreatorProfile, CreatorSnapshot } from '@/lib/creator-export-contract'
import { isInvestableAsset } from '@/lib/asset-classification'
import { parseSymbol } from '@/lib/market/symbols'
import { foldTransactionsAt, roundMoney, type LedgerTx } from './ledger'
import type { AssetInfo } from './types'
import { dateKeyAt } from './watch-market'
import { chinaFundCalendarCoverage, isChinaFundTradingDay } from './china-trading-calendar'

const DAY = 86400000
export function shiftCreatorDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
}

/** null means the configured calendar does not cover this date. */
export function creatorSession(calendar: CreatorCalendar, date: string): boolean | null {
  if (calendar.kind === 'EXPLICIT') {
    if (date < calendar.from || date > calendar.through) return null
    return calendar.sessions.includes(date)
  }
  const day = new Date(`${date}T12:00:00+08:00`)
  return chinaFundCalendarCoverage(day) === 'PUBLISHED' ? isChinaFundTradingDay(day) : null
}

function previousSession(calendar: CreatorCalendar, date: string): string | null {
  // Bounded by the maximum supported explicit calendar / published CN coverage.
  for (let i = 1; i <= 36600; i++) {
    const key = shiftCreatorDate(date, -i)
    const session = creatorSession(calendar, key)
    if (session == null) return null
    if (session) return key
  }
  return null
}

export interface CreatorPrice {
  symbol: string
  date: string // Beijing attribution date, already shifted for US sessions
  close: number
  source: string
}
export interface CreatorRate {
  currency: string
  date: string
  rate: number
  source: string
}
export interface CreatorSource {
  assets: AssetInfo[]
  transactions: LedgerTx[]
  prices: CreatorPrice[]
  rates: CreatorRate[]
}

class PendingEvidence extends Error {}
const pending = (): never => { throw new PendingEvidence() }
const usable = (value: number) => Number.isFinite(value) && value > 0
const realSource = (source: string) => !!source && !/SIMULAT|ESTIMATE/i.test(source)
function money(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) return pending()
  const cents = Math.round(roundMoney(value) * 100)
  return (cents === 0 ? 0 : cents / 100).toFixed(2)
}

export function buildCreatorSnapshot(
  profile: CreatorProfile, source: CreatorSource, date: string, now: Date,
): CreatorSnapshot {
  const common = { profile: profile.slug, date }
  const session = creatorSession(profile.calendar, date)
  if (session === false) return { ...common, status: 'no_session' }
  if (session == null) return { ...common, status: 'pending' }
  const cutoffAt = `${date}T${profile.cutoffTime}+08:00`
  const cutoff = new Date(cutoffAt)
  if (cutoff > now) return { ...common, status: 'pending' }

  try {
    const accounts = new Set(profile.accountIds)
    const assets = new Map(source.assets.map((asset) => [asset.id, asset]))
    const inScope = (tx: LedgerTx) => accounts.has(tx.accountId)
      && !!assets.get(tx.assetId) && isInvestableAsset(assets.get(tx.assetId)!)
    const active = source.transactions.filter((tx) => !tx.voidedAt && tx.type !== 'REVERSAL')
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id ?? '').localeCompare(b.id ?? ''))
    const scoped = active.filter(inScope)
    // Evidence includes only values actually used, not credentials or wall-clock retrieval time.
    const evidence: unknown[] = []
    const fx = (currency: string, key: string): number => {
      if (currency === 'CNY') return 1
      if (currency !== 'USD' && currency !== 'HKD') return pending()
      let expected = key
      while ([0, 6].includes(new Date(`${expected}T00:00:00Z`).getUTCDay())) expected = shiftCreatorDate(expected, -1)
      const rate = source.rates.find((row) => row.currency === currency && row.date === expected)
      if (!rate || !usable(rate.rate) || !realSource(rate.source)) return pending()
      evidence.push(['fx', currency, expected, rate.rate, rate.source])
      return rate.rate
    }
    const price = (asset: AssetInfo, key: string): number => {
      const market = parseSymbol(asset.symbol, asset.cls === 'FUND' ? 'FUND' : 'EXCHANGE').market
      const calendar = profile.valuationCalendars[asset.id]
        ?? (asset.cls === 'FUND' || market === 'CN_A' || market === 'INDEX' ? { kind: 'CN_FUND' as const } : null)
      if (!calendar) return pending()
      const trading = creatorSession(calendar, key)
      if (trading == null) return pending()
      const expected = trading ? key : previousSession(calendar, key)
      if (!expected) return pending()
      // A same-day closing bar cannot settle a snapshot with a pre-close cutoff.
      if (expected === key) {
        const earliestClose = asset.cls === 'FUND' || market === 'CN_A' || market === 'INDEX' ? '15:00:00'
          : market === 'HK' ? '16:15:00' : market === 'US' ? '06:00:00' : '23:59:59'
        if (profile.cutoffTime < earliestClose) return pending()
      }
      const row = source.prices.find((item) => item.symbol === asset.symbol && item.date === expected)
      if (!row || !usable(row.close) || !realSource(row.source)
        || (asset.cls === 'FUND' && row.source.toUpperCase() !== 'EASTMONEY-FUND')
        || (asset.cls !== 'FUND' && row.source.toUpperCase() === 'EASTMONEY-FUND')) return pending()
      evidence.push(['price', asset.id, expected, row.close, row.source])
      return row.close * fx(asset.currency, key)
    }
    const byId = new Map(active.filter((tx) => tx.id).map((tx) => [tx.id!, tx]))
    const legsByParent = new Map<string, LedgerTx[]>()
    for (const tx of active) {
      if (tx.settleOfId) legsByParent.set(tx.settleOfId, [...(legsByParent.get(tx.settleOfId) ?? []), tx])
    }
    const valueAt = (key: string): number => {
      const at = new Date(`${key}T${profile.cutoffTime}+08:00`)
      const through = scoped.filter((tx) => tx.occurredAt <= at)
      if (through.some((tx) => tx.navSource === 'PENDING' || tx.navSource === 'ESTIMATE')) return pending()
      let total = 0
      for (const position of foldTransactionsAt(scoped, at)) {
        const asset = assets.get(position.assetId)!
        if (asset.cls === 'CASH') total += position.quantity * fx(asset.currency, key)
        else if (Math.abs(position.quantity) > 1e-9 || position.manualValue != null) {
          if (asset.manual) {
            // Manual gold needs an explicit valuation at this cutoff, never a cost fallback.
            if (position.manualValue == null || !position.lastValuationAt || dateKeyAt(position.lastValuationAt) !== key) return pending()
            total += position.manualValue
          } else total += position.quantity * price(asset, key)
        }
      }
      // Receivables belong to the scope only while both the sold asset and destination cash do.
      for (const leg of active) {
        if (!leg.internal || leg.type !== 'DEPOSIT' || !leg.settleOfId || leg.occurredAt <= at || !inScope(leg)) continue
        const sell = byId.get(leg.settleOfId)
        if (sell?.type === 'SELL' && sell.occurredAt <= at && inScope(sell)) {
          total += leg.amount * fx(leg.currency ?? 'CNY', key)
          evidence.push(['receivable', leg.id, leg.amount, leg.occurredAt.toISOString()])
        }
      }
      evidence.push(['ledger', key, through.map((tx) => [
        tx.id, tx.accountId, tx.assetId, tx.type, tx.quantity, tx.price, tx.amount, tx.fee,
        tx.occurredAt.toISOString(), tx.navDate?.toISOString(), tx.navSource, tx.settleOfId,
      ]), scoped.filter((tx) => tx.type === 'SHARE_ADJUSTMENT' && tx.occurredAt > at)
        .map((tx) => [tx.id, tx.quantity, tx.price, tx.occurredAt.toISOString()])])
      return roundMoney(total)
    }

    let dayNumber = 0
    for (let key = profile.startDate; key <= date; key = shiftCreatorDate(key, 1)) {
      const day = creatorSession(profile.calendar, key)
      if (day == null) return pending()
      if (day) dayNumber++
    }
    if (dayNumber === 0) return pending()
    const kind = dayNumber === 1 ? 'baseline' as const : 'daily' as const
    const total = valueAt(date)
    let netContribution: string | null = null
    let pnl: string | null = null
    if (kind === 'daily') {
      const previous = previousSession(profile.calendar, date)
      if (!previous) return pending()
      const opening = valueAt(previous)
      const start = new Date(`${previous}T${profile.cutoffTime}+08:00`)
      let flows = 0
      const transferQuantities = new Map<string, number>()
      const internalTransferAssets = new Set<string>()
      for (const tx of scoped.filter((item) => item.occurredAt > start && item.occurredAt <= cutoff)) {
        const asset = assets.get(tx.assetId)!
        const rate = fx(asset.currency, dateKeyAt(tx.occurredAt))
        evidence.push(['flow', tx.id, tx.settleOfId ? byId.get(tx.settleOfId) : null,
          tx.id ? legsByParent.get(tx.id) : null])
        if (tx.type === 'DEPOSIT' || tx.type === 'WITHDRAW') {
          // Unlinked internal cash movements have no verifiable counterpart.
          const parent = tx.settleOfId ? byId.get(tx.settleOfId) : null
          if (tx.internal && !parent) return pending()
          if (!tx.internal || (parent && !inScope(parent))) flows += (tx.type === 'DEPOSIT' ? 1 : -1) * tx.amount * rate
        } else if (tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') {
          if (tx.quantity == null) return pending()
          if (tx.internal) internalTransferAssets.add(tx.assetId)
          transferQuantities.set(tx.assetId, (transferQuantities.get(tx.assetId) ?? 0)
            + (tx.type === 'TRANSFER_IN' ? 1 : -1) * tx.quantity)
        } else if (tx.type === 'BUY' || tx.type === 'SELL') {
          const legs = tx.id ? legsByParent.get(tx.id) ?? [] : []
          if (legs.length > 1) return pending()
          if (legs.length === 0 && asset.cls !== 'GOLD') return pending()
          if (legs.length === 0 || !inScope(legs[0])) {
            flows += (tx.type === 'BUY' ? tx.amount + tx.fee : -(tx.amount - tx.fee)) * rate
          }
        } else if ((tx.type === 'DIVIDEND' || tx.type === 'INTEREST') && asset.cls !== 'CASH') {
          const legs = tx.id ? legsByParent.get(tx.id) ?? [] : []
          if (legs.length !== 1) return pending()
          if (!inScope(legs[0])) flows -= (tx.amount - tx.fee) * rate
        }
      }
      // Internal security transfers cancel in quantity; boundary transfers use closing fair value, never cost.
      for (const [assetId, quantity] of transferQuantities) {
        if (Math.abs(quantity) < 1e-9) continue
        if (internalTransferAssets.has(assetId)) return pending()
        const asset = assets.get(assetId)!
        if (asset.manual) return pending()
        flows += quantity * (asset.cls === 'CASH' ? fx(asset.currency, date) : price(asset, date))
      }
      netContribution = money(flows)
      // Work in published cents so the exported bridge reconciles exactly.
      pnl = money(Number(money(total)) - Number(money(opening)) - Number(netContribution))
    }

    const operations = scoped.filter((tx) => (tx.type === 'BUY' || tx.type === 'SELL')
      && !tx.internal && !tx.settleOfId && tx.occurredAt <= cutoff && dateKeyAt(tx.occurredAt) === date)
      .map((tx) => {
        const label = profile.operationLabels[tx.assetId]
        if (!label) return pending()
        return { side: tx.type as 'BUY' | 'SELL', label, amount: money(tx.amount * fx(tx.currency ?? 'CNY', date)) }
      })
    const body = {
      ...common, status: 'ready' as const, kind, dayNumber, currency: 'CNY' as const,
      accountScopeLabel: profile.accountScopeLabel, assetTotal: money(total), pnl, netContribution,
      valuation: { status: 'SETTLED' as const, asOfDate: date, cutoffAt }, operations,
    }
    const usedAssets = new Set(scoped.filter((tx) => tx.occurredAt <= cutoff).map((tx) => tx.assetId))
    const basis = {
      version: 1, family: profile.familyId, accounts: [...profile.accountIds].sort(), scope: profile.scope,
      start: profile.startDate, cutoff: profile.cutoffTime, calendar: profile.calendar,
      valuationCalendars: Object.entries(profile.valuationCalendars).sort(([a], [b]) => a.localeCompare(b)),
      assets: source.assets.filter((asset) => usedAssets.has(asset.id))
        .map((asset) => [asset.id, asset.symbol, asset.cls, asset.currency, asset.manual]).sort(),
    }
    const digest = createHash('sha256').update(JSON.stringify([basis, body, evidence])).digest('hex')
    return { ...body, snapshotId: `cs1_${digest}` }
  } catch (error) {
    if (error instanceof PendingEvidence) return { ...common, status: 'pending' }
    throw error
  }
}
