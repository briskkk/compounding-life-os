/**
 * 一次性修补：把 2026-09-09 记错账户的两笔华安基金申购移回「华安基金」。
 *
 * 背景：040046 / 014978 在 2026-09-09 的申购实际发生在华安基金（用户确认），
 * 但当前有效的两条 OFFICIAL 流水记在「南方基金」账户下，而这两只基金的计划
 * 限定账户是「华安基金」（ADR-024 第 5 条要求候选资产 + 计划账户 + 同日三者同时成立），
 * 因此计划页把这天判为「未录入」，并把 09-15 那条「未买核对」当作最终状态显示成「未买入」。
 *
 * 本脚本（幂等，可重复运行）：
 * 1. 把 2026-09-09 这两只基金当前有效的 BUY 流水从「南方基金」改为「华安基金」。
 *    两个账户的结算账户同为招商银行，现金结算腿（settleOfId 指向该 BUY）语义不变，
 *    因此只改持仓归属，不新增或删除任何现金腿。
 * 2. 撤销这两条计划在 2026-09-09 上尚未撤销的「未买核对」证据（置 revokedAt，保留原记录）。
 * 3. 追加审计记录并自 2026-09-09 起增量重建快照。
 *
 * 运行：
 *   npx tsx scripts/fix-investment-plan-account-attribution.ts            # 预演，只打印
 *   npx tsx scripts/fix-investment-plan-account-attribution.ts --apply    # 实际写入
 */
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import { auditedTransaction, recordAudit, verifyChain } from '../src/lib/audit'
import { rebuildSnapshots } from '../src/lib/snapshots'

const APPLY = process.argv.includes('--apply')
const DB_PATH = path.resolve('prisma/dev.db')
const prisma = new PrismaClient({ datasourceUrl: `file:${DB_PATH}` })

const TARGET_DATE = '2026-09-09'
const FROM_ACCOUNT = '南方基金'
const TO_ACCOUNT = '华安基金'
const SYMBOLS = ['040046', '014978'] as const

const noon = new Date(`${TARGET_DATE}T12:00:00+08:00`)
const localDate = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

async function main() {
  const from = await prisma.account.findFirst({ where: { name: FROM_ACCOUNT } })
  const to = await prisma.account.findFirst({ where: { name: TO_ACCOUNT } })
  if (!from || !to) throw new Error(`账户不存在：${FROM_ACCOUNT} / ${TO_ACCOUNT}`)
  if (from.settlementAccountId !== to.settlementAccountId) {
    throw new Error('两个账户的结算账户不同，移仓会改变现金腿语义，请先人工确认')
  }
  const owner = await prisma.member.findFirst({ where: { familyId: from.familyId, role: 'OWNER' }, include: { user: true } })
  if (!owner) throw new Error('找不到家庭 OWNER，无法写入审计')

  const assets = await prisma.asset.findMany({ where: { symbol: { in: [...SYMBOLS] } } })
  if (assets.length !== SYMBOLS.length) throw new Error('目标基金数量不符')

  const dayStart = new Date(`${TARGET_DATE}T00:00:00+08:00`)
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const moves = await prisma.transaction.findMany({
    where: {
      assetId: { in: assets.map((asset) => asset.id) },
      accountId: from.id,
      type: 'BUY',
      voidedAt: null,
      occurredAt: { gte: dayStart, lt: dayEnd },
    },
    include: { asset: true },
    orderBy: { createdAt: 'asc' },
  })

  const plans = await prisma.investmentPlan.findMany({
    where: { accountId: to.id, assets: { some: { assetId: { in: assets.map((asset) => asset.id) } } } },
    include: { assets: true },
  })
  const reviews = await prisma.investmentPlanDayReview.findMany({
    where: {
      planId: { in: plans.map((plan) => plan.id) },
      revokedAt: null,
      scheduledDate: { gte: dayStart, lt: dayEnd },
    },
    include: { plan: true },
  })

  console.log(`目标库：${DB_PATH}`)
  console.log(`模式：${APPLY ? '实际写入' : '预演（加 --apply 才写入）'}`)
  console.log(`\n待迁移流水（${FROM_ACCOUNT} → ${TO_ACCOUNT}，${TARGET_DATE}）：`)
  if (moves.length === 0) console.log('  （无：可能已经修补过）')
  for (const move of moves) {
    console.log(`  ${move.asset.symbol} ${move.asset.name} · ¥${Number(move.amount)} · ${move.navSource} · id…${move.id.slice(-6)} · 创建 ${move.createdAt.toISOString()}`)
  }
  console.log(`\n待撤销的未买核对（${TARGET_DATE}）：`)
  if (reviews.length === 0) console.log('  （无：可能已经撤销过）')
  for (const review of reviews) {
    console.log(`  ${review.plan.name} · scheduledDate ${localDate(review.scheduledDate)} · id…${review.id.slice(-6)}`)
  }

  if (!APPLY) {
    console.log('\n预演结束。确认无误后追加 --apply。')
    return
  }
  if (moves.length === 0 && reviews.length === 0) {
    console.log('\n没有需要修补的内容，未做任何写入。')
    return
  }

  await auditedTransaction(prisma, from.familyId, async (tx) => {
    for (const move of moves) {
      await tx.transaction.update({ where: { id: move.id }, data: { accountId: to.id } })
      await recordAudit(tx, {
        familyId: from.familyId,
        actorId: owner.userId,
        actorName: owner.name,
        action: 'UPDATE',
        entity: 'Transaction',
        entityId: move.id,
        detail: `账户归属修正：${move.asset.symbol} ${localDate(move.occurredAt)} ¥${Number(move.amount)} · ${FROM_ACCOUNT} → ${TO_ACCOUNT}（实际由华安基金申购）`,
      })
      console.log(`  已迁移 ${move.asset.symbol} ¥${Number(move.amount)}`)
    }
    for (const review of reviews) {
      await tx.investmentPlanDayReview.update({ where: { id: review.id }, data: { revokedAt: new Date() } })
      await recordAudit(tx, {
        familyId: from.familyId,
        actorId: owner.userId,
        actorName: owner.name,
        action: 'UPDATE',
        entity: 'InvestmentPlanDayReview',
        entityId: review.id,
        detail: `${review.plan.name} · ${TARGET_DATE} · 撤销未买核对（该日账本已有有效买入，账户归属已修正为${TO_ACCOUNT}）`,
      })
      console.log(`  已撤销未买核对 ${review.plan.name}`)
    }
  }, { timeout: 60000 })

  const rebuilt = await rebuildSnapshots(prisma, from.familyId, { affectedSince: noon })
  console.log(`  已增量重建快照：${rebuilt} 天（自 ${TARGET_DATE} 起）`)

  const chain = await verifyChain(prisma, from.familyId)
  console.log(`  审计链：${chain.ok ? '完整' : `断裂于 ${chain.brokenAt}`}（${chain.count} 条）`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
