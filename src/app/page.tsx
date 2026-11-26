// 总览按家庭资产与投资表现分视图，沿用同一账本、快照与复盘引擎。
import Link from 'next/link'
import { getDashboard, type DashboardData } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, SetupScreen, ScopeLabel } from '@/components/ui'
import { HouseholdCompositionChart, OverviewPerformanceChart, WealthChart } from '@/components/charts'
import { OverviewAnnualReturns, OverviewInvestmentAccounts } from '@/components/overview-book-details'
import { wealthScope } from '@/lib/wealth-scope'
import { isInvestableAsset } from '@/lib/asset-classification'
import { C, CLASS_COLORS } from '@/lib/colors'
import { ASSET_CLASS_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtMonth, fmtPct } from '@/lib/format'
import { ValuationSourceSummary } from '@/components/valuation-source'
import { mergePositionsByAsset } from '@/lib/engine/merge'
import type { AssetClass } from '@/lib/engine/types'
import type { ReviewPeriod } from '@/lib/engine/review'
import { compactRecentSeries } from '@/lib/engine/series-sampling'
import { attributionDateKey } from '@/lib/engine/portfolio-day'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { buildOverviewTasks, type OverviewTask } from '@/lib/engine/overview-tasks'
import type { InvestmentPlanInput, InvestmentPlanBuy } from '@/lib/engine/investment-plan'

export const dynamic = 'force-dynamic'

const PERIODS: { key: ReviewPeriod; label: string; value: string }[] = [
  { key: 'THIS_WEEK', label: '本周', value: 'week' },
  { key: 'THIS_MONTH', label: '本月', value: 'month' },
  { key: 'THIS_QUARTER', label: '本季度', value: 'quarter' },
]

function periodFrom(value?: string): ReviewPeriod | undefined {
  if (value === 'week') return 'THIS_WEEK'
  if (value === 'quarter') return 'THIS_QUARTER'
  if (value === 'month') return 'THIS_MONTH'
}

function periodHref(value: string): string {
  return value === 'month' ? '/?view=investment' : `/?view=investment&period=${value}`
}

function money(value: number | null, sign = false): string {
  return value == null ? '—' : fmtCNY(value, { sign })
}

/** 目标达成月份：与目标页同一写法（null = 按当前投入 100 年内未达标） */
function targetMonth(months: number | null): string {
  if (months == null) return '100 年内未达标'
  const date = new Date()
  date.setMonth(date.getMonth() + months)
  return fmtMonth(date)
}

/** 对账凭证 detail 的读取口径（与月结中心一致）：version 1 且 asOfDate 落在该月 */
function reconciliationAccountId(detail: string | null, month: string, entityId: string | null): string | null {
  if (!detail || !entityId) return null
  try {
    const parsed = JSON.parse(detail) as { version?: number; asOfDate?: string }
    return parsed.version === 1 && parsed.asOfDate?.startsWith(month) ? entityId : null
  } catch {
    return null
  }
}

/** 待办证据行：金额与日期按可读中文拼装，数字仍来自引擎返回值 */
function taskDetail(task: OverviewTask): string {
  if (task.key === 'FUND_CONFIRMATION') {
    const { assetName, amount, navDate } = task.evidence
    const parts = [assetName, amount == null ? null : `合计 ${fmtCNY(amount)}`, navDate ? `${navDate} 净值` : null]
    return parts.filter(Boolean).join(' · ')
  }
  if (task.key === 'INVESTMENT_PLAN') {
    return `${task.evidence.planCount ?? 0} 条计划 · ${task.detail}`
  }
  if (task.key === 'ACCOUNT_RECONCILIATION') {
    const names = task.evidence.accountNames ?? []
    return `${names.join('、')}${task.count > names.length ? ' 等' : ''} · ${task.detail}`
  }
  return task.detail
}

export default async function OverviewPage({ searchParams }: {
  searchParams: Promise<{ view?: string; period?: string }>
}) {
  const { view, period: periodParam } = await searchParams
  const selectedPeriod = periodFrom(periodParam)
  // 旧版周、月、季链接继续打开投资表现。
  const isInvestment = view === 'investment' || (view == null && selectedPeriod != null)
  const period = selectedPeriod ?? 'THIS_MONTH'
  const d = await getDashboard(period)
  if (!d) return <SetupScreen />

  return (
    <div className="page-shell overview-dashboard">
      <header className="overview-page-header">
        <h1>总览</h1>
        {d.ctx.role !== 'VIEWER' && <Link href="/transactions#new-entry" className="overview-entry-action">＋ 录入流水</Link>}
      </header>
      <nav className="workflow-domain-nav" aria-label="总览视图">
        <Link href="/" prefetch={false} aria-current={!isInvestment ? 'page' : undefined} className={cx(!isInvestment && 'is-active')}>家庭资产</Link>
        <Link href={isInvestment && selectedPeriod && periodParam ? periodHref(periodParam) : '/?view=investment'} prefetch={false} aria-current={isInvestment ? 'page' : undefined} className={cx(isInvestment && 'is-active')}>投资表现</Link>
      </nav>
      {isInvestment ? <InvestmentOverview d={d} period={period} /> : <HouseholdOverview d={d} />}
    </div>
  )
}

async function HouseholdOverview({ d }: { d: DashboardData }) {
  const db = scopedDb(prisma, d.ctx)

  const now = new Date()
  const currentMonth = dateKeyAt(now).slice(0, 7)
  const monthStart = new Date(`${currentMonth}-01T00:00:00+08:00`)
  const [accountCount, registeredAssetCount, monthTxs, reconcileLogs, accounts, planRows, monthBuys, planReviews] = await Promise.all([
    db.account.count(),
    db.asset.count({ where: { cls: { not: 'CASH' } } }),
    db.transaction.findMany({
      where: { occurredAt: { gte: monthStart, lte: now }, voidedAt: null },
      select: { accountId: true },
    }),
    db.auditLog.findMany({
      where: { action: 'RECONCILE', entity: 'Account' },
      select: { entityId: true, detail: true },
    }),
    db.account.findMany({ select: { id: true, name: true } }),
    db.investmentPlan.findMany({ include: { assets: true }, orderBy: { createdAt: 'asc' } }),
    db.transaction.findMany({
      where: { type: 'BUY', voidedAt: null, occurredAt: { gte: monthStart, lte: now } },
      select: { id: true, accountId: true, assetId: true, amount: true, occurredAt: true, navSource: true },
    }),
    db.investmentPlanDayReview.findMany({
      where: { scheduledDate: { gte: monthStart, lte: now } },
      select: { planId: true, scheduledDate: true, revokedAt: true },
    }),
  ])

  const setupSteps = [
    { done: accountCount > 0, title: '建立账户', why: '银行卡、券商或房产，资产需要托管位置', href: '/accounts#new-account', action: '新建账户 →' },
    { done: registeredAssetCount > 0, title: '登记资产', why: '股票、基金代码自动识别行情，房产等走手动估值', href: '/accounts?view=assets#new-asset', action: '登记资产 →' },
    { done: d.state.txCount > 0, title: '录入首笔流水', why: '手工录入一笔，或用 CSV 批量导入历史', href: '/transactions#new-entry', action: '录入流水 →' },
  ]
  const setupDone = setupSteps.every((step) => step.done)

  // ── 待办证据：本月有账本活动但尚无当月对账凭证的账户 ──────────────────
  const reconciledAccounts = new Set(reconcileLogs.flatMap((log) => {
    const id = reconciliationAccountId(log.detail, currentMonth, log.entityId)
    return id ? [id] : []
  }))
  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]))
  const unreconciledAccounts = [...new Set(monthTxs.map((tx) => tx.accountId))]
    .filter((accountId) => !reconciledAccounts.has(accountId))
    .map((accountId) => accountNameById.get(accountId) ?? '未命名账户')

  // 定投待核对：与定投页同一输入形状（计划 + 当月有效 BUY + 计划日核对证据）
  const investmentPlanInputs: InvestmentPlanInput[] = planRows.map((plan) => ({
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
  }))
  const investmentPlanBuys: InvestmentPlanBuy[] = monthBuys.map((buy) => ({
    id: buy.id,
    accountId: buy.accountId,
    assetId: buy.assetId,
    amount: Number(buy.amount),
    occurredAt: buy.occurredAt,
    navSource: buy.navSource,
  }))

  const m = d.state.metrics
  const householdAssets = m.netWorth + d.state.inTransit
  const accountNames = new Map(accounts.map(({ id, name }) => [id, name]))
  const holdings = d.state.valued.filter(({ value }) => value !== 0).sort((a, b) => b.value - a.value)
  const householdComposition = [
    { label: '现金', value: m.liquidity.cash, color: C.inkFaint, holdings: holdings.filter(({ asset }) => asset.cls === 'CASH') },
    { label: '投资资产', value: m.liquidity.market, color: C.info, holdings: holdings.filter(({ asset }) => asset.cls !== 'CASH' && isInvestableAsset(asset)) },
    { label: '低流动性资产', value: m.liquidity.illiquid, color: C.violet, holdings: holdings.filter(({ asset }) => asset.cls !== 'CASH' && !isInvestableAsset(asset)) },
    { label: '在途资金', value: d.state.inTransit, color: C.amber, holdings: [] },
  ].filter(({ value, holdings }) => value !== 0 || holdings.length > 0)
  const wealthChartSeries = compactRecentSeries(d.series.map((point) => ({
    date: point.date,
    netWorth: point.netWorth,
    investable: point.investable,
    contributions: point.contributions,
  })))

  const primaryGoal = d.goals[0]

  const tasks = buildOverviewTasks({
    pendingFundPurchases: d.state.pendingFundPurchases.map((item) => ({
      assetName: d.state.assets.find((asset) => asset.id === item.assetId)?.name ?? '基金申购',
      amount: item.amount * (d.state.currencyRates[item.currency as keyof typeof d.state.currencyRates] ?? 1),
      navDate: item.navDate.toISOString().slice(0, 10),
    })),
    plans: investmentPlanInputs,
    buys: investmentPlanBuys,
    planReviews,
    unreconciledAccounts,
    month: currentMonth,
    now,
  })

  return (
    <>
      {!setupDone && (
        <section className="overview-setup" aria-labelledby="overview-setup-title">
          <div className="overview-section-heading">
            <div><h2 id="overview-setup-title">起步清单</h2></div>
          </div>
          <div className="overview-setup-grid">
            {setupSteps.map((step, index) => (
              <div key={step.title} className={step.done ? 'is-done' : undefined}>
                <span className="num">{step.done ? '✓' : String(index + 1).padStart(2, '0')}</span>
                <div><strong>{step.title}</strong><p>{step.why}</p></div>
                {!step.done && <Link href={step.href}>{step.action}</Link>}
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="overview-book-top">
        <section className="overview-compact-panel overview-balance-card" aria-label="家庭资产摘要">
          <div className="overview-balance-primary">
            <ScopeLabel scope="TOTAL_ASSETS" />
            <strong className="num" data-testid="overview-total-assets">{fmtCNY(householdAssets)}</strong>
            <small>含在途资金 · 未扣负债</small>
          </div>
          <div className="overview-balance-metrics">
            <div>
              <ScopeLabel scope="NET_WORTH" />
              <strong className="num" data-testid="overview-net-worth">{fmtCNY(d.state.netWorth)}</strong>
              <small>含房产与长期资产</small>
            </div>
            <div data-testid="overview-liabilities">
              <Link href="/accounts">负债 →</Link>
              <strong className="num">{fmtCNY(d.state.liabilitiesTotal)}</strong>
            </div>
            <div>
              <span title="负债占家庭总资产的比例">负债率</span>
              <strong className="num">{fmtPct(householdAssets > 0 ? d.state.liabilitiesTotal / householdAssets : null)}</strong>
            </div>
          </div>
        </section>

        <section className="overview-chart-surface overview-book-trend" aria-labelledby="overview-chart-title">
          <div className="overview-section-heading">
            <h2 id="overview-chart-title">净资产走势</h2>
            <span>截至 {wealthChartSeries.length ? fmtDate(wealthChartSeries[wealthChartSeries.length - 1].date) : '—'}</span>
          </div>
          <WealthChart data={wealthChartSeries} showRange height={168} />
        </section>
      </div>

      <section className="overview-compact-panel overview-household-composition" aria-labelledby="overview-household-title">
        <div className="overview-section-heading">
          <h2 id="overview-household-title">家庭资产构成</h2>
          <Link href="/accounts">账户与负债 →</Link>
        </div>
        {householdComposition.length === 0 ? <Empty>暂无家庭资产</Empty> : (
          <>
            <HouseholdCompositionChart
              groups={householdComposition.map(({ label, value, color }) => ({ label, value, color }))}
              assets={householdAssets}
              liabilities={d.state.liabilitiesTotal}
              netWorth={d.state.netWorth}
            />
            <div className="overview-asset-groups">
              <div className="overview-asset-group-head" aria-hidden="true">
                <span>资产类别</span><span>占总资产</span><span>金额</span>
              </div>
              {householdComposition.map(({ label, value, color, holdings: positions }) => {
                const values = (
                  <>
                    <span><i style={{ background: color }} />{label}</span>
                    <span className="num">{fmtPct(householdAssets > 0 ? value / householdAssets : null)}</span>
                    <strong className="num">{fmtCNY(value)}</strong>
                  </>
                )
                return positions.length > 0 ? (
                  <details key={label}>
                    <summary className="overview-asset-group-row">{values}</summary>
                    <ul className="overview-asset-group-items">
                      {positions.map((position) => (
                        <li key={`${position.accountId}:${position.assetId}`}>
                          <span>{position.asset.name}</span>
                          <Link href={`/accounts/${position.accountId}`}>{accountNames.get(position.accountId) ?? '查看账户'} →</Link>
                          <strong className="num">{fmtCNY(position.value)}</strong>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <Link key={label} className="overview-asset-group-row" href="/accounts?view=calendar">{values}</Link>
                )
              })}
            </div>
          </>
        )}
      </section>

      <div className="overview-secondary-grid">
        <aside className="overview-tasks" aria-labelledby="overview-tasks-title">
          <div className="overview-section-heading">
            <div><h2 id="overview-tasks-title">待核对</h2></div>
            {tasks.length > 0 && <span>{tasks.reduce((sum, task) => sum + task.count, 0)} 项待核对</span>}
          </div>
          {tasks.length === 0 ? (
            <div className="overview-task-done" role="status">
              <strong>当前没有需要核对的记录</strong>
              <p>目前没有基金份额、到期定投节点或活跃账户需要核对。</p>
              <Link href="/month-close">查看月结中心 →</Link>
            </div>
          ) : (
            <ul className="overview-task-list">
              {tasks.map((task) => (
                <li key={task.key}>
                  <Link href={task.href}>
                    <span className="overview-task-count num" data-task={task.key}>{task.count}</span>
                    <span className="overview-task-body">
                      <strong>{{ FUND_CONFIRMATION: '基金份额待确认', INVESTMENT_PLAN: '定投记录待核对', ACCOUNT_RECONCILIATION: '账户待对账' }[task.key]}</strong>
                      <small>{taskDetail(task)}</small>
                    </span>
                    <span className="overview-task-action">{task.action} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="overview-tasks-note">待核对不等于未执行，以平台记录为准。</p>
        </aside>
        <div className="overview-compact-panel overview-goal-panel">
          <div className="overview-section-heading">
            <div><h2>主目标进度</h2></div>
            <Link href="/goals">目标测算 →</Link>
          </div>
          {!primaryGoal ? <Empty action={{ href: '/goals', label: '建立目标' }}>尚未设定主目标</Empty> : (
            <>
              <div className="overview-goal-main">
                <strong className="num">{fmtPct(primaryGoal.projection.fundedRatio)}</strong>
                <span title={primaryGoal.name}>{primaryGoal.name}</span>
              </div>
              <div className="overview-goal-progress" role="progressbar" aria-label={`${primaryGoal.name} 完成度`} aria-valuenow={Math.min(100, Math.max(0, Math.round(primaryGoal.projection.fundedRatio * 100)))} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${Math.min(100, Math.max(0, primaryGoal.projection.fundedRatio * 100))}%` }} />
              </div>
              <div className="overview-goal-meta">
                <span>当前资本 <b className="num">{fmtCNY(primaryGoal.current)}</b></span>
                <span>目标 <b className="num">{fmtCNY(primaryGoal.targetAmount)}</b></span>
              </div>
              <p className="overview-goal-note">
                {primaryGoal.metric === 'INVESTABLE' ? '可自由投资口径，含在途资产' : '家庭净资产口径，含长期资产并扣负债'}
                {' · '}预计达成 <b className="num">{targetMonth(primaryGoal.projection.estimatedFireMonths)}</b>
                {' · '}所需月投入 <b className="num">{fmtCNY(primaryGoal.projection.requiredMonthly)}</b>
              </p>
              {d.goals.length > 1 && <Link className="overview-goal-more" href="/goals">另有 {d.goals.length - 1} 个既有目标</Link>}
            </>
          )}
        </div>
      </div>

      <ValuationSourceSummary
        items={mergePositionsByAsset(d.state.valued).map((position) => ({
          priceSource: position.priceSource,
          marketSource: d.state.quotes.get(position.asset.symbol)?.source,
          value: position.value,
        }))}
      />
    </>
  )
}

function InvestmentOverview({ d, period }: { d: DashboardData; period: ReviewPeriod }) {
  const valuationRows = mergePositionsByAsset(d.state.valued.filter(({ asset }) => isInvestableAsset(asset)))
  const performance = d.review.performance
  const periodLabel = performance.label
  const reviewHref = `/review?period=${period}`
  const allocationByClass = new Map<AssetClass, number>()
  for (const position of d.state.valued) {
    if (position.investable <= 0.005) continue
    allocationByClass.set(
      position.asset.cls,
      (allocationByClass.get(position.asset.cls) ?? 0) + position.investable,
    )
  }
  const allocationRows = [...allocationByClass.entries()]
    .map(([key, value]) => ({ key, label: ASSET_CLASS_LABEL[key], value, color: CLASS_COLORS[key] }))
    .sort((a, b) => b.value - a.value)
  const allocationTotal = allocationRows.reduce((sum, item) => sum + item.value, 0) + d.state.inTransit
  const largestInvestablePosition = valuationRows.reduce<(typeof valuationRows)[number] | null>((largest, position) => {
    if (position.asset.cls === 'CASH' || position.investable <= 0.005) return largest
    return !largest || position.investable > largest.investable ? position : largest
  }, null)
  const concentration = largestInvestablePosition
    ? {
        name: largestInvestablePosition.asset.name,
        weight: allocationTotal > 0 ? largestInvestablePosition.investable / allocationTotal : 0,
      }
    : null
  const valuationCoverage = d.review.valuationCoverage
  const latestValuationDate = d.review.latestValuationDate

  // 数据质量结论：除缺口外还要看估值日是否落后于已取得的最新行情交易日，
  // 否则“数据已更新”会在行情已更新的情况下持续显示为正常。
  const valuationNotice = (() => {
    if (d.review.valuationGapCount > 0) {
      return { warning: true, label: `${d.review.valuationGapCount} 项数据待更新` }
    }
    // 估值日与行情日都折算成北京归属日再比较（ADR-027），避免跨时区差一天误报
    const heldAssets = [...new Map(valuationRows.map((position) => [position.asset.symbol, position.asset])).values()]
    const quoteDates = heldAssets
      .map((asset) => attributionDateKey(
        { symbol: asset.symbol, currency: asset.currency, cls: asset.cls },
        d.state.quotes.get(asset.symbol)?.tradingDate,
      ))
      .filter((value): value is string => Boolean(value))
      .sort()
    const newestQuoteDate = quoteDates.length > 0 ? quoteDates[quoteDates.length - 1] : null
    if (newestQuoteDate && latestValuationDate && latestValuationDate < newestQuoteDate) {
      return { warning: true, label: `估值日落后最新行情（${newestQuoteDate}）` }
    }
    if (!latestValuationDate) return { warning: true, label: '暂无估值日期' }
    return { warning: false, label: '数据已更新' }
  })()

  return (
    <>
      <section className="overview-performance" aria-labelledby="overview-performance-title">
        <div className="overview-section-heading">
          <div>
            <h2 id="overview-performance-title">{periodLabel}投资表现</h2>
            <span className="overview-scope-label">可投资组合</span>
          </div>
          <div className="overview-performance-actions">
            <nav className="overview-period-tabs" aria-label="总览周期">
              {PERIODS.map((item) => (
                <Link
                  key={item.key}
                  href={periodHref(item.value)}
                  aria-current={period === item.key ? 'page' : undefined}
                  data-period={item.value}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link href={reviewHref}>查看复盘 →</Link>
          </div>
        </div>

        <div className="overview-performance-grid">
          <div className="overview-investment-summary" role="region" aria-label="投资摘要">
            <div className="overview-balance-primary">
              <ScopeLabel scope="INVESTABLE" />
              <strong className="num" data-testid="overview-investable">{fmtCNY(d.state.investable)}</strong>
              {d.state.inTransit > 0 && <small>含在途 {fmtCNY(d.state.inTransit)}</small>}
            </div>
            <div className="overview-performance-metrics">
              <div>
                <span>投资收益</span>
                <strong className={cx('num', (performance.amount ?? 0) >= 0 ? 'text-up' : 'text-down')}>{money(performance.amount, true)}</strong>
              </div>
              <div>
                <span>组合收益率 TWR</span>
                <strong className={cx('num', (performance.pct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtPct(performance.pct, { sign: true })}</strong>
              </div>
              <div>
                <span title="组合外部流入减流出，不含内部买卖与结算">净投入</span>
                <strong className="num">{money(performance.netFlow, true)}</strong>
              </div>
            </div>
            <div className="overview-book-day" data-testid="overview-today-pnl" data-amount={d.marketDayPnl.toFixed(2)}>
              <ScopeLabel scope="MARKET_DAY_PNL" />
              <strong className={cx('num', d.marketDayPnl > 0 && 'text-up', d.marketDayPnl < 0 && 'text-down')}>
                {fmtCNY(d.marketDayPnl, { sign: true })} · {fmtPct(d.marketDayPnlPct, { sign: true })}
              </strong>
              <Link href="/watch">看盘 →</Link>
            </div>
          </div>
          <OverviewPerformanceChart
            data={performance.curve.map(({ date, pct, amount, netWorth }) => ({ date, pct, amount, netWorth }))}
            hasReturnObservation={performance.pct != null && performance.curve.some((point) => point.dailyPct != null)}
          />
        </div>

        <section className="overview-evidence" aria-label="数据证据">
          {valuationNotice.warning && <span className="overview-evidence-state is-warning">{valuationNotice.label}</span>}
          <span>估值日 <b className="num">{latestValuationDate ?? '—'}</b></span>
          <span>估值覆盖 <b className="num">{fmtPct(valuationCoverage)}</b></span>
          <span>
            {d.review.valuationGapCount > 0
              ? <><b className="num">{d.review.valuationGapCount}</b> 项估值缺口<Link href="/health">数据健康 →</Link></>
              : <Link href="/health">数据健康 →</Link>}
          </span>
        </section>

        <details className="overview-book-reconciliation">
          <summary>期初与期末对账</summary>
          <div className="overview-equation" aria-label={`${periodLabel}结果桥`}>
            <div>
              <span title={wealthScope('PERIOD_START_INVESTABLE').detail}>期初可投资资产</span>
              <strong className="num">{money(performance.baseNetWorth)}</strong>
              {performance.basisDate && <time className="num" dateTime={performance.basisDate}>{performance.basisDate}</time>}
            </div>
            <i aria-hidden="true">+</i>
            <div><span>净投入</span><strong className="num">{money(performance.netFlow, true)}</strong></div>
            <i aria-hidden="true">+</i>
            <div><span>投资收益</span><strong className={cx('num', (performance.amount ?? 0) >= 0 ? 'text-up' : 'text-down')}>{money(performance.amount, true)}</strong></div>
            <i aria-hidden="true">=</i>
            <div className="overview-equation-result">
              <span title={wealthScope('PERIOD_END_INVESTABLE').detail}>期末可投资资产</span>
              <strong className="num">{money(performance.endNetWorth)}</strong>
              {performance.endDate && <time className="num" dateTime={performance.endDate}>{performance.endDate}</time>}
            </div>
          </div>
        </details>
      </section>

      <OverviewInvestmentAccounts dashboard={d} />
      <OverviewAnnualReturns series={d.series} />

      <div className="overview-secondary-grid">
        <div className="overview-compact-panel">
          <div className="overview-section-heading">
            <div><h2>可投资资产构成</h2></div>
            <Link href="/positions">查看持仓 →</Link>
          </div>
          {allocationRows.length === 0 && d.state.inTransit <= 0 ? <Empty>暂无可投资资产</Empty> : (
            <>
              <div className="overview-allocation-track" aria-label="可投资资产构成">
                {allocationRows.map((item) => (
                  <i key={item.key} style={{ width: `${allocationTotal > 0 ? item.value / allocationTotal * 100 : 0}%`, background: item.color }} />
                ))}
                {d.state.inTransit > 0 && <i style={{ width: `${d.state.inTransit / allocationTotal * 100}%`, background: C.amber }} />}
              </div>
              <div className="overview-allocation-list">
                {allocationRows.map((item) => (
                  <div key={item.key}><i style={{ background: item.color }} /><span>{item.label}</span><strong className="num">{fmtCNY(item.value)}</strong><em className="num">{fmtPct(allocationTotal > 0 ? item.value / allocationTotal : 0)}</em></div>
                ))}
                {d.state.inTransit > 0 && <div><i style={{ background: C.amber }} /><span>在途资金</span><strong className="num">{fmtCNY(d.state.inTransit)}</strong><em className="num">{fmtPct(allocationTotal > 0 ? d.state.inTransit / allocationTotal : 0)}</em></div>}
              </div>
              <p className="overview-allocation-note">
                构成按可投资资产口径；最大可投资持仓 {concentration ? `${concentration.name} ${fmtPct(concentration.weight)}` : '暂无非现金持仓'}
              </p>
            </>
          )}
        </div>

        <div className="overview-compact-panel">
          <div className="overview-section-heading">
            <div><h2>在途与资金状态</h2></div>
            <Link href="/accounts?view=calendar">资金日历 →</Link>
          </div>
          <div className="overview-state-list">
            <Link href="/accounts?view=calendar" className={d.state.pendingSettlements.length + d.state.pendingFundPurchases.length > 0 ? 'is-info' : 'is-ok'}>
              <i aria-hidden="true" /><span className="num">{d.state.inTransit > 0 ? fmtCNY(d.state.inTransit) : '已结清'}</span><strong>{d.state.pendingSettlements.length + d.state.pendingFundPurchases.length > 0 ? `${d.state.pendingSettlements.length + d.state.pendingFundPurchases.length} 笔在途` : '当前无在途资产'}</strong>
            </Link>
            <Link href="/fund-confirmations" className={d.state.pendingFundPurchases.length > 0 ? 'is-warning' : 'is-ok'}>
              <i aria-hidden="true" /><span className="num">{d.state.pendingFundPurchases.length}</span><strong>{d.state.pendingFundPurchases.length > 0 ? '笔基金份额待确认' : '无待确认基金份额'}</strong>
            </Link>
          </div>
        </div>
      </div>

      {d.state.pendingSettlements.length > 0 && (
        <section className="overview-transit-list" aria-label="赎回在途">
          {d.state.pendingSettlements.map((item) => {
            const assetName = d.state.assets.find((asset) => asset.id === item.sellAssetId)?.name ?? '基金赎回'
            const rate = d.state.currencyRates[item.currency as keyof typeof d.state.currencyRates] ?? 1
            return (
              <div key={item.sellTxId}>
                <span>赎回在途</span><strong>{assetName}</strong>
                <em>预计 {fmtDate(item.settlementDate)} 到账</em>
                <b className="num">{fmtCNY(item.amount * rate)}</b>
              </div>
            )
          })}
        </section>
      )}

      <ValuationSourceSummary
        items={valuationRows.map((position) => ({
          priceSource: position.priceSource,
          marketSource: d.state.quotes.get(position.asset.symbol)?.source,
          value: position.value,
        }))}
      />
    </>
  )
}
