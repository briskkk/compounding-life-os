// E2E 夹具数据：家庭空间 + 现金闭环流水 + 房贷负债 + 行情落库 + 快照
// 仅供 scripts/prepare-e2e.mjs 调用；必须显式指定 SEED_DATABASE_PATH，绝不触碰 dev.db。
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { closeAt } from '../src/lib/market/simulated'
import { persistHistory } from '../src/lib/market/persist'
import { rebuildSnapshots } from '../src/lib/snapshots'
import { recordAudit } from '../src/lib/audit'
import { hashPassword } from '../src/lib/auth/password'

const DB_PATH = process.env.SEED_DATABASE_PATH ? path.resolve(process.env.SEED_DATABASE_PATH) : null
if (!DB_PATH) {
  console.error('E2E 夹具必须通过 SEED_DATABASE_PATH 显式指定目标数据库，已中止。')
  process.exit(1)
}
const prisma = new PrismaClient({ datasourceUrl: `file:${DB_PATH}` })

const d = (s: string) => new Date(`${s}T10:00:00+08:00`)

function monthSeq(startYM: string, count: number): string[] {
  const [y, m] = startYM.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y, m - 1 + i, 1))
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

async function main() {
  console.log('· 清空旧数据…')
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.investmentPlanAsset.deleteMany(),
    prisma.investmentPlan.deleteMany(),
    prisma.cashPlan.deleteMany(),
    prisma.allocationTarget.deleteMany(),
    prisma.snapshot.deleteMany(),
    prisma.portfolioReview.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.importBatch.deleteMany(),
    prisma.liabilityEntry.deleteMany(),
    prisma.liability.deleteMany(),
    prisma.goal.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.account.deleteMany(),
    prisma.member.deleteMany(),
    prisma.familySpace.deleteMany(),
    prisma.priceBar.deleteMany(),
    prisma.rateBar.deleteMany(),
    prisma.fundEstimate.deleteMany(),
    prisma.fundCalibration.deleteMany(),
  ])

  console.log('· 创建家庭空间与成员…')
  const family = await prisma.familySpace.create({ data: { name: '沈家 · 财富空间' } })
  const fid = family.id
  // E2E 登录账号（auth.setup 用它走 /login）
  const e2eUser = await prisma.user.create({
    data: { email: 'e2e@test.local', passwordHash: await hashPassword('e2e-password') },
  })
  const shen = await prisma.member.create({ data: { familyId: fid, userId: e2eUser.id, name: '沈砚', role: 'OWNER' } })
  // 只读账号（VIEWER）也带登录，供 e2e 验证「写入区块消失时必须给出只读提示」
  const viewerUser = await prisma.user.create({
    data: { email: 'viewer@test.local', passwordHash: await hashPassword('e2e-password') },
  })
  await prisma.member.create({ data: { familyId: fid, userId: viewerUser.id, name: '沈父', role: 'VIEWER' } })
  await prisma.member.create({ data: { familyId: fid, name: '林知夏', role: 'ADMIN' } })

  console.log('· 创建账户与资产…')
  const mk = {
    ht: await prisma.account.create({ data: { familyId: fid, name: '华泰证券', type: 'BROKERAGE', institution: '华泰证券' } }),
    cmb: await prisma.account.create({ data: { familyId: fid, name: '招商银行', type: 'BANK', institution: '招商银行' } }),
    tt: await prisma.account.create({ data: { familyId: fid, name: '天天基金', type: 'FUND', institution: '天天基金' } }),
    prop: await prisma.account.create({ data: { familyId: fid, name: '自住房产', type: 'PROPERTY' } }),
    gold: await prisma.account.create({ data: { familyId: fid, name: '黄金积存', type: 'BANK', institution: '招商银行' } }),
    huawei: await prisma.account.create({ data: { familyId: fid, name: '华为持股计划', type: 'OTHER' } }),
  }
  await prisma.account.updateMany({
    where: { id: { in: [mk.ht.id, mk.tt.id, mk.prop.id, mk.gold.id, mk.huawei.id] } },
    data: { settlementAccountId: mk.cmb.id },
  })
  const at = {
    cash: await prisma.asset.create({ data: { familyId: fid, symbol: 'CASH-CNY', name: '人民币现金', cls: 'CASH' } }),
    moutai: await prisma.asset.create({ data: { familyId: fid, symbol: '600519', name: '贵州茅台', cls: 'STOCK' } }),
    catl: await prisma.asset.create({ data: { familyId: fid, symbol: '300750', name: '宁德时代', cls: 'STOCK' } }),
    etf300: await prisma.asset.create({ data: { familyId: fid, symbol: '510300', name: '沪深300ETF', cls: 'ETF' } }),
    fund: await prisma.asset.create({ data: { familyId: fid, symbol: '110022', name: '易方达消费行业', cls: 'FUND' } }),
    gold: await prisma.asset.create({ data: { familyId: fid, symbol: 'AU9999', name: '黄金 Au99.99', cls: 'GOLD' } }),
    home: await prisma.asset.create({ data: { familyId: fid, symbol: 'HOME-01', name: '自住房产 · 滨江', cls: 'REAL_ESTATE', manual: true } }),
    huawei: await prisma.asset.create({ data: { familyId: fid, symbol: 'HUAWEI-ESOP', name: '华为 ESOP', cls: 'HUAWEI_STOCK', manual: true } }),
  }

  console.log('· 登记房贷…')
  const mortgage = await prisma.liability.create({
    data: { familyId: fid, name: '滨江房贷', type: 'MORTGAGE', rate: 0.042, note: '等额本息 · 20 年' },
  })

  type TxSeed = {
    accountId: string
    assetId: string
    type: 'BUY' | 'SELL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'VALUATION'
    quantity?: number
    price?: number
    amount?: number
    fee?: number
    occurredAt: Date
    note?: string
    internal?: boolean
    settleOfId?: string
  }
  const txs: (TxSeed & { id: string })[] = []
  const push = (t: TxSeed): string => {
    const id = randomUUID()
    txs.push({ ...t, id })
    return id
  }
  /** 现金结算腿 */
  const settle = (parentId: string, accountId: string, type: 'BUY' | 'SELL', amount: number, fee: number, occurredAt: Date) => {
    const net = type === 'BUY' ? amount + fee : amount - fee
    if (net <= 0) return
    push({
      accountId,
      assetId: at.cash.id,
      type: type === 'BUY' ? 'WITHDRAW' : 'DEPOSIT',
      amount: net,
      occurredAt,
      note: '结算',
      internal: true,
      settleOfId: parentId,
    })
  }
  const px = (symbol: string, date: Date) => closeAt(symbol, date) ?? 1
  const months = monthSeq('2025-01', 19) // 2025-01 … 2026-07

  console.log('· 生成现金流与投资流水…')
  // 初始资金归集 + 首付入金
  push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'DEPOSIT', amount: 1_500_000, occurredAt: d('2025-01-02'), note: '家庭初始资金归集' })
  push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'DEPOSIT', amount: 1_000_000, occurredAt: d('2025-01-18'), note: '购房首付入金' })

  // 房产：按揭放款 + 买入 + 结算
  push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'DEPOSIT', amount: 2_200_000, occurredAt: d('2025-01-20'), note: '按揭放款', internal: true })
  const homeBuy = push({ accountId: mk.prop.id, assetId: at.home.id, type: 'BUY', quantity: 1, price: 3_200_000, amount: 3_200_000, occurredAt: d('2025-01-20'), note: '滨江两居室' })
  settle(homeBuy, mk.cmb.id, 'BUY', 3_200_000, 0, d('2025-01-20'))

  for (const ym of months) {
    const day15 = d(`${ym}-15`)
    if (day15.getTime() > Date.now() + 30 * 86400000) break
    // 工资
    push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'DEPOSIT', amount: 42_000, occurredAt: d(`${ym}-10`), note: '工资' })
    // 月供（2025-02 起）
    if (ym >= '2025-02') {
      push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'WITHDRAW', amount: 9_800, occurredAt: d(`${ym}-01`), note: '房贷月供', internal: true })
    }
    // ETF 定投
    const etfPrice = px('510300', day15)
    const etfQty = Math.floor(6000 / etfPrice)
    const etfBuy = push({ accountId: mk.ht.id, assetId: at.etf300.id, type: 'BUY', quantity: etfQty, price: etfPrice, amount: etfQty * etfPrice, fee: 1, occurredAt: day15, note: '月定投' })
    settle(etfBuy, mk.cmb.id, 'BUY', etfQty * etfPrice, 1, day15)
    // 基金定投
    const fundPrice = px('110022', day15)
    const fundBuy = push({ accountId: mk.tt.id, assetId: at.fund.id, type: 'BUY', quantity: Math.round((4000 / fundPrice) * 100) / 100, price: fundPrice, amount: 4000, fee: 0, occurredAt: day15, note: '月定投' })
    settle(fundBuy, mk.cmb.id, 'BUY', 4000, 0, day15)
    // 黄金积存
    const goldPrice = px('AU9999', day15)
    const goldBuy = push({ accountId: mk.gold.id, assetId: at.gold.id, type: 'BUY', quantity: Math.round((3000 / goldPrice) * 100) / 100, price: goldPrice, amount: 3000, fee: 0, occurredAt: d(`${ym}-20`) })
    settle(goldBuy, mk.cmb.id, 'BUY', 3000, 0, d(`${ym}-20`))
  }

  // 股票：季度建仓（统一由招商银行资金账户结算）
  for (const ym of ['2025-02', '2025-05', '2025-08', '2025-11', '2026-02', '2026-05']) {
    const mt = d(`${ym}-08`)
    const p1 = px('600519', mt)
    const b1 = push({ accountId: mk.ht.id, assetId: at.moutai.id, type: 'BUY', quantity: 100, price: p1, amount: 100 * p1, fee: 15, occurredAt: mt })
    settle(b1, mk.cmb.id, 'BUY', 100 * p1, 15, mt)
    const p2 = px('300750', mt)
    const b2 = push({ accountId: mk.ht.id, assetId: at.catl.id, type: 'BUY', quantity: 200, price: p2, amount: 200 * p2, fee: 8, occurredAt: mt })
    settle(b2, mk.cmb.id, 'BUY', 200 * p2, 8, mt)
  }
  // 一次减持
  const sellDate = d('2025-11-12')
  const sellPx = px('300750', sellDate)
  const sellTx = push({ accountId: mk.ht.id, assetId: at.catl.id, type: 'SELL', quantity: 200, price: sellPx, amount: 200 * sellPx, fee: 8, occurredAt: sellDate, note: '再平衡减持' })
  settle(sellTx, mk.cmb.id, 'SELL', 200 * sellPx, 8, sellDate)

  // 分红（含现金腿）
  for (const ym of ['2025-06', '2026-06']) {
    push({ accountId: mk.ht.id, assetId: at.moutai.id, type: 'DIVIDEND', amount: 2760, occurredAt: d(`${ym}-25`), note: '年度分红' })
    push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'DEPOSIT', amount: 2760, occurredAt: d(`${ym}-25`), note: '分红到账', internal: true })
    push({ accountId: mk.ht.id, assetId: at.etf300.id, type: 'DIVIDEND', amount: 420, occurredAt: d(`${ym}-28`) })
    push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'DEPOSIT', amount: 420, occurredAt: d(`${ym}-28`), note: '分红到账', internal: true })
  }
  push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'INTEREST', amount: 380, occurredAt: d('2025-12-21'), note: '活期利息' })
  push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'INTEREST', amount: 412, occurredAt: d('2026-06-21'), note: '活期利息' })

  // 大额消费
  push({ accountId: mk.cmb.id, assetId: at.cash.id, type: 'WITHDRAW', amount: 80_000, occurredAt: d('2025-09-30'), note: '家装支出' })

  // 房产估值
  const valuations: [string, number][] = [
    ['2025-04-01', 3_230_000],
    ['2025-07-01', 3_260_000],
    ['2025-10-01', 3_300_000],
    ['2026-01-01', 3_350_000],
    ['2026-04-01', 3_420_000],
  ]
  for (const [ymd, v] of valuations) {
    push({ accountId: mk.prop.id, assetId: at.home.id, type: 'VALUATION', amount: v, occurredAt: d(ymd), note: '季度估值' })
  }

  // 华为股票：按年度购买、分红与最新内部价格手动估值。
  push({ accountId: mk.huawei.id, assetId: at.huawei.id, type: 'BUY', quantity: 10_000, price: 7.85, amount: 78_500, occurredAt: d('2025-03-01'), note: '2025 年度购股' })
  push({ accountId: mk.huawei.id, assetId: at.huawei.id, type: 'DIVIDEND', amount: 15_000, occurredAt: d('2026-01-31'), note: '2025 年度分红' })
  push({ accountId: mk.huawei.id, assetId: at.huawei.id, type: 'BUY', quantity: 5_000, price: 8.10, amount: 40_500, occurredAt: d('2026-03-01'), note: '2026 年度购股' })
  push({ accountId: mk.huawei.id, assetId: at.huawei.id, type: 'VALUATION', amount: 121_500, occurredAt: d('2026-03-01'), note: '按 2026 年内部股价估值' })

  await prisma.transaction.createMany({
    data: txs.map((t) => ({
      id: t.id,
      familyId: fid,
      accountId: t.accountId,
      assetId: t.assetId,
      type: t.type,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
      amount: t.amount ?? 0,
      fee: t.fee ?? 0,
      occurredAt: t.occurredAt,
      note: t.note ?? null,
      internal: t.internal ?? false,
      settleOfId: t.settleOfId ?? null,
    })),
  })
  console.log(`  ✓ ${txs.length} 条流水（含现金结算腿）`)

  // 房贷条目：放款 + 月供
  const entries: { type: 'DRAW' | 'REPAY'; amount: number; occurredAt: Date; note?: string }[] = [
    { type: 'DRAW', amount: 2_200_000, occurredAt: d('2025-01-20'), note: '按揭放款' },
  ]
  for (const ym of months.slice(1)) {
    entries.push({ type: 'REPAY', amount: 9_800, occurredAt: d(`${ym}-01`), note: '月供' })
  }
  await prisma.liabilityEntry.createMany({
    data: entries.map((e) => ({ familyId: fid, liabilityId: mortgage.id, type: e.type, amount: e.amount, occurredAt: e.occurredAt, note: e.note ?? null })),
  })
  console.log(`  ✓ 房贷 + ${entries.length} 条负债条目`)

  console.log('· 创建目标…')
  await prisma.goal.createMany({
    data: [
      { familyId: fid, name: '3000 万 FIRE', mode: 'LUMP_SUM', targetAmount: 30_000_000, targetDate: d('2038-12-31'), spendYears: 50, retirementIncome: 0, withdrawalRate: 0.035, inflationRate: 0.025, metric: 'INVESTABLE', monthlyContribution: 25_000, expectedReturn: 0.07, volatility: 0.16, note: '目标金额按今日购买力口径' },
      { familyId: fid, name: '支出反推方案', mode: 'STREAM', annualSpend: 600_000, spendYears: 45, retirementIncome: 100_000, withdrawalRate: 0.04, inflationRate: 0.025, targetAmount: 12_500_000, targetDate: d('2042-12-31'), metric: 'INVESTABLE', monthlyContribution: 20_000, expectedReturn: 0.07, volatility: 0.16, note: '年度退休支出 60 万，其中稳定收入 10 万' },
    ],
  })

  console.log('· 行情历史落库…')
  const results = await persistHistory(prisma, ['600519', '300750', '510300', '110022', 'AU9999'], d('2024-12-01'), new Date())
  console.log(`  ✓ ${results.map((r) => `${r.symbol}:${r.count}@${r.source}`).join(' ')}`)

  console.log('· 重建财富轨迹快照…')
  const n = await rebuildSnapshots(prisma, fid)
  console.log(`  ✓ ${n} 天快照`)

  await recordAudit(prisma, {
    familyId: fid,
    actorId: shen.id,
    actorName: shen.name,
    action: 'SEED',
    entity: 'FamilySpace',
    entityId: fid,
    detail: '初始化种子数据 v2（现金闭环 + 负债 + 行情落库）',
  })

  console.log('完成。默认以 OWNER「沈砚」身份进入。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
