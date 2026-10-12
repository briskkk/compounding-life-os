/**
 * SQLite → PostgreSQL 数据迁移脚本
 *
 * 前置：
 *   1. export SQLITE_DATABASE_URL="file:/absolute/path/to/dev.db"
 *   2. export DATABASE_URL="postgresql://user:pass@localhost:5432/familywealth"
 *   3. 按生产部署流程准备 PG Client 并执行 db push --skip-generate
 *   4. export MIGRATION_CONFIRM="replace-postgres"，运行本脚本并核对行数
 *   5. 数据完成后再执行 psql $DATABASE_URL -f prisma/rls.sql
 *
 * 运行：npx tsx scripts/migrate-to-postgres.ts
 * 说明：按依赖顺序整表复制（含原 id，幂等：先清空 PG 侧目标表）。
 * PG 客户端由 prisma generate --schema prisma/schema.postgres.prisma 按需生成，故本文件不做静态类型检查。
 */
// @ts-nocheck
import { PrismaClient as SqliteClient } from '@prisma/client'
import { PrismaClient as PgClient } from '../prisma/generated/pg'
import path from 'node:path'

const sqliteUrl = process.env.SQLITE_DATABASE_URL?.trim() || `file:${path.resolve('prisma/dev.db')}`
const postgresUrl = process.env.DATABASE_URL?.trim() || ''
if (!sqliteUrl.startsWith('file:')) throw new Error('SQLITE_DATABASE_URL 必须是 file: SQLite 连接')
if (!/^postgres(?:ql)?:\/\//.test(postgresUrl)) throw new Error('DATABASE_URL 必须是 PostgreSQL 连接')
if (process.env.MIGRATION_CONFIRM !== 'replace-postgres') {
  throw new Error('本操作会清空 PostgreSQL 目标库；确认备份后设置 MIGRATION_CONFIRM=replace-postgres')
}

const sqlite = new SqliteClient({ datasourceUrl: sqliteUrl })
const pg = new PgClient()

async function main() {
  console.log('· 清空 PG 目标表…')
  await pg.$transaction([
    pg.auditLog.deleteMany(),
    pg.investmentPlanAsset.deleteMany(),
    pg.investmentPlanDayReview.deleteMany(),
    pg.investmentPlan.deleteMany(),
    pg.corporateAction.deleteMany(),
    pg.fundTradePolicy.deleteMany(),
    pg.cashPlan.deleteMany(),
    pg.allocationTarget.deleteMany(),
    pg.strategyTarget.deleteMany(),
    pg.snapshot.deleteMany(),
    pg.portfolioReview.deleteMany(),
    pg.exposureDisclosure.deleteMany(),
    pg.investmentExperiment.deleteMany(),
    pg.transaction.deleteMany(),
    pg.importBatch.deleteMany(),
    pg.liabilityEntry.deleteMany(),
    pg.liability.deleteMany(),
    pg.goal.deleteMany(),
    pg.savingsEntry.deleteMany(),
    pg.asset.deleteMany(),
    pg.account.deleteMany(),
    pg.member.deleteMany(),
    pg.invite.deleteMany(),
    pg.session.deleteMany(),
    pg.familySpace.deleteMany(),
    pg.user.deleteMany(),
    pg.fundCalibration.deleteMany(),
    pg.fundEstimate.deleteMany(),
    pg.marketProviderDaily.deleteMany(),
    pg.rateBar.deleteMany(),
    pg.priceBar.deleteMany(),
  ])

  const steps: [string, () => Promise<unknown[]>, (rows: never[]) => Promise<unknown>][] = [
    ['FamilySpace', () => sqlite.familySpace.findMany() as Promise<unknown[]>, (r) => pg.familySpace.createMany({ data: r })],
    ['User', () => sqlite.user.findMany() as Promise<unknown[]>, (r) => pg.user.createMany({ data: r })],
    ['Member', () => sqlite.member.findMany() as Promise<unknown[]>, (r) => pg.member.createMany({ data: r })],
    ['Session', () => sqlite.session.findMany() as Promise<unknown[]>, (r) => pg.session.createMany({ data: r })],
    ['Invite', () => sqlite.invite.findMany() as Promise<unknown[]>, (r) => pg.invite.createMany({ data: r })],
    ['Account', () => sqlite.account.findMany() as Promise<unknown[]>, (r) => pg.account.createMany({ data: r })],
    ['Asset', () => sqlite.asset.findMany() as Promise<unknown[]>, (r) => pg.asset.createMany({ data: r })],
    ['ImportBatch', () => sqlite.importBatch.findMany() as Promise<unknown[]>, (r) => pg.importBatch.createMany({ data: r })],
    ['CorporateAction', () => sqlite.corporateAction.findMany() as Promise<unknown[]>, (r) => pg.corporateAction.createMany({ data: r })],
    ['FundTradePolicy', () => sqlite.fundTradePolicy.findMany() as Promise<unknown[]>, (r) => pg.fundTradePolicy.createMany({ data: r })],
    ['Transaction', () => sqlite.transaction.findMany() as Promise<unknown[]>, (r) => pg.transaction.createMany({ data: r })],
    ['Liability', () => sqlite.liability.findMany() as Promise<unknown[]>, (r) => pg.liability.createMany({ data: r })],
    ['LiabilityEntry', () => sqlite.liabilityEntry.findMany() as Promise<unknown[]>, (r) => pg.liabilityEntry.createMany({ data: r })],
    ['Goal', () => sqlite.goal.findMany() as Promise<unknown[]>, (r) => pg.goal.createMany({ data: r })],
    ['AllocationTarget', () => sqlite.allocationTarget.findMany() as Promise<unknown[]>, (r) => pg.allocationTarget.createMany({ data: r })],
    ['StrategyTarget', () => sqlite.strategyTarget.findMany() as Promise<unknown[]>, (r) => pg.strategyTarget.createMany({ data: r })],
    ['CashPlan', () => sqlite.cashPlan.findMany() as Promise<unknown[]>, (r) => pg.cashPlan.createMany({ data: r })],
    ['InvestmentPlan', () => sqlite.investmentPlan.findMany() as Promise<unknown[]>, (r) => pg.investmentPlan.createMany({ data: r })],
    ['InvestmentPlanAsset', () => sqlite.investmentPlanAsset.findMany() as Promise<unknown[]>, (r) => pg.investmentPlanAsset.createMany({ data: r })],
    ['InvestmentPlanDayReview', () => sqlite.investmentPlanDayReview.findMany() as Promise<unknown[]>, (r) => pg.investmentPlanDayReview.createMany({ data: r })],
    ['SavingsEntry', () => sqlite.savingsEntry.findMany() as Promise<unknown[]>, (r) => pg.savingsEntry.createMany({ data: r })],
    ['Snapshot', () => sqlite.snapshot.findMany() as Promise<unknown[]>, (r) => pg.snapshot.createMany({ data: r })],
    ['ExposureDisclosure', () => sqlite.exposureDisclosure.findMany() as Promise<unknown[]>, (r) => pg.exposureDisclosure.createMany({ data: r })],
    ['InvestmentExperiment', () => sqlite.investmentExperiment.findMany() as Promise<unknown[]>, (r) => pg.investmentExperiment.createMany({ data: r })],
    ['PortfolioReview', () => sqlite.portfolioReview.findMany() as Promise<unknown[]>, (r) => pg.portfolioReview.createMany({ data: r })],
    ['AuditLog', () => sqlite.auditLog.findMany() as Promise<unknown[]>, (r) => pg.auditLog.createMany({ data: r })],
    ['PriceBar', () => sqlite.priceBar.findMany() as Promise<unknown[]>, (r) => pg.priceBar.createMany({ data: r })],
    ['MarketProviderDaily', () => sqlite.marketProviderDaily.findMany() as Promise<unknown[]>, (r) => pg.marketProviderDaily.createMany({ data: r })],
    ['RateBar', () => sqlite.rateBar.findMany() as Promise<unknown[]>, (r) => pg.rateBar.createMany({ data: r })],
    ['FundEstimate', () => sqlite.fundEstimate.findMany() as Promise<unknown[]>, (r) => pg.fundEstimate.createMany({ data: r })],
    ['FundCalibration', () => sqlite.fundCalibration.findMany() as Promise<unknown[]>, (r) => pg.fundCalibration.createMany({ data: r })],
  ]

  for (const [name, read, write] of steps) {
    const rows = (await read()) as never[]
    if (rows.length > 0) await write(rows)
    console.log(`  ✓ ${name}: ${rows.length} 行`)
  }
  const [sqliteCounts, pgCounts] = await Promise.all([
    Promise.all(steps.map(async ([name, read]) => [name, (await read()).length] as const)),
    Promise.all([
      ['FamilySpace', pg.familySpace.count()], ['User', pg.user.count()], ['Member', pg.member.count()],
      ['Session', pg.session.count()], ['Invite', pg.invite.count()], ['Account', pg.account.count()],
      ['Asset', pg.asset.count()], ['ImportBatch', pg.importBatch.count()], ['CorporateAction', pg.corporateAction.count()], ['FundTradePolicy', pg.fundTradePolicy.count()], ['Transaction', pg.transaction.count()],
      ['Liability', pg.liability.count()], ['LiabilityEntry', pg.liabilityEntry.count()], ['Goal', pg.goal.count()],
      ['AllocationTarget', pg.allocationTarget.count()], ['StrategyTarget', pg.strategyTarget.count()], ['CashPlan', pg.cashPlan.count()],
      ['InvestmentPlan', pg.investmentPlan.count()], ['InvestmentPlanAsset', pg.investmentPlanAsset.count()], ['InvestmentPlanDayReview', pg.investmentPlanDayReview.count()],
      ['SavingsEntry', pg.savingsEntry.count()], ['Snapshot', pg.snapshot.count()], ['PortfolioReview', pg.portfolioReview.count()],
      ['ExposureDisclosure', pg.exposureDisclosure.count()], ['InvestmentExperiment', pg.investmentExperiment.count()],
      ['AuditLog', pg.auditLog.count()], ['PriceBar', pg.priceBar.count()], ['MarketProviderDaily', pg.marketProviderDaily.count()], ['RateBar', pg.rateBar.count()],
      ['FundEstimate', pg.fundEstimate.count()], ['FundCalibration', pg.fundCalibration.count()],
    ].map(async ([name, count]) => [name, await count] as const)),
  ])
  const pgCountByName = new Map(pgCounts)
  const mismatches = sqliteCounts.filter(([name, count]) => pgCountByName.get(name) !== count)
  if (mismatches.length > 0) {
    throw new Error(`迁移后行数校验失败：${mismatches.map(([name, count]) => `${name} SQLite=${count} PG=${pgCountByName.get(name)}`).join('；')}`)
  }
  console.log('迁移完成。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await sqlite.$disconnect()
    await pg.$disconnect()
  })
