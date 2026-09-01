// 一次性：为 dev.db 补刷行情（等效页面「↻ 行情」refreshPrices 动作）
// 用法：npx tsx scripts/refresh-prices-local.ts
import { prisma } from '@/lib/db'
import { BENCHMARK_INDICES } from '@/lib/engine/benchmark'
import { persistFundHistory, persistHistory, purgeMisroutedFundBars } from '@/lib/market/persist'
import { fxRates, persistDailyFx } from '@/lib/market/fx'
import { rebuildSnapshots } from '@/lib/snapshots'
import { recordAudit } from '@/lib/audit'

async function main() {
  const family = await prisma.familySpace.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!family) throw new Error('未初始化家庭空间')
  const assets = await prisma.asset.findMany({ where: { familyId: family.id, manual: false, cls: { notIn: ['CASH', 'REAL_ESTATE'] } } })
  const from = new Date(Date.now() - 800 * 86400000)
  const fundSymbols = assets.filter((a) => a.cls === 'FUND').map((a) => a.symbol)
  const marketSymbols = [...assets.filter((a) => a.cls !== 'FUND').map((a) => a.symbol), ...BENCHMARK_INDICES.map((i) => i.symbol)]
  const purgedMisrouted = await purgeMisroutedFundBars(prisma, marketSymbols)
  const results = [
    ...(await persistFundHistory(prisma, fundSymbols, from, new Date())),
    ...(await persistHistory(prisma, marketSymbols, from, new Date(), { route: 'EXCHANGE' })),
  ]
  console.log(`✓ 清理误路由场内净值 ${purgedMisrouted} 条`)
  const fxWritten = await persistDailyFx(prisma, await fxRates(prisma))
  console.log(results.map((r) => `${r.symbol}:${r.status}:${r.count}@${r.source}`).join(' '))
  console.log(`✓ 汇率落库 ${fxWritten} 条`)
  const days = await rebuildSnapshots(prisma, family.id)
  console.log(`✓ 快照重建 ${days} 天`)
  const member = await prisma.member.findFirst({ where: { familyId: family.id }, orderBy: { createdAt: 'asc' } })
  const slot = process.env.REFRESH_SLOT ?? 'manual-script'
  await recordAudit(prisma, {
    familyId: family.id,
    actorId: member?.id ?? null,
    actorName: `SYSTEM · ${slot}`,
    action: 'REFRESH',
    entity: 'PriceBar',
    detail: `定时槽 ${slot}；清理误路由场内净值 ${purgedMisrouted} 条；汇率 ${fxWritten} 条；快照 ${days} 天；${results.map((r) => `${r.symbol}:${r.status}:${r.count}@${r.source}`).join(' ')}`,
  })
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
