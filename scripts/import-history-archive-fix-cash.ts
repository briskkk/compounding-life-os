/**
 * 一次性修补：为已导入的历史归档补齐现金联动，抹平财富曲线的虚高与 cutoff 断崖。
 *
 * 背景：归档流水最初不带现金结算腿，而逐项持仓的现金腿被改期到 cutoff 日，
 * 导致归档窗口内同一笔钱同时体现为「现金在手 + 归档估值」（虚高 ~+24 万），
 * 并在 cutoff 日结算腿集中触发时出现 −245,870 的单日断崖。
 *
 * 本脚本（幂等，可重复运行，已存在的条目自动跳过）：
 * 1. 每条归档 BUY/SELL 补一条内部现金腿（BUY→WITHDRAW / SELL→DEPOSIT，
 *    settleOfId 关联主流水，internal=true，人民币现金走招商银行、美元现金走汇丰投资——
 *    按现有结算腿的多数派账户推断）。
 * 2. 期初存量结转：O = cutoff 前最后一次估值 − 净导入流量；O > 0 时在首个导入日
 *    补一条 BUY（quantity=O, price=1）+ WITHDRAW 现金腿。
 * 3. 归档结清 SELL 补 DEPOSIT 现金腿（note「归档结清：资金转入逐项持仓」）；
 *    若存在期初结转，结清数量同步补上 O，使归档资产仍恰好归零。
 *
 * 运行：npx tsx scripts/import-history-archive-fix-cash.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { recordAudit, verifyChain } from '../src/lib/audit'
import { foldTransactions, type LedgerTx } from '../src/lib/engine/ledger'
import { rebuildSnapshots } from '../src/lib/snapshots'

const DB_PATH = path.resolve('prisma/dev.db')
const prisma = new PrismaClient({ datasourceUrl: `file:${DB_PATH}` })

const noon = (ymd: string) => new Date(`${ymd}T12:00:00+08:00`)
const localDate = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

const CATEGORIES = [
  { symbol: 'ARCHIVE-CN-FUND', cutoff: '2026-07-28' },
  { symbol: 'ARCHIVE-CN-US', cutoff: '2026-07-29' },
  { symbol: 'ARCHIVE-US-FUND', cutoff: '2026-07-23' },
] as const

type PositionState = Map<string, { quantity: number, costBasis: number, manualValue: number | null, realizedPnl: number }>

async function capturePositions(): Promise<PositionState> {
  const txsRaw = await prisma.transaction.findMany({ include: { asset: true }, orderBy: { occurredAt: 'asc' } })
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
  const state: PositionState = new Map()
  for (const p of foldTransactions(txs)) {
    state.set(`${p.accountId}:${p.assetId}`, {
      quantity: p.quantity,
      costBasis: p.costBasis,
      manualValue: p.manualValue,
      realizedPnl: p.realizedPnl,
    })
  }
  return state
}

/** 现有内部结算腿的多数派（账户, 现金资产）组合，按币种 */
async function cashLegTarget(currency: string): Promise<{ accountId: string, assetId: string }> {
  const legs = await prisma.transaction.findMany({
    where: { internal: true, settleOfId: { not: null }, asset: { cls: 'CASH', currency } },
    select: { accountId: true, assetId: true },
  })
  const counts = new Map<string, number>()
  for (const l of legs) counts.set(`${l.accountId}|${l.assetId}`, (counts.get(`${l.accountId}|${l.assetId}`) ?? 0) + 1)
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) throw new Error(`找不到 ${currency} 现金结算腿的既有约定账户`)
  const [accountId, assetId] = best[0].split('|')
  return { accountId, assetId }
}

async function main() {
  const backup = path.resolve('backups', `pre-archive-cash-fix-${Date.now()}.db`)
  fs.copyFileSync(DB_PATH, backup)
  console.log(`· 已备份 → ${path.relative(process.cwd(), backup)}`)

  const family = await prisma.familySpace.findFirstOrThrow({ include: { members: true } })
  const fid = family.id
  const owner = family.members.find((m) => m.role === 'OWNER') ?? family.members[0]

  // 基线（对照组）：先按现状重建一次，再 capture
  console.log('· 基线重建快照（对照组）…')
  await rebuildSnapshots(prisma, fid)
  const beforePositions = await capturePositions()
  const beforeSnaps = new Map(
    (await prisma.snapshot.findMany({ where: { familyId: fid } })).map((s) => [s.date.toISOString().slice(0, 10), Number(s.netWorth)]),
  )

  const summary: string[] = []
  let totalLegs = 0
  let totalOpenings = 0
  let totalClosingsAdjusted = 0

  for (const cat of CATEGORIES) {
    const asset = await prisma.asset.findFirstOrThrow({ where: { familyId: fid, symbol: cat.symbol } })
    const cash = await cashLegTarget(asset.currency)
    const archiveTxs = await prisma.transaction.findMany({
      where: { familyId: fid, assetId: asset.id },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    })
    const flows = archiveTxs.filter((t) => t.note?.startsWith('历史归档 · ') && (t.type === 'BUY' || t.type === 'SELL'))
    const valuations = archiveTxs.filter((t) => t.note?.startsWith('历史归档 · 估值刷新'))
    const closing = archiveTxs.find((t) => t.note === '归档结清：转为逐项持仓记录')
    if (!closing) throw new Error(`${cat.symbol} 找不到归档结清 SELL`)

    // 1. 归档流量现金腿
    let legsAdded = 0
    for (const tx of flows) {
      const existingLeg = await prisma.transaction.findFirst({ where: { settleOfId: tx.id } })
      if (existingLeg) continue
      const directionWord = tx.note!.split(' · ')[1] ?? (tx.type === 'BUY' ? '投入' : '转出')
      await prisma.transaction.create({
        data: {
          id: randomUUID(), familyId: fid,
          accountId: cash.accountId, assetId: cash.assetId,
          type: tx.type === 'BUY' ? 'WITHDRAW' : 'DEPOSIT',
          amount: Number(tx.amount), occurredAt: tx.occurredAt,
          note: `历史归档 · ${directionWord}现金联动`,
          internal: true, settleOfId: tx.id,
        },
      })
      legsAdded += 1
    }

    // 2. 期初存量结转
    const lastVal = valuations.length > 0 ? Number(valuations[valuations.length - 1].amount) : null
    let netFlows = 0
    for (const tx of flows) netFlows += tx.type === 'BUY' ? Number(tx.amount) : -Number(tx.amount)
    const opening = lastVal == null ? 0 : lastVal - netFlows
    let openingAdded = false
    if (opening > 0.005) {
      const existing = archiveTxs.find((t) => t.note?.startsWith('历史归档 · 期初存量结转'))
      if (!existing) {
        const firstDate = localDate(archiveTxs[0].occurredAt)
        const id = randomUUID()
        await prisma.transaction.create({
          data: {
            id, familyId: fid, accountId: archiveTxs[0].accountId,
            assetId: asset.id,
            type: 'BUY', quantity: opening, price: 1, amount: opening,
            occurredAt: noon(firstDate),
            note: '历史归档 · 期初存量结转（记录起点前已持有）',
          },
        })
        await prisma.transaction.create({
          data: {
            id: randomUUID(), familyId: fid, accountId: cash.accountId, assetId: cash.assetId,
            type: 'WITHDRAW', amount: opening, occurredAt: noon(firstDate),
            note: '历史归档 · 期初存量结转现金联动', internal: true, settleOfId: id,
          },
        })
        openingAdded = true
        totalOpenings += 1
      }
    }

    // 3. 归档结清 SELL：数量补足（含期初存量）+ DEPOSIT 现金腿
    const remaining = (opening > 0.005 ? opening : 0) + netFlows // 期初存量最早发生，顺序与回放一致
    let closingAdjusted = false
    if (Math.abs(Number(closing.quantity) - remaining) > 0.005) {
      await prisma.transaction.update({
        where: { id: closing.id },
        data: { quantity: remaining, amount: remaining },
      })
      closingAdjusted = true
    }
    const closingLegExists = await prisma.transaction.findFirst({ where: { settleOfId: closing.id } })
    if (!closingLegExists) {
      await prisma.transaction.create({
        data: {
          id: randomUUID(), familyId: fid, accountId: cash.accountId, assetId: cash.assetId,
          type: 'DEPOSIT', amount: remaining, occurredAt: closing.occurredAt,
          note: '归档结清：资金转入逐项持仓', internal: true, settleOfId: closing.id,
        },
      })
      legsAdded += 1
    }

    totalLegs += legsAdded + (openingAdded ? 1 : 0)
    if (closingAdjusted) totalClosingsAdjusted += 1
    summary.push(
      `${cat.symbol}: 流量腿 ${legsAdded - (closingLegExists ? 0 : 1)} 条 + 结清腿 ${closingLegExists ? 0 : 1} 条`
      + `；末次估值 ${lastVal} − 净流量 ${netFlows.toFixed(2)} → 期初存量 O=${opening.toFixed(2)}`
      + (openingAdded ? `（已补 BUY+腿 @ ${localDate(archiveTxs[0].occurredAt)}）` : opening > 0.005 ? '（已存在，跳过）' : '（≤0，跳过）')
      + `；结清数量 ${Number(closing.quantity).toFixed(2)} → ${remaining.toFixed(2)}${closingAdjusted ? '（已调整）' : '（不变）'}`,
    )
  }

  console.log('· 修补写入完成：')
  for (const s of summary) console.log(`  - ${s}`)

  const changed = totalLegs + totalOpenings + totalClosingsAdjusted > 0
  if (changed) {
    await recordAudit(prisma, {
      familyId: fid, actorId: owner.id, actorName: owner.name,
      action: 'UPDATE', entity: 'Transaction',
      detail: `历史归档现金联动修补：新增内部现金腿 ${totalLegs} 条、期初存量结转 ${totalOpenings} 条；结清 SELL 数量与现金腿对齐，抹平归档窗口虚高与 cutoff 断崖`,
    })
  } else {
    console.log('· 无新增写入（全部已存在），跳过审计记录')
  }

  console.log('· 重建财富轨迹快照…')
  const nSnap = await rebuildSnapshots(prisma, fid)
  console.log(`  ✓ ${nSnap} 天快照`)

  // ---- 校验 ----
  console.log('\n===== 校验 =====')
  const afterPositions = await capturePositions()
  const archiveIds: Set<string> = new Set(CATEGORIES.map((c) => c.symbol))
  const assetSymbols = new Map((await prisma.asset.findMany({ where: { familyId: fid }, select: { id: true, symbol: true } })).map((a) => [a.id, a.symbol]))
  let posBad = 0
  for (const key of [...new Set([...beforePositions.keys(), ...afterPositions.keys()])].sort()) {
    const b = beforePositions.get(key)
    const a = afterPositions.get(key)
    const symbol = assetSymbols.get(key.split(':')[1]) ?? key
    const same = b && a
      && Math.abs(b.quantity - a.quantity) < 1e-6
      && Math.abs(b.costBasis - a.costBasis) < 1e-4
      && b.manualValue === a.manualValue
      && Math.abs(b.realizedPnl - a.realizedPnl) < 1e-4
    if (!same) {
      posBad += 1
      console.log(`  ✗ 持仓变动 ${symbol}: before=${JSON.stringify(b)} after=${JSON.stringify(a)}`)
    } else if (archiveIds.has(symbol)) {
      console.log(`  · 归档资产 ${symbol}: quantity=${a!.quantity} manualValue=${a!.manualValue} realizedPnl=${a!.realizedPnl}`)
    }
  }
  console.log(`1) 今日持仓/现金对比：${posBad === 0 ? '全部一致（到分）✓' : `${posBad} 项有差异！`}`)

  const afterSnaps = new Map(
    (await prisma.snapshot.findMany({ where: { familyId: fid } })).map((s) => [s.date.toISOString().slice(0, 10), Number(s.netWorth)]),
  )
  const dates = [...afterSnaps.keys()].sort()
  const today = dates[dates.length - 1]
  console.log(`2) cutoff 平滑度（日环比）:`)
  for (const [label, prev, curr] of [
    ['美元基金 cutoff', '2026-07-22', '2026-07-23'],
    ['国内基金 cutoff', '2026-07-27', '2026-07-28'],
    ['国内美股 cutoff', '2026-07-28', '2026-07-29'],
  ] as const) {
    const delta = (afterSnaps.get(curr) ?? NaN) - (afterSnaps.get(prev) ?? NaN)
    console.log(`   ${label} ${prev} → ${curr}: Δ=${Math.round(delta)}（修补前 ${Math.round((beforeSnaps.get(curr) ?? NaN) - (beforeSnaps.get(prev) ?? NaN))}）`)
  }
  let tailBad = 0
  for (const [date, b] of beforeSnaps) {
    if (date < '2026-07-29') continue
    if (afterSnaps.get(date) !== b) {
      tailBad += 1
      console.log(`   ✗ 快照差异 ${date}: before=${b} after=${afterSnaps.get(date)}`)
    }
  }
  console.log(`3) cutoff 之后（>= 2026-07-29）与今日 ${today}：${tailBad === 0 ? '与修补前完全一致 ✓' : `${tailBad} 天有差异！`}`)
  console.log('4) 归档窗口抽样（修补前 → 修补后）:')
  for (const d of ['2025-06-10', '2025-09-01', '2026-01-15', '2026-05-20', '2026-07-15']) {
    console.log(`   ${d}: ${beforeSnaps.get(d)} → ${afterSnaps.get(d)}（Δ=${(afterSnaps.get(d) ?? 0) - (beforeSnaps.get(d) ?? 0)}）`)
  }
  const chain = await verifyChain(prisma, fid)
  console.log(`5) 审计哈希链：${chain.ok ? `完整 ✓（${chain.count} 条）` : `断裂 @ ${chain.brokenAt}`}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
