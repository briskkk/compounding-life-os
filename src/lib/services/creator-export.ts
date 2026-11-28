import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { creatorConfigSchema, type CreatorProfile } from '@/lib/creator-export-contract'
import { scopedDb, type FamilyCtx } from '@/lib/scoped'
import { attributionDateKey } from '@/lib/engine/portfolio-day'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { buildCreatorSnapshot } from '@/lib/engine/creator-snapshot'
import { isInvestableAsset } from '@/lib/asset-classification'

export async function loadCreatorConfig() {
  const file = process.env.CREATOR_EXPORT_CONFIG_PATH
  if (!file) return { version: 1 as const, profiles: [] }
  if (!path.isAbsolute(file) || (await stat(file)).size > 1024 * 1024) throw new Error('Invalid export configuration')
  // Read on every request: atomic file replacement revokes tokens without restarting workers.
  return creatorConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')))
}

export function authenticateCreator(profiles: CreatorProfile[], authorization: string | null) {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/i)
  if (!match) return null
  const digest = createHash('sha256').update(match[1]).digest()
  let authenticated: CreatorProfile | null = null
  for (const profile of profiles) {
    for (const hash of profile.tokenHashes) {
      if (timingSafeEqual(digest, Buffer.from(hash, 'hex')) && profile.enabled) authenticated = profile
    }
  }
  return authenticated
}

/** This capability has no write counterpart and is never accepted by session/API-key auth. */
export async function readCreatorSnapshot(base: PrismaClient, profile: CreatorProfile, date: string, now: Date) {
  // Verify the granting user's current authority; removing or demoting them stops the export.
  const member = await base.member.findFirst({
    where: { familyId: profile.familyId, userId: profile.authorizedByUserId, role: { in: ['OWNER', 'ADMIN'] } },
    select: { id: true },
  })
  if (!member) return null
  const ctx: FamilyCtx = {
    familyId: profile.familyId, userId: profile.authorizedByUserId,
    memberId: member.id, memberName: '', role: 'VIEWER',
  }
  const db = scopedDb(base, ctx)
  const [accounts, assets, transactions, bars, rates] = await db.$transaction(async (tx) => {
    const [accounts, assets, transactions] = await Promise.all([
      tx.account.findMany({ where: { id: { in: profile.accountIds } }, select: { id: true } }),
      tx.asset.findMany({ select: { id: true, symbol: true, name: true, cls: true, manual: true, currency: true } }),
      // Whole-family ledger is needed to resolve boundary settlement legs; none of it is serialized.
      tx.transaction.findMany({ orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
    ])
    const investable = assets.filter(isInvestableAsset)
    const [bars, rates] = await Promise.all([
      tx.priceBar.findMany({
        where: { symbol: { in: investable.map((asset) => asset.symbol) }, date: { lte: new Date(`${date}T23:59:59.999Z`) } },
        orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
      }),
      tx.rateBar.findMany({
        where: { pair: { in: investable.map((asset) => `${asset.currency}CNY`) }, date: { lte: new Date(`${date}T23:59:59.999Z`) } },
        orderBy: [{ pair: 'asc' }, { date: 'asc' }],
      }),
    ])
    return [accounts, assets, transactions, bars, rates] as const
  })
  if (accounts.length !== profile.accountIds.length) return null
  const byAsset = new Map(assets.map((asset) => [asset.id, asset]))
  return buildCreatorSnapshot(profile, {
    assets,
    transactions: transactions.map((tx) => ({
      id: tx.id, accountId: tx.accountId, assetId: tx.assetId, type: tx.type,
      quantity: tx.quantity == null ? null : Number(tx.quantity),
      price: tx.price == null ? null : Number(tx.price), amount: Number(tx.amount), fee: Number(tx.fee),
      occurredAt: tx.occurredAt, navDate: tx.navDate, navSource: tx.navSource,
      settlementDate: tx.settlementDate, internal: tx.internal, voidedAt: tx.voidedAt, settleOfId: tx.settleOfId,
      assetClass: byAsset.get(tx.assetId)!.cls, currency: byAsset.get(tx.assetId)!.currency,
    })),
    prices: bars.map((bar) => ({
      symbol: bar.symbol, date: attributionDateKey({ symbol: bar.symbol }, dateKeyAt(bar.date))!,
      close: Number(bar.close), source: bar.source,
    })),
    rates: rates.map((rate) => ({
      currency: rate.pair === 'USDCNY' ? 'USD' : rate.pair === 'HKDCNY' ? 'HKD' : rate.pair,
      date: dateKeyAt(rate.date), rate: Number(rate.rate), source: rate.source,
    })),
  }, date, now)
}
