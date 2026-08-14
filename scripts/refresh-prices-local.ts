// 一次性：为 dev.db 补刷行情（等效页面「↻ 行情」refreshPrices 动作）
// 用法：npx tsx scripts/refresh-prices-local.ts
import { prisma } from '@/lib/db'
import { BENCHMARK_INDICES } from '@/lib/engine/benchmark'
import { persistFundHistory, persistHistory } from '@/lib/market/persist'
import { fxRates, persistDailyFx } from '@/lib/market/fx'
import { rebuildSnapshots } from '@/lib/snapshots'

async function main() {
  const family = await prisma.familySpace.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!family) throw new Error('未初始化家庭空间')
  const assets = await prisma.asset.findMany({ where: { familyId: family.id, manual: false, cls: { notIn: ['CASH', 'REAL_ESTATE'] } } })
  const from = new Date(Date.now() - 800 * 86400000)
  const fundSymbols = assets.filter((a) => a.cls === 'FUND').map((a) => a.symbol)
  const marketSymbols = [...assets.filter((a) => a.cls !== 'FUND').map((a) => a.symbol), ...BENCHMARK_INDICES.map((i) => i.symbol)]
  const results = [
    ...(await persistFundHistory(prisma, fundSymbols, from, new Date())),
    ...(await persistHistory(prisma, marketSymbols, from, new Date())),
  ]
  const fxWritten = await persistDailyFx(prisma, await fxRates())
  console.log(results.map((r) => `${r.symbol}:${r.count}@${r.source}`).join(' '))
  console.log(`✓ 汇率落库 ${fxWritten} 条`)
  const days = await rebuildSnapshots(prisma, family.id)
  console.log(`✓ 快照重建 ${days} 天`)
}

main().finally(() => prisma.$disconnect())
