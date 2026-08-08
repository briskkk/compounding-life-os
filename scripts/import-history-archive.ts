/**
 * 一次性历史数据导入：Portfolio.xlsx → 归档资产（archive assets）
 *
 * 设计要点（已与用户确认）：
 * - 每个类别创建一个 manual 归档资产，把 cutoff 之前的「进出/金额」导成 BUY/SELL（quantity=金额, price=1），
 *   「总计」导成 VALUATION；截止日当天做一笔全量 SELL + 一笔 0 估值（归档结清），
 *   使归档资产数量/价值归零，不出现在当前持仓，只保留历史曲线。
 * - 归档流水带内部现金结算腿（BUY→WITHDRAW / SELL→DEPOSIT，settleOfId 关联，internal=true，
 *   账户/现金资产按既有结算腿多数派推断）；截止日结清 SELL 带 DEPOSIT 腿把资金转回现金账户，
 *   同日逐项持仓的结算腿再支出——窗口内不虚高、cutoff 日无断崖。
 * - 期初存量结转：末次估值 − 净流量 > 0 时，在首个导入日补一条 BUY（含现金腿），
 *   代表记录起点前已持有的部分。
 * - cutoff 之前的一次性开仓记录改期到 cutoff 日（本地中午），备注加「原记录于 …」前缀；
 *   关联现金结算腿（settleOfId 关联）一起改期。
 * - 每类别一条 IMPORT 审计 + 一条改期 UPDATE 审计（recordAudit 哈希链）。
 *
 * 运行：npx tsx scripts/import-history-archive.ts
 * 幂等：归档资产已存在则拒绝运行。重跑需先恢复备份（脚本会在写入前自动备份到 backups/）。
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { recordAudit, verifyChain } from '../src/lib/audit'
import { foldTransactions, type LedgerTx } from '../src/lib/engine/ledger'
import { rebuildSnapshots } from '../src/lib/snapshots'

const DB_PATH = path.resolve('prisma/dev.db')
const XLSX_PATH = '/Users/hua/Documents/Portfolio.xlsx'
const PYTHON = path.resolve('outputs/venv/bin/python')
const DUMPER = path.resolve('scripts/import-history-archive-dump.py')

const prisma = new PrismaClient({ datasourceUrl: `file:${DB_PATH}` })

/** 本地（UTC+8）中午 */
const noon = (ymd: string) => new Date(`${ymd}T12:00:00+08:00`)
const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00+08:00`)
const localDate = (d: Date) =>
  new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

interface DumpRow {
  date: string // YYYY-MM-DD
  direction: '投入' | '转出' | '转入' | null
  amount: number | null
  total: number | null
  note: string | null
}

const CATEGORIES = [
  { sheet: '国内基金', symbol: 'ARCHIVE-CN-FUND', name: '历史归档 · 国内基金', currency: 'CNY', importThrough: '2026-07-27', cutoff: '2026-07-28' },
  { sheet: '国内美股', symbol: 'ARCHIVE-CN-US', name: '历史归档 · 国内美股', currency: 'CNY', importThrough: '2026-07-28', cutoff: '2026-07-29' },
  { sheet: '美元基金', symbol: 'ARCHIVE-US-FUND', name: '历史归档 · 美元基金', currency: 'USD', importThrough: '2026-07-22', cutoff: '2026-07-23' },
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

function diffPositions(before: PositionState, after: PositionState, archiveAssetIds: Set<string>): string[] {
  const lines: string[] = []
  const keys = new Set([...before.keys(), ...after.keys()])
  for (const key of [...keys].sort()) {
    const b = before.get(key)
    const a = after.get(key)
    const assetId = key.split(':')[1]
    if (archiveAssetIds.has(assetId)) {
      lines.push(`  归档资产 ${assetId}: quantity=${a?.quantity} manualValue=${a?.manualValue} realizedPnl=${a?.realizedPnl}`)
      continue
    }
    const same = b && a
      && Math.abs(b.quantity - a.quantity) < 1e-9
      && Math.abs(b.costBasis - a.costBasis) < 1e-6
      && b.manualValue === a.manualValue
      && Math.abs(b.realizedPnl - a.realizedPnl) < 1e-6
    if (!same) lines.push(`  ✗ 变动 ${key}: before=${JSON.stringify(b)} after=${JSON.stringify(a)}`)
  }
  return lines
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
  // ---- 0. 安全检查与备份 ----
  if (!fs.existsSync(DB_PATH)) throw new Error(`找不到数据库 ${DB_PATH}`)
  const existing = await prisma.asset.findFirst({ where: { symbol: { startsWith: 'ARCHIVE-' } } })
  if (existing) {
    console.error(`归档资产已存在（${existing.symbol}），拒绝重复导入。如需重跑请先恢复备份。`)
    process.exit(1)
  }
  fs.mkdirSync(path.resolve('backups'), { recursive: true })
  const backup = path.resolve('backups', `pre-import-history-${Date.now()}.db`)
  fs.copyFileSync(DB_PATH, backup)
  console.log(`· 已备份 → ${path.relative(process.cwd(), backup)}`)

  const family = await prisma.familySpace.findFirstOrThrow({ include: { members: true } })
  const fid = family.id
  const owner = family.members.find((m) => m.role === 'OWNER') ?? family.members[0]
  console.log(`· 家庭空间「${family.name}」，审计身份「${owner.name}」`)

  // ---- 1. 基线：对照重建 + 持仓/快照基线 ----
  console.log('· 基线重建快照（对照组）…')
  await rebuildSnapshots(prisma, fid)
  const beforePositions = await capturePositions()
  const beforeSnapshots = new Map(
    (await prisma.snapshot.findMany({ where: { familyId: fid } }))
      .map((s) => [s.date.toISOString().slice(0, 10), s]),
  )

  // ---- 2. 读取 Excel ----
  console.log('· 解析 Excel…')
  const dump = JSON.parse(execFileSync(PYTHON, [DUMPER, XLSX_PATH], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  const sheets = dump.sheets as Record<string, DumpRow[]>

  // ---- 3. 归档账户与资产 ----
  const account = await prisma.account.create({
    data: { familyId: fid, name: '历史归档', type: 'OTHER', currency: 'CNY', note: 'Excel 历史台账归档账户（import-history-archive）' },
  })
  const archiveAssets = new Map<string, { id: string, cutoff: string, importThrough: string, currency: string, sheet: string, name: string }>()
  for (const cat of CATEGORIES) {
    const asset = await prisma.asset.create({
      data: { familyId: fid, symbol: cat.symbol, name: cat.name, cls: 'FUND', manual: true, currency: cat.currency, tags: '历史归档', note: `由 ${XLSX_PATH}「${cat.sheet}」导入，${cat.cutoff} 结清转为逐项持仓` },
    })
    archiveAssets.set(cat.sheet, { id: asset.id, cutoff: cat.cutoff, importThrough: cat.importThrough, currency: cat.currency, sheet: cat.sheet, name: cat.name })
  }
  console.log(`· 已创建账户「历史归档」+ ${archiveAssets.size} 个归档资产`)

  // ---- 4. 导入归档流水 ----
  const importSummary: string[] = []
  for (const cat of CATEGORIES) {
    const asset = archiveAssets.get(cat.sheet)!
    const cash = await cashLegTarget(cat.currency)
    const rows = sheets[cat.sheet].filter((r) => r.date <= cat.importThrough)
    const skipped = sheets[cat.sheet].length - rows.length
    const txs: Prisma.TransactionCreateManyInput[] = []
    const leg = (parentId: string, type: 'WITHDRAW' | 'DEPOSIT', amount: number, occurredAt: Date, note: string) => {
      txs.push({
        id: randomUUID(), familyId: fid, accountId: cash.accountId, assetId: cash.assetId,
        type, amount, occurredAt, note, internal: true, settleOfId: parentId,
      })
    }
    // 期初存量结转：O = cutoff 前末次估值 − 净导入流量；O > 0 时在首个导入日补一条 BUY（含现金腿），
    // 使归档窗口内「估值 ≈ 累计投入现金」成立，曲线不虚高。
    let netFlows = 0
    for (const row of rows) {
      if (row.direction && row.amount != null) netFlows += row.direction === '转出' ? -row.amount : row.amount
    }
    const lastVal = [...rows].reverse().find((r) => r.total != null)?.total ?? null
    const opening = lastVal == null ? 0 : lastVal - netFlows
    let remaining = 0 // 按日期顺序累加，与回放口径一致（price=1 → quantity=金额）
    let openingNote: string | null = null
    if (opening > 0.005) {
      const id = randomUUID()
      remaining = opening // 期初存量最早发生，顺序与回放一致
      txs.push({
        id, familyId: fid, accountId: account.id, assetId: asset.id,
        type: 'BUY', quantity: opening, price: 1, amount: opening,
        occurredAt: noon(rows[0].date),
        note: '历史归档 · 期初存量结转（记录起点前已持有）',
      })
      leg(id, 'WITHDRAW', opening, noon(rows[0].date), '历史归档 · 期初存量结转现金联动')
      openingNote = `期初存量 ${opening.toFixed(2)}`
    }
    let nFlow = 0
    let nVal = 0
    for (const row of rows) {
      if (row.direction && row.amount != null) {
        const type = row.direction === '转出' ? 'SELL' : 'BUY'
        remaining += type === 'BUY' ? row.amount : -row.amount
        const id = randomUUID()
        txs.push({
          id, familyId: fid, accountId: account.id, assetId: asset.id,
          type, quantity: row.amount, price: 1, amount: row.amount,
          occurredAt: noon(row.date),
          note: `历史归档 · ${row.direction}${row.note ? ` · ${row.note}` : ''}`,
        })
        // 现金联动腿：归档投入实时占用现金，避免与逐项持仓现金腿重复计价
        leg(id, type === 'BUY' ? 'WITHDRAW' : 'DEPOSIT', row.amount, noon(row.date), `历史归档 · ${row.direction}现金联动`)
        nFlow += 1
      }
      if (row.total != null) {
        txs.push({
          id: randomUUID(), familyId: fid, accountId: account.id, assetId: asset.id,
          type: 'VALUATION', amount: row.total,
          occurredAt: noon(row.date),
          note: `历史归档 · 估值刷新${row.note ? ` · ${row.note}` : ''}`,
        })
        nVal += 1
      }
    }
    // 归档结清：全量卖出（资金回到现金账户，同日由逐项持仓的结算腿再支出）+ 估值归零
    const closingId = randomUUID()
    txs.push({
      id: closingId, familyId: fid, accountId: account.id, assetId: asset.id,
      type: 'SELL', quantity: remaining, price: 1, amount: remaining,
      occurredAt: noon(cat.cutoff), note: '归档结清：转为逐项持仓记录',
    })
    leg(closingId, 'DEPOSIT', remaining, noon(cat.cutoff), '归档结清：资金转入逐项持仓')
    txs.push({
      id: randomUUID(), familyId: fid, accountId: account.id, assetId: asset.id,
      type: 'VALUATION', amount: 0,
      occurredAt: noon(cat.cutoff), note: '归档结清',
    })
    await prisma.transaction.createMany({ data: txs })
    importSummary.push(`${cat.sheet}: 流水 ${nFlow} 条（含现金腿）+ 估值 ${nVal} 条 + 结清 2 条（结清数量 ${remaining.toFixed(2)} ${cat.currency}）${openingNote ? `，${openingNote}` : ''}，跳过 cutoff 后 ${skipped} 行`)
    await recordAudit(prisma, {
      familyId: fid, actorId: owner.id, actorName: owner.name,
      action: 'IMPORT', entity: 'Asset', entityId: asset.id,
      detail: `历史归档导入「${cat.name}」：${cat.sheet} 截至 ${cat.importThrough}，流水 ${nFlow} 条、估值 ${nVal} 条（含现金联动腿）${openingNote ? `、${openingNote}` : ''}，${cat.cutoff} 归档结清（数量 ${remaining.toFixed(2)}，资金转回现金账户）`,
    })
  }
  console.log('· 归档流水导入完成：')
  for (const s of importSummary) console.log(`  - ${s}`)

  // ---- 5. 改期 cutoff 前的一次性开仓记录 ----
  const redated: { group: string, id: string, symbol: string, from: string, legs: number }[] = []
  const redate = async (group: string, whereAssetIds: string[], before: Date, to: string) => {
    const entries = await prisma.transaction.findMany({
      where: { familyId: fid, assetId: { in: whereAssetIds }, type: { in: ['BUY', 'SELL'] }, voidedAt: null, occurredAt: { lt: before } },
      include: { asset: true },
      orderBy: { occurredAt: 'asc' },
    })
    for (const entry of entries) {
      const from = localDate(entry.occurredAt)
      const legs = await prisma.transaction.findMany({ where: { settleOfId: entry.id, voidedAt: null } })
      await prisma.transaction.update({
        where: { id: entry.id },
        data: { occurredAt: noon(to), note: entry.note ? `原记录于 ${from} · ${entry.note}` : `原记录于 ${from}` },
      })
      for (const leg of legs) {
        await prisma.transaction.update({ where: { id: leg.id }, data: { occurredAt: noon(to) } })
      }
      redated.push({ group, id: entry.id, symbol: entry.asset.symbol, from, legs: legs.length })
    }
    return entries.length
  }

  const assetsByTag = async (tag: string) =>
    (await prisma.asset.findMany({ where: { familyId: fid, tags: { contains: tag }, cls: { in: ['FUND', 'ETF'] } }, select: { id: true } })).map((a) => a.id)

  const nCn = await redate('国内基金', await assetsByTag('国内基金'), dayStart('2026-07-28'), '2026-07-28')
  const nCnus = await redate('国内美股', await assetsByTag('国内美股'), dayStart('2026-07-29'), '2026-07-29')

  // 美元基金：仅 QQQM 一次性开仓。Excel 台账里的「27694.24」对应原始 CNY 口径记录，
  // 该记录已于 2026-07-25 被冲正（改按美元原生记账），现存活的是同日 4090.618 USD 那条——
  // 同一笔 14 股 QQQM 开仓，改期存活条目及其现金腿。
  const qqqm = await prisma.asset.findFirstOrThrow({ where: { familyId: fid, symbol: 'USQQQM' } })
  const qqqmEntries = await prisma.transaction.findMany({
    where: {
      familyId: fid, assetId: qqqm.id, type: 'BUY', voidedAt: null,
      occurredAt: { gte: dayStart('2026-07-25'), lt: dayStart('2026-07-26') },
    },
  })
  if (qqqmEntries.length !== 1) throw new Error(`QQQM 2026-07-25 存活开仓条目数异常：${qqqmEntries.length}`)
  for (const entry of qqqmEntries) {
    const legs = await prisma.transaction.findMany({ where: { settleOfId: entry.id, voidedAt: null } })
    await prisma.transaction.update({
      where: { id: entry.id },
      data: { occurredAt: noon('2026-07-23'), note: entry.note ? `原记录于 2026-07-25 · ${entry.note}` : '原记录于 2026-07-25' },
    })
    for (const leg of legs) {
      await prisma.transaction.update({ where: { id: leg.id }, data: { occurredAt: noon('2026-07-23') } })
    }
    redated.push({ group: '美元基金', id: entry.id, symbol: 'USQQQM', from: '2026-07-25', legs: legs.length })
  }

  const totalLegs = redated.reduce((s, r) => s + r.legs, 0)
  console.log(`· 改期完成：国内基金 ${nCn} 条、国内美股 ${nCnus} 条、美元基金 ${qqqmEntries.length} 条，共 ${redated.length} 条 + ${totalLegs} 条现金腿`)
  for (const r of redated) console.log(`  - [${r.group}] ${r.symbol} ${r.from} → cutoff（腿 ${r.legs}）`)
  await recordAudit(prisma, {
    familyId: fid, actorId: owner.id, actorName: owner.name,
    action: 'UPDATE', entity: 'Transaction',
    detail: `历史归档改期：国内基金 ${nCn} 条 → 2026-07-28，国内美股 ${nCnus} 条 → 2026-07-29，美元基金 QQQM 开仓 1 条 → 2026-07-23；含现金结算腿共 ${totalLegs} 条同步改期`,
  })

  // ---- 6. 重建快照 ----
  console.log('· 重建财富轨迹快照…')
  const nSnap = await rebuildSnapshots(prisma, fid)
  console.log(`  ✓ ${nSnap} 天快照`)

  // ---- 7. 校验 ----
  console.log('\n===== 校验 =====')
  const afterPositions = await capturePositions()
  const diffs = diffPositions(beforePositions, afterPositions, new Set([...archiveAssets.values()].map((a) => a.id)))
  const bad = diffs.filter((l) => l.startsWith('  ✗'))
  console.log(`1) 持仓对比（before vs after）：${bad.length === 0 ? '非归档资产全部一致 ✓' : '存在差异！'}`)
  for (const l of diffs) console.log(l)

  const afterSnapshots = new Map(
    (await prisma.snapshot.findMany({ where: { familyId: fid } }))
      .map((s) => [s.date.toISOString().slice(0, 10), s]),
  )
  let tailBad = 0
  let checked = 0
  for (const [date, b] of beforeSnapshots) {
    if (date < '2026-07-28') continue
    const a = afterSnapshots.get(date)
    checked += 1
    if (!a || Number(a.netWorth) !== Number(b.netWorth) || Number(a.investable) !== Number(b.investable) || Number(a.contributions) !== Number(b.contributions)) {
      tailBad += 1
      console.log(`  ✗ 快照差异 ${date}: before netWorth=${b.netWorth} after=${a?.netWorth}`)
    }
  }
  console.log(`2) cutoff 后快照（>= 2026-07-28，${checked} 天）：${tailBad === 0 ? '完全一致 ✓' : `${tailBad} 天有差异！`}`)

  const chain = await verifyChain(prisma, fid)
  console.log(`3) 审计哈希链：${chain.ok ? `完整 ✓（${chain.count} 条）` : `断裂 @ ${chain.brokenAt}`}`)

  const dates = [...afterSnapshots.keys()].sort()
  console.log(`4) 轨迹窗口：${dates[0]} → ${dates[dates.length - 1]}（共 ${dates.length} 天）`)
  console.log('   cutoff 附近净资产：')
  for (const d of dates.filter((d) => d >= '2026-07-20' && d <= '2026-07-31')) {
    const s = afterSnapshots.get(d)!
    console.log(`   ${d}  netWorth=${s.netWorth}  assets=${s.assets}  investable=${s.investable}  contributions=${s.contributions}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
