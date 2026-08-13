import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { getSession } from '@/lib/session'
import type { FamilyCtx } from '@/lib/scoped'
import { foldLiability, type LiabilityEntryInput } from '@/lib/engine/liabilities'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/monthly-summary?month=2026-08
 *
 * 本钱 Life Capital APP 的专用端点。
 * 只返回月度聚合数据，不暴露交易流水。
 *
 * 认证：Bearer Token (PORTFOLIO_API_KEY 环境变量)
 * 与 Web UI 的 Cookie 会话并行，互不干扰。
 *
 * 返回：
 * - month: 月份标识 YYYY-MM（month 参数非法或越界时回退当前月）
 * - totalIncome / totalExpense / savedAmount: 月度收支 (来自 SavingsEntry，无记录为 0)
 * - fixedExpenses / fixedExpenseTotal: 固定支出 (当月负债 REPAY 实际还款合计)
 * - liquidAssets: 可动用流动资产 (来自最新 Snapshot.investable，向前回落)
 * - passiveIncome: 被动收入 (当月 Transaction DIVIDEND + INTEREST)
 * - liabilities[]: name / type / remainingAmount（截至当月末 foldLiability 真实余额）/
 *   monthlyPayment（当月 REPAY 合计，无还款为 null）
 * - snapshotDate: 快照日期；currency: CNY
 */
export async function GET(req: NextRequest) {
  // ── 认证 ──────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '')
  const apiKey = process.env.PORTFOLIO_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'PORTFOLIO_API_KEY not configured' },
      { status: 503 },
    )
  }

  if (token !== apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    )
  }

  // ── 解析参数 ──────────────────────────────────────────
  const monthParam = req.nextUrl.searchParams.get('month')
  const now = new Date()

  let year: number
  let month: number // 0-indexed

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number)
    if (m >= 1 && m <= 12) {
      year = y
      month = m - 1
    } else {
      year = now.getFullYear()
      month = now.getMonth()
    }
  } else {
    year = now.getFullYear()
    month = now.getMonth()
  }

  // 月初和月末
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)
  const monthString = `${year}-${String(month + 1).padStart(2, '0')}`

  // ── 获取家庭上下文 ────────────────────────────────────
  // 优先用 Cookie 会话，回落到第一个 OWNER
  let ctx: FamilyCtx | null = await getSession()
  if (!ctx) {
    const owner = await prisma.member.findFirst({
      where: { role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    })
    if (!owner) {
      return NextResponse.json(
        { error: 'No family space initialized' },
        { status: 500 },
      )
    }
    ctx = {
      familyId: owner.familyId,
      memberId: owner.id,
      memberName: owner.name,
      role: owner.role,
      userId: owner.userId ?? '',
    }
  }

  const db = scopedDb(prisma, ctx)

  // ── 并行查询 ──────────────────────────────────────────
  const [savingsEntry, latestSnapshot, passiveTx, liabilities] = await Promise.all([
    // 1. 月度储蓄记录
    db.savingsEntry.findFirst({
      where: {
        periodType: 'MONTH',
        periodStart: {
          gte: monthStart,
          lte: monthEnd,
        },
      },
      orderBy: { periodStart: 'desc' },
    }),

    // 2. 最新资产快照（取月内最新的，没有则取最近的）
    db.snapshot.findFirst({
      where: {
        date: { lte: monthEnd },
      },
      orderBy: { date: 'desc' },
    }),

    // 3. 当月被动收入（股息 + 利息）
    db.transaction.findMany({
      where: {
        type: { in: ['DIVIDEND', 'INTEREST'] },
        occurredAt: {
          gte: monthStart,
          lte: monthEnd,
        },
        voidedAt: null,
      },
      select: { amount: true, type: true },
    }),

    // 4. 负债列表（全量条目：余额折叠 + 当月还款统计）
    db.liability.findMany({
      include: {
        entries: {
          orderBy: { occurredAt: 'desc' },
        },
      },
    }),
  ])

  // ── 计算固定支出（负债月供估算）──────────────────────
  const fixedExpenses: Array<{
    name: string
    amount: number
    category: string
    isRecurring: boolean
  }> = []

  for (const liab of liabilities) {
    // 优先用当月实际还款额
    const monthlyRepay = liab.entries
      .filter((e) => e.type === 'REPAY' && e.occurredAt >= monthStart && e.occurredAt <= monthEnd)
      .reduce((sum, e) => sum + Number(e.amount), 0)

    if (monthlyRepay > 0) {
      fixedExpenses.push({
        name: liab.name,
        amount: monthlyRepay,
        category: liab.type === 'MORTGAGE' ? '住房' : liab.type === 'CAR_LOAN' ? '交通' : '其他',
        isRecurring: true,
      })
    }
  }

  const fixedExpenseTotal = fixedExpenses.reduce((sum, e) => sum + e.amount, 0)

  // ── 计算被动收入 ──────────────────────────────────────
  const passiveIncome = passiveTx.reduce((sum, tx) => sum + Number(tx.amount), 0)

  // ── 构建响应 ──────────────────────────────────────────
  const totalIncome = savingsEntry ? Number(savingsEntry.income) : 0
  const totalExpense = savingsEntry ? Number(savingsEntry.spending) : 0
  const savedAmount = savingsEntry ? Number(savingsEntry.savedAmount) : totalIncome - totalExpense
  const liquidAssets = latestSnapshot ? Number(latestSnapshot.investable) : 0

  return NextResponse.json({
    month: monthString,
    totalIncome,
    totalExpense,
    savedAmount,
    fixedExpenses,
    fixedExpenseTotal,
    liquidAssets,
    passiveIncome,
    liabilities: liabilities.map((l) => {
      const entries: LiabilityEntryInput[] = l.entries.map((e) => ({
        liabilityId: e.liabilityId,
        type: e.type,
        amount: Number(e.amount),
        occurredAt: e.occurredAt,
      }))
      return {
        name: l.name,
        type: l.type,
        // 截至当月末的真实余额（foldLiability 折叠全部条目，与 monthly-trend 同口径）
        remainingAmount: foldLiability(entries, monthEnd),
        monthlyPayment: l.entries
          .filter((e) => e.type === 'REPAY' && e.occurredAt >= monthStart && e.occurredAt <= monthEnd)
          .reduce((s, e) => s + Number(e.amount), 0) || null,
      }
    }),
    currency: 'CNY',
    snapshotDate: latestSnapshot?.date ?? null,
  })
}
