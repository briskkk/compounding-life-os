// 后台行情任务：按收盘时段刷新当前持仓；full 模式执行完整维护。
// 用法：REFRESH_SLOT=us-close|cn-close|fund-nav|full npx tsx scripts/refresh-prices-local.ts
import { prisma } from '@/lib/db'
import { persistFundHistory, persistHistory, purgeMisroutedFundBars } from '@/lib/market/persist'
import { backfillHistoricalFx, fxRates, persistDailyFx } from '@/lib/market/fx'
import { rebuildSnapshots } from '@/lib/snapshots'
import { recordAudit } from '@/lib/audit'
import { scanSplitEvents } from '@/lib/services/split-discovery'
import { activeAssetIdsFromLedger, buildMarketRefreshPlan, refreshSlotOf } from '@/lib/market/refresh-plan'
import type { AssetInfo } from '@/lib/engine/types'
import type { LedgerTx } from '@/lib/engine/ledger'

const DAY = 86400000

function elapsed(startedAt: number) {
  return Date.now() - startedAt
}

async function main() {
  const slot = refreshSlotOf(process.env.REFRESH_SLOT, 'full')
  const families = await prisma.familySpace.findMany({ orderBy: { createdAt: 'asc' } })
  if (families.length === 0) throw new Error('未初始化家庭空间')

  for (const family of families) {
    const startedAt = Date.now()
    const timings = { splitScanMs: 0, historyMs: 0, fxMs: 0, snapshotsMs: 0 }
    const [assetRows, transactionRows, member, scanner] = await Promise.all([
      prisma.asset.findMany({ where: { familyId: family.id } }),
      prisma.transaction.findMany({ where: { familyId: family.id }, include: { asset: true }, orderBy: { occurredAt: 'asc' } }),
      prisma.member.findFirst({ where: { familyId: family.id }, orderBy: { createdAt: 'asc' } }),
      prisma.member.findFirst({ where: { familyId: family.id, role: { in: ['OWNER', 'ADMIN'] } }, orderBy: { createdAt: 'asc' } }),
    ])
    const assets: AssetInfo[] = assetRows.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      cls: asset.cls,
      manual: asset.manual,
      currency: asset.currency,
    }))
    const ledgerTxs: LedgerTx[] = transactionRows.map((tx) => ({
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
      internal: tx.internal,
      voidedAt: tx.voidedAt,
      settleOfId: tx.settleOfId,
      assetClass: tx.asset.cls,
      currency: tx.asset.currency,
    }))
    const plan = buildMarketRefreshPlan(assets, activeAssetIdsFromLedger(ledgerTxs), slot)
    const from = ledgerTxs[0]?.occurredAt ?? new Date(Date.now() - 800 * DAY)
    const actorName = `SYSTEM · ${slot}`

    if (slot === 'full' && scanner) {
      const phaseAt = Date.now()
      const scan = await scanSplitEvents(prisma, {
        familyId: family.id,
        memberId: scanner.id,
        memberName: actorName,
        role: scanner.role,
        userId: scanner.userId ?? '',
      })
      timings.splitScanMs = elapsed(phaseAt)
      console.log(`[${family.name}] 拆分检查：${scan.events.length} 条线索，${scan.errors.length} 个失败；待核对事件见 /corporate-actions`)
    }

    if (slot === 'full') await prisma.priceBar.deleteMany({ where: { source: 'SIMULATED' } })
    const purgedMisrouted = await purgeMisroutedFundBars(prisma, plan.marketSymbols)
    const historyAt = Date.now()
    const [fundResults, marketResults] = await Promise.all([
      persistFundHistory(prisma, plan.fundSymbols, from, new Date()),
      persistHistory(prisma, plan.marketSymbols, from, new Date(), { route: 'EXCHANGE' }),
    ])
    const results = [...fundResults, ...marketResults]
    timings.historyMs = elapsed(historyAt)

    const fxAt = Date.now()
    let fxBackfilled = 0
    let fxBackfillWarning = ''
    if (slot === 'full' && plan.hasForeignCurrency) {
      try {
        fxBackfilled = await backfillHistoricalFx(prisma, from)
      } catch (error) {
        fxBackfillWarning = `；历史汇率回填失败：${error instanceof Error ? error.message : String(error)}`
      }
    }
    const fxWritten = plan.hasForeignCurrency ? await persistDailyFx(prisma, await fxRates(prisma)) : 0
    timings.fxMs = elapsed(fxAt)

    const snapshotsAt = Date.now()
    const changedFrom = results
      .map((result) => result.changedFrom ? new Date(result.changedFrom) : null)
      .filter((date): date is Date => date != null && Number.isFinite(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0]
    const today = new Date(Math.floor(Date.now() / DAY) * DAY)
    const days = slot === 'full'
      ? await rebuildSnapshots(prisma, family.id)
      : await rebuildSnapshots(prisma, family.id, { affectedSince: changedFrom ?? today })
    timings.snapshotsMs = elapsed(snapshotsAt)
    const totalMs = elapsed(startedAt)
    const detail = `定时槽 ${slot}；标的 ${results.length} 个；清理误路由场内净值 ${purgedMisrouted} 条；`
      + `汇率回填 ${fxBackfilled} 条、当日 ${fxWritten} 条${fxBackfillWarning}；快照 ${days} 天；`
      + `耗时 ${totalMs}ms（拆分 ${timings.splitScanMs} / 行情 ${timings.historyMs} / 汇率 ${timings.fxMs} / 快照 ${timings.snapshotsMs}）；`
      + results.map((result) => `${result.symbol}:${result.status}:${result.count}@${result.source}`).join(' ')
    console.log(`[${family.name}] ${detail}`)
    await recordAudit(prisma, {
      familyId: family.id,
      actorId: member?.id ?? null,
      actorName,
      action: 'REFRESH',
      entity: 'PriceBar',
      detail,
    })
  }
}

main().catch(async (error) => {
  const family = await prisma.familySpace.findFirst({ orderBy: { createdAt: 'asc' } }).catch(() => null)
  if (family) {
    await recordAudit(prisma, {
      familyId: family.id,
      actorId: null,
      actorName: `SYSTEM · ${process.env.REFRESH_SLOT ?? 'manual-script'}`,
      action: 'REFRESH',
      entity: 'PriceBar',
      detail: `JOB_FAILED:${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => undefined)
  }
  console.error(error)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
