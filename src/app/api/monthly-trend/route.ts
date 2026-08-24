import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadSavingsOverview } from '@/lib/queries'
import { foldLiability, type LiabilityEntryInput } from '@/lib/engine/liabilities'
import { apiReadAuthCtx } from '@/lib/services/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/monthly-trend?months=12
 *
 * 本钱 Life Capital APP 的专用端点（与 /api/monthly-summary 互补）。
 * 只返回月度聚合趋势与负债余额，不暴露交易流水。
 *
 * 认证：Bearer Token (PORTFOLIO_API_KEY 环境变量)
 * 与 Web UI 的 Cookie 会话并行，互不干扰。
 *
 * 参数：months = 1..24，默认 12，非法值回退默认。
 *
 * 返回：
 * - months[]: 按时间升序的月度序列
 *   - totalIncome / totalExpense / savedAmount / savingsRate: 来自储蓄总览
 *     （savingsRate 无记录时为 null，与 Web UI 口径一致）
 *   - netWorth / investable / liabilitiesTotal: 该月最后一个 Snapshot；
 *     当月无快照时回落最近之前的快照（与 monthly-summary 的回落行为一致），
 *     完全没有则为 0
 * - liabilities[]: 全量负债（不论当月是否还款）
 *   - balance: foldLiability 折叠全部流水后的真实余额
 *   - monthlyPayment: 当月 REPAY 合计，无还款为 null
 */
export async function GET(req: NextRequest) {
  // ── 认证与家庭上下文（用户会话优先，全局 key 兼容）────

  // ── 解析参数 ──────────────────────────────────────────
  const monthsParam = req.nextUrl.searchParams.get('months')
  let monthCount = 12
  if (monthsParam && /^\d+$/.test(monthsParam)) {
    const n = Number(monthsParam)
    if (n >= 1 && n <= 24) monthCount = n
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const auth = await apiReadAuthCtx(req)
  if (!auth.ctx) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ctx = auth.ctx

  const db = scopedDb(prisma, ctx)

  // ── 并行查询 ──────────────────────────────────────────
  const [overview, snapshots, liabilities] = await Promise.all([
    // 1. 近 N 个月储蓄总览（months 已按时间升序）
    loadSavingsOverview(ctx, monthCount),

    // 2. 截至当月末的全部资产快照（升序，按月截点取最后一个）
    db.snapshot.findMany({
      where: {
        date: { lte: currentMonthEnd },
      },
      orderBy: { date: 'asc' },
    }),

    // 3. 全量负债及流水
    db.liability.findMany({
      include: {
        entries: {
          orderBy: { occurredAt: 'asc' },
        },
      },
    }),
  ])

  // ── 按月装配快照（当月无快照 → 回落最近之前的）────────
  const months = overview.months.map((m) => {
    const [y, mo] = m.month.split('-').map(Number)
    const monthEnd = new Date(y, mo, 0, 23, 59, 59, 999)
    let snapshot: (typeof snapshots)[number] | null = null
    for (const s of snapshots) {
      if (s.date <= monthEnd) snapshot = s
      else break
    }
    return {
      month: m.month,
      totalIncome: m.income,
      totalExpense: m.spending,
      savedAmount: m.savedAmount,
      savingsRate: m.savingsRate,
      netWorth: snapshot ? Number(snapshot.netWorth) : 0,
      investable: snapshot ? Number(snapshot.investable) : 0,
      liabilitiesTotal: snapshot ? Number(snapshot.liabilities) : 0,
    }
  })

  // ── 装配负债（foldLiability 真实余额）─────────────────
  const liabilitiesView = liabilities.map((l) => {
    const entries: LiabilityEntryInput[] = l.entries.map((e) => ({
      liabilityId: e.liabilityId,
      type: e.type,
      amount: Number(e.amount),
      occurredAt: e.occurredAt,
    }))
    const monthlyRepay = l.entries
      .filter((e) => e.type === 'REPAY' && e.occurredAt >= monthStart && e.occurredAt <= currentMonthEnd)
      .reduce((sum, e) => sum + Number(e.amount), 0)
    return {
      name: l.name,
      type: l.type,
      rate: l.rate,
      balance: foldLiability(entries),
      monthlyPayment: monthlyRepay || null,
    }
  })

  return NextResponse.json({
    months,
    liabilities: liabilitiesView,
    currency: 'CNY',
  })
}
