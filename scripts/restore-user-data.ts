/**
 * 用户真实数据重建（一次性）
 * 依据会话记录精确还原：家庭/成员/账户/资产/标签/流水（含冲正对与结算腿）
 * 运行：npx tsx scripts/restore-user-data.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { recordAudit } from '../src/lib/audit'
import { rebuildSnapshots } from '../src/lib/snapshots'

// 显式锚定当前项目目录的 dev.db，避免相对路径被解析到别处（本次事故根因）
const prisma = new PrismaClient({ datasourceUrl: `file:${path.resolve('prisma/dev.db')}` })

const d = (s: string) => new Date(`${s}T10:00:00+08:00`)

async function main() {
  const existing = await prisma.familySpace.findFirst({ include: { members: true } })
  if (existing?.name === '秦人集合') {
    console.log('已是「秦人集合」，跳过（避免重复重建）')
    return
  }

  console.log('· 清空种子数据…')
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.snapshot.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.liabilityEntry.deleteMany(),
    prisma.liability.deleteMany(),
    prisma.goal.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.account.deleteMany(),
    prisma.member.deleteMany(),
    prisma.familySpace.deleteMany(),
  ])

  console.log('· 重建家庭空间…')
  const fam = await prisma.familySpace.create({ data: { name: '秦人集合' } })
  const fid = fam.id
  const me = await prisma.member.create({ data: { familyId: fid, name: '华哥', role: 'OWNER' } })

  console.log('· 重建账户…')
  const hsbc = await prisma.account.create({ data: { familyId: fid, name: '汇丰投资', type: 'BROKERAGE', institution: '汇丰', currency: 'USD' } })
  const cmb = await prisma.account.create({ data: { familyId: fid, name: '招商银行', type: 'BANK', institution: '招商银行', currency: 'CNY' } })
  await prisma.account.update({ where: { id: hsbc.id }, data: { settlementAccountId: hsbc.id } })
  void cmb

  console.log('· 重建资产…')
  const cashCny = await prisma.asset.create({ data: { familyId: fid, symbol: 'CASH-CNY', name: '人民币现金', cls: 'CASH', currency: 'CNY' } })
  void cashCny
  const cashUsd = await prisma.asset.create({ data: { familyId: fid, symbol: 'CASH-USD', name: '美元现金', cls: 'CASH', currency: 'USD' } })
  const qqqm = await prisma.asset.create({ data: { familyId: fid, symbol: 'USQQQM', name: '纳指100ETF·QQQM', cls: 'ETF', currency: 'USD', tags: '美元基金' } })
  const smh = await prisma.asset.create({ data: { familyId: fid, symbol: 'USSMH', name: '半导体ETF-SMH', cls: 'ETF', currency: 'USD', tags: '美元基金' } })
  const vgt = await prisma.asset.create({ data: { familyId: fid, symbol: 'USVGT', name: '信息科技ETF-VGT', cls: 'ETF', currency: 'USD' } })
  const voo = await prisma.asset.create({ data: { familyId: fid, symbol: 'USVOO', name: '标普500ETF-VOO', cls: 'ETF', currency: 'USD' } })
  const qndx = await prisma.asset.create({ data: { familyId: fid, symbol: 'USQNDX', name: 'SS纳指ETF-QNDX', cls: 'ETF', currency: 'USD' } })

  console.log('· 重建流水（含被冲正的原始人民币录入）…')
  type Tx = {
    accountId: string
    assetId: string
    type: 'BUY' | 'SELL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'VALUATION' | 'VEST' | 'REVERSAL'
    quantity?: number
    price?: number
    amount: number
    occurredAt: Date
    note?: string
    internal?: boolean
    settleOfId?: string
    voidedAt?: Date
    reversalOfId?: string
  }
  const txs: (Tx & { id: string })[] = []
  const push = (t: Tx & { id: string }) => txs.push(t)
  const buyWithSettle = (assetId: string, qty: number, price: number, date: string, note: string) => {
    const id = randomUUID()
    const amount = Math.round(qty * price * 1000) / 1000
    push({ id, accountId: hsbc.id, assetId, type: 'BUY', quantity: qty, price, amount, occurredAt: d(date), note })
    push({ id: randomUUID(), accountId: hsbc.id, assetId: cashUsd.id, type: 'WITHDRAW', amount, occurredAt: d(date), note: `结算 · #${id.slice(0, 8)}`, internal: true, settleOfId: id })
    return id
  }

  // 被冲正的最初一笔（人民币折算录入，07-25 已冲正，保留历史）
  const oldId = randomUUID()
  push({ id: oldId, accountId: hsbc.id, assetId: qqqm.id, type: 'BUY', quantity: 14, price: 1978.16, amount: 27694.24, occurredAt: d('2026-07-25'), note: 'USQQQM 14 @ $292.187（USDCNY 6.7702 折算，源 SINA）', voidedAt: d('2026-07-25') })
  push({ id: randomUUID(), accountId: hsbc.id, assetId: qqqm.id, type: 'REVERSAL', amount: 0, occurredAt: d('2026-07-25'), note: `冲正 #${oldId.slice(0, 8)}（改按美元原生记账）`, reversalOfId: oldId })

  // 五笔美元原生买入 + 结算腿
  buyWithSettle(voo.id, 1, 689.18, '2026-06-17', 'USVOO 1 @ $689.18')
  buyWithSettle(vgt.id, 1, 120.08, '2026-06-18', 'USVGT 1 @ $120.08')
  buyWithSettle(qndx.id, 1, 23.34, '2026-07-23', 'USQNDX 1 @ $23.34')
  buyWithSettle(qqqm.id, 14, 292.187, '2026-07-25', 'USQQQM 14 @ $292.187（美元原生记账）')
  buyWithSettle(smh.id, 2, 573.34, '2026-07-25', 'USSMH 2 @ $573.34')

  await prisma.transaction.createMany({
    data: txs.map((t) => ({
      id: t.id,
      familyId: fid,
      accountId: t.accountId,
      assetId: t.assetId,
      type: t.type,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
      amount: t.amount,
      fee: 0,
      occurredAt: t.occurredAt,
      note: t.note ?? null,
      internal: t.internal ?? false,
      settleOfId: t.settleOfId ?? null,
      voidedAt: t.voidedAt ?? null,
      reversalOfId: t.reversalOfId ?? null,
    })),
  })
  console.log(`  ✓ ${txs.length} 条流水`)

  await recordAudit(prisma, {
    familyId: fid,
    actorId: me.id,
    actorName: me.name,
    action: 'RESTORE',
    entity: 'FamilySpace',
    entityId: fid,
    detail: '事故后按会话记录重建用户真实数据',
  })

  const n = await rebuildSnapshots(prisma, fid)
  console.log(`  ✓ 快照重建 ${n} 天`)
  console.log('完成：秦人集合 / 华哥 / 2 账户 / 6 资产 / 12 条有效流水已还原')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
