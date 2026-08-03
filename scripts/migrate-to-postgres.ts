/**
 * SQLite → PostgreSQL 数据迁移脚本
 *
 * 前置：
 *   1. export DATABASE_URL="postgresql://user:pass@localhost:5432/familywealth"
 *   2. npx prisma generate --schema prisma/schema.postgres.prisma
 *   3. npx prisma db push --schema prisma/schema.postgres.prisma
 *   4. （可选）psql $DATABASE_URL -f prisma/rls.sql
 *
 * 运行：npx tsx scripts/migrate-to-postgres.ts
 * 说明：按依赖顺序整表复制（含原 id，幂等：先清空 PG 侧目标表）。
 * PG 客户端由 prisma generate --schema prisma/schema.postgres.prisma 按需生成，故本文件不做静态类型检查。
 */
// @ts-nocheck
import { PrismaClient as SqliteClient } from '@prisma/client'
import { PrismaClient as PgClient } from '../prisma/generated/pg'

const sqlite = new SqliteClient()
const pg = new PgClient()

async function main() {
  console.log('· 清空 PG 目标表…')
  await pg.$transaction([
    pg.auditLog.deleteMany(),
    pg.assetChatMessage.deleteMany(),
    pg.assetAnalysis.deleteMany(),
    pg.insight.deleteMany(),
    pg.insightAnalysis.deleteMany(),
    pg.snapshot.deleteMany(),
    pg.transaction.deleteMany(),
    pg.liabilityEntry.deleteMany(),
    pg.liability.deleteMany(),
    pg.goal.deleteMany(),
    pg.savingsEntry.deleteMany(),
    pg.familyPrefs.deleteMany(),
    pg.asset.deleteMany(),
    pg.account.deleteMany(),
    pg.member.deleteMany(),
    pg.familySpace.deleteMany(),
    pg.priceBar.deleteMany(),
  ])

  const steps: [string, () => Promise<unknown[]>, (rows: never[]) => Promise<unknown>][] = [
    ['FamilySpace', () => sqlite.familySpace.findMany() as Promise<unknown[]>, (r) => pg.familySpace.createMany({ data: r })],
    ['Member', () => sqlite.member.findMany() as Promise<unknown[]>, (r) => pg.member.createMany({ data: r })],
    ['FamilyPrefs', () => sqlite.familyPrefs.findMany() as Promise<unknown[]>, (r) => pg.familyPrefs.createMany({ data: r })],
    ['Account', () => sqlite.account.findMany() as Promise<unknown[]>, (r) => pg.account.createMany({ data: r })],
    ['Asset', () => sqlite.asset.findMany() as Promise<unknown[]>, (r) => pg.asset.createMany({ data: r })],
    ['AssetAnalysis', () => sqlite.assetAnalysis.findMany() as Promise<unknown[]>, (r) => pg.assetAnalysis.createMany({ data: r })],
    ['AssetChatMessage', () => sqlite.assetChatMessage.findMany() as Promise<unknown[]>, (r) => pg.assetChatMessage.createMany({ data: r })],
    ['Transaction', () => sqlite.transaction.findMany() as Promise<unknown[]>, (r) => pg.transaction.createMany({ data: r })],
    ['Liability', () => sqlite.liability.findMany() as Promise<unknown[]>, (r) => pg.liability.createMany({ data: r })],
    ['LiabilityEntry', () => sqlite.liabilityEntry.findMany() as Promise<unknown[]>, (r) => pg.liabilityEntry.createMany({ data: r })],
    ['Goal', () => sqlite.goal.findMany() as Promise<unknown[]>, (r) => pg.goal.createMany({ data: r })],
    ['SavingsEntry', () => sqlite.savingsEntry.findMany() as Promise<unknown[]>, (r) => pg.savingsEntry.createMany({ data: r })],
    ['Snapshot', () => sqlite.snapshot.findMany() as Promise<unknown[]>, (r) => pg.snapshot.createMany({ data: r })],
    ['InsightAnalysis', () => sqlite.insightAnalysis.findMany() as Promise<unknown[]>, (r) => pg.insightAnalysis.createMany({ data: r })],
    ['Insight', () => sqlite.insight.findMany() as Promise<unknown[]>, (r) => pg.insight.createMany({ data: r })],
    ['AuditLog', () => sqlite.auditLog.findMany() as Promise<unknown[]>, (r) => pg.auditLog.createMany({ data: r })],
    ['PriceBar', () => sqlite.priceBar.findMany() as Promise<unknown[]>, (r) => pg.priceBar.createMany({ data: r })],
  ]

  for (const [name, read, write] of steps) {
    const rows = (await read()) as never[]
    if (rows.length > 0) await write(rows)
    console.log(`  ✓ ${name}: ${rows.length} 行`)
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
