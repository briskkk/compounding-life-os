import Link from 'next/link'
import { ReviewModeNav } from '@/components/review-mode-nav'
import { PageHeader, SetupScreen } from '@/components/ui'
import { prisma } from '@/lib/db'
import { buildInvestmentPlanMonth } from '@/lib/engine/investment-plan'
import { buildMonthClose, type MonthCloseStepStatus } from '@/lib/engine/month-close'
import { fmtDate, fmtMoney, fmtPct } from '@/lib/format'
import { scopedDb } from '@/lib/scoped'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthKey(value?: string): string {
  const fallback = currentMonth()
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return fallback
  return value <= fallback ? value : fallback
}

function shiftMonth(value: string, delta: number): string {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthWindow(value: string): { start: Date; end: Date } {
  const [year, month] = value.split('-').map(Number)
  return {
    start: new Date(year, month - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month, 0, 23, 59, 59, 999),
  }
}

function reconciliationAccountId(detail: string | null, month: string, entityId: string | null): string | null {
  if (!detail || !entityId) return null
  try {
    const parsed = JSON.parse(detail) as { version?: number; asOfDate?: string }
    return parsed.version === 1 && parsed.asOfDate?.startsWith(month) ? entityId : null
  } catch {
    return null
  }
}

const STATUS_META: Record<MonthCloseStepStatus, { label: string; className: string }> = {
  COMPLETE: { label: '完成', className: 'is-complete' },
  ATTENTION: { label: '待处理', className: 'is-attention' },
  READY: { label: '可继续', className: 'is-ready' },
  EMPTY: { label: '无需处理', className: 'is-empty' },
}

const VALUATION_LABEL: Record<string, string> = {
  SETTLED: '估值完成',
  PARTIAL: '部分估值',
  CLOSED: '休市沿用',
  NO_UPDATE: '行情未更新',
  FLOW_ONLY: '仅资金流',
  LEGACY: '历史口径',
}

function amountList(rows: { currency: string; dueAmount: number; actualAmount: number }[], key: 'dueAmount' | 'actualAmount'): string {
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row[key])
  return [...totals].map(([currency, amount]) => fmtMoney(amount, currency)).join(' / ') || '—'
}

export default async function MonthClosePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />

  const selectedMonth = monthKey(params.month)
  const window = monthWindow(selectedMonth)
  const db = scopedDb(prisma, ctx)
  const [snapshot, transactions, accounts, logs, plans, buys, savedReview] = await Promise.all([
    db.snapshot.findFirst({
      where: { date: { gte: window.start, lte: window.end } },
      orderBy: { date: 'desc' },
    }),
    db.transaction.findMany({
      where: {
        occurredAt: { gte: window.start, lte: window.end },
        voidedAt: null,
      },
      select: { accountId: true, type: true, navSource: true, asset: { select: { cls: true } } },
    }),
    db.account.findMany({ orderBy: { createdAt: 'asc' } }),
    db.auditLog.findMany({
      where: { action: 'RECONCILE', entity: 'Account' },
      orderBy: { createdAt: 'desc' },
    }),
    db.investmentPlan.findMany({
      include: { assets: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.transaction.findMany({
      where: {
        type: 'BUY',
        occurredAt: { gte: window.start, lte: window.end },
        voidedAt: null,
      },
      orderBy: { occurredAt: 'asc' },
    }),
    db.portfolioReview.findFirst({
      where: {
        period: 'THIS_MONTH',
        startDate: new Date(`${selectedMonth}-01T00:00:00Z`),
      },
    }),
  ])

  const planReport = buildInvestmentPlanMonth(
    selectedMonth,
    plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      amount: Number(plan.amount),
      currency: plan.currency,
      cadence: plan.cadence,
      scheduleDay: plan.scheduleDay,
      startDate: plan.startDate,
      endDate: plan.endDate,
      status: plan.status,
      endedAt: plan.endedAt,
      accountId: plan.accountId,
      assetIds: plan.assets.map((item) => item.assetId),
    })),
    buys.map((buy) => ({
      id: buy.id,
      accountId: buy.accountId,
      assetId: buy.assetId,
      amount: Number(buy.amount),
      occurredAt: buy.occurredAt,
      navSource: buy.navSource,
    })),
  )
  const visiblePlanRows = planReport.rows.filter((row) => row.scheduledDates.length > 0 || row.transactionCount > 0)
  const pendingFundCount = transactions.filter((transaction) => (
    transaction.type === 'BUY'
    && transaction.asset.cls === 'FUND'
    && (transaction.navSource === 'PENDING' || transaction.navSource === 'ESTIMATE')
  )).length
  const activeAccountIds = [...new Set(transactions.map((transaction) => transaction.accountId))]
  const reconciledAccountIds = [...new Set(logs.flatMap((log) => {
    const id = reconciliationAccountId(log.detail, selectedMonth, log.entityId)
    return id ? [id] : []
  }))]
  const reconciledSet = new Set(reconciledAccountIds)
  const activeAccountSet = new Set(activeAccountIds)
  const missingAccounts = accounts.filter((account) => activeAccountSet.has(account.id) && !reconciledSet.has(account.id))
  const close = buildMonthClose({
    snapshot: snapshot ? { status: snapshot.valuationStatus, coverage: snapshot.valuationCoverage } : null,
    pendingFundCount,
    activeAccountIds,
    reconciledAccountIds,
    planRows: visiblePlanRows,
    reviewStatus: savedReview?.status ?? null,
  })
  const steps = [
    { number: '01', title: '确认数据', en: 'DATA', step: close.data },
    { number: '02', title: '账户对账', en: 'RECONCILE', step: close.reconciliation },
    { number: '03', title: '核对定投', en: 'PLAN', step: close.investmentPlan },
    { number: '04', title: '完成复盘', en: 'REVIEW', step: close.review },
  ]
  const [year, month] = selectedMonth.split('-').map(Number)
  const nextMonth = shiftMonth(selectedMonth, 1)
  const isCurrentMonth = selectedMonth === currentMonth()

  return (
    <main className="page-shell month-close-page">
      <ReviewModeNav current="month-close" />
      <PageHeader
        kicker="Monthly close"
        title="这个月，不靠记忆收尾。"
        description="月结中心只编排已有证据：先确认估值与在途状态，再核对账户和定投，最后把判断写入月度复盘。这里不会创建第二套余额。"
        right={(
          <div className="month-close-month-control">
            <Link href={`/month-close?month=${shiftMonth(selectedMonth, -1)}`} aria-label="上月">←</Link>
            <div><span>Closing period</span><strong>{year} 年 {month} 月</strong></div>
            {nextMonth <= currentMonth() ? <Link href={`/month-close?month=${nextMonth}`} aria-label="下月">→</Link> : <span aria-hidden="true">→</span>}
          </div>
        )}
      />

      <section className="month-close-progress" aria-label="月结进度">
        <div className="month-close-score">
          <span>已完成</span>
          <strong className="num">{close.completedSteps}<small> / {close.totalSteps}</small></strong>
          <p>{isCurrentMonth ? '本月进行中，状态随证据更新' : '历史月份按当前账本与保存凭证复核'}</p>
        </div>
        <ol className="month-close-tape">
          {steps.map(({ number, title, en, step }) => {
            const meta = STATUS_META[step.status]
            return (
              <li key={number} className={meta.className}>
                <span className="num">{number}</span>
                <div><small>{en}</small><strong>{title}</strong></div>
                <b>{meta.label}</b>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="month-close-stages">
        <article className={`month-close-stage ${STATUS_META[close.data.status].className}`}>
          <header><span className="num">01</span><div><small>DATA CONFIRMATION</small><h2>确认数据</h2></div><b>{STATUS_META[close.data.status].label}</b></header>
          <p className="month-close-stage-summary">{close.data.summary}</p>
          <dl>
            <div><dt>最近快照</dt><dd className="num">{snapshot ? fmtDate(snapshot.date) : '—'}</dd></div>
            <div><dt>估值状态</dt><dd>{snapshot ? VALUATION_LABEL[snapshot.valuationStatus] ?? snapshot.valuationStatus : '无快照'}</dd></div>
            <div><dt>估值覆盖</dt><dd className="num">{snapshot?.valuationCoverage == null ? '—' : fmtPct(snapshot.valuationCoverage)}</dd></div>
            <div><dt>基金待确认</dt><dd className={pendingFundCount > 0 ? 'text-amber num' : 'text-down num'}>{pendingFundCount} 笔</dd></div>
          </dl>
          <footer><Link href="/health">检查数据健康 →</Link>{pendingFundCount > 0 && <Link href="/fund-confirmations">处理基金确认 →</Link>}</footer>
        </article>

        <article className={`month-close-stage ${STATUS_META[close.reconciliation.status].className}`}>
          <header><span className="num">02</span><div><small>ACCOUNT RECONCILIATION</small><h2>账户对账</h2></div><b>{STATUS_META[close.reconciliation.status].label}</b></header>
          <p className="month-close-stage-summary">{close.reconciliation.summary}</p>
          <div className="month-close-account-count"><strong className="num">{activeAccountIds.filter((id) => reconciledSet.has(id)).length}</strong><span>/ {activeAccountIds.length} 个本月活跃账户</span></div>
          {missingAccounts.length > 0 ? (
            <div className="month-close-missing"><span>待补凭证</span><p>{missingAccounts.map((account) => account.name).join('、')}</p></div>
          ) : <div className="month-close-missing is-clear"><span>范围</span><p>{activeAccountIds.length > 0 ? '所有本月有有效流水的账户' : '本月无有效流水'}</p></div>}
          <footer><Link href="/reconciliation">进入账户对账 →</Link></footer>
        </article>

        <article className={`month-close-stage ${STATUS_META[close.investmentPlan.status].className}`}>
          <header><span className="num">03</span><div><small>PLAN × LEDGER</small><h2>核对定投</h2></div><b>{STATUS_META[close.investmentPlan.status].label}</b></header>
          <p className="month-close-stage-summary">{close.investmentPlan.summary}</p>
          <dl>
            <div><dt>本月相关计划</dt><dd className="num">{visiblePlanRows.length}</dd></div>
            <div><dt>到期计划金额</dt><dd className="num">{amountList(visiblePlanRows, 'dueAmount')}</dd></div>
            <div><dt>账本实际投入</dt><dd className="num text-accent">{amountList(visiblePlanRows, 'actualAmount')}</dd></div>
            <div><dt>匹配 BUY</dt><dd className="num">{planReport.transactionCount} 笔</dd></div>
          </dl>
          <footer><Link href={`/investment-plans?month=${selectedMonth}`}>查看计划与账本 →</Link></footer>
        </article>

        <article className={`month-close-stage ${STATUS_META[close.review.status].className}`}>
          <header><span className="num">04</span><div><small>PERIOD REVIEW</small><h2>完成复盘</h2></div><b>{STATUS_META[close.review.status].label}</b></header>
          <p className="month-close-stage-summary">{close.review.summary}</p>
          <div className="month-close-review-state">
            <span>{savedReview ? '保存状态' : '本月记录'}</span>
            <strong>{savedReview?.status === 'COMPLETED' ? '已完成' : savedReview?.status === 'DRAFT' ? '草稿' : '尚未创建'}</strong>
            <small>{savedReview ? `最近更新 ${fmtDate(savedReview.updatedAt)} · ${savedReview.authorName}` : '复盘保存收益桥、归因、风险与家庭判断'}</small>
          </div>
          <footer><Link href={`/review?period=THIS_MONTH&month=${selectedMonth}`}>{savedReview ? '打开月度复盘' : '开始月度复盘'} →</Link></footer>
        </article>
      </section>

      <p className="month-close-footnote">月结是工作流，不是冻结账本。后续补录、确认或冲正会更新这些派生状态，审计链与已保存复盘继续保留当时证据。</p>
    </main>
  )
}
