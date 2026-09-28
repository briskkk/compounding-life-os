// 总览：家庭财富工作台首屏。
// 顺序按「结论 → 解释 → 证据」：三口径家底 → 数据证据 → 周期投资表现与结果桥 →
// 财富轨迹与待办 → 可投资资产构成与主目标。所有数字来自账本、快照与复盘引擎，
// 页面不做任何前端财务推算（见 ADR-003 / ADR-006 / ADR-035）。
import Link from 'next/link'
import { getDashboard } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, SetupScreen, ScopeLabel } from '@/components/ui'
import { WealthChart } from '@/components/charts'
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

function periodFrom(value?: string): ReviewPeriod {
  if (value === 'week') return 'THIS_WEEK'
  if (value === 'quarter') return 'THIS_QUARTER'
  return 'THIS_MONTH'
}

function periodHref(value: string): string {
  return value === 'month' ? '/' : `/?period=${value}`
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

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const params = await searchParams
  const period = periodFrom(params.period)
  const d = await getDashboard(period)
  if (!d) return <SetupScreen />
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
  const valuationRows = mergePositionsByAsset(d.state.valued)
  const performance = d.review.performance
  const periodLabel = performance.label
  const periodChange = performance.baseNetWorth != null && performance.endNetWorth != null
    ? performance.endNetWorth - performance.baseNetWorth
    : null
  const reviewHref = `/review?period=${period}`
  const wealthChartSeries = compactRecentSeries(d.series.map((point) => ({
    date: point.date,
    netWorth: point.netWorth,
    investable: point.investable,
    contributions: point.contributions,
  })))

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
  const pendingFundCount = d.state.pendingFundPurchases.length
  const primaryGoal = d.goals[0]
  const valuationCoverage = d.review.valuationCoverage
  const latestValuationDate = d.review.latestValuationDate

  // 数据质量结论：除缺口外还要看估值日是否落后于已取得的最新行情交易日，
  // 否则“数据已更新”会在行情已更新的情况下持续显示为正常。
  const valuationNotice = (() => {
    if (d.review.valuationGapCount > 0) {
      return { warning: true, label: `${d.review.valuationGapCount} 项数据待更新` }
    }
    // 估值日与行情日都折算成北京归属日再比较（ADR-027），避免跨时区差一天误报
    const heldAssets = [...new Map(d.state.valued.map((position) => [position.asset.symbol, position.asset])).values()]
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
    <div className="page-shell overview-dashboard">
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

      <header className="overview-page-header">
        <div>
          <div className="eyebrow">家庭账本 · 当前状态</div>
          <h1>家庭财富总览</h1>
          <p className="overview-page-note">看清家底，也看见每一步积累。</p>
        </div>
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
      </header>

      <section className="overview-scope-strip" aria-label="家庭财富三个口径">
        <article className="overview-scope is-primary">
          <header><ScopeLabel scope="NET_WORTH" /></header>
          <strong className="num overview-scope-value" data-testid="overview-net-worth">{fmtCNY(d.state.netWorth)}</strong>
          <p>全部资产减负债，包含房产与长期持股</p>
        </article>
        <article className="overview-scope">
          <header><ScopeLabel scope="INVESTABLE" /></header>
          <strong className="num overview-scope-value" data-testid="overview-investable">{fmtCNY(d.state.investable)}</strong>
          <p>
            {d.state.inTransit > 0
              ? <>含在途 {fmtCNY(d.state.inTransit)} · <Link href="/accounts?view=calendar">在途明细 →</Link></>
              : '现金、基金、ETF、股票与黄金，不含房产'}
          </p>
        </article>
        <article className="overview-scope" data-testid="overview-liabilities">
          <header><span className="overview-scope-label">家庭负债<em className="scope-badge">总资产中的减项</em></span></header>
          <strong className="num overview-scope-value">{fmtCNY(d.state.liabilitiesTotal)}</strong>
          <p>
            {d.state.liabilities.length > 0
              ? <>{d.state.liabilities.length} 项负债 · 负债率 <span className="num">{fmtPct(m.netWorth > 0 ? d.state.liabilitiesTotal / m.netWorth : 0)}</span></>
              : '当前没有登记负债'}
          </p>
        </article>
      </section>

      <section className="overview-evidence" aria-label="数据证据">
        <span className={cx('overview-evidence-state', valuationNotice.warning && 'is-warning')}>
          <i aria-hidden="true" />{valuationNotice.label}
        </span>
        <span>估值日 <b className="num">{latestValuationDate ?? '—'}</b></span>
        <span>估值覆盖 <b className="num">{fmtPct(valuationCoverage)}</b></span>
        <span>
          份额待确认 <b className="num">{pendingFundCount}</b>
          <Link href="/fund-confirmations">基金确认 →</Link>
        </span>
        <span>
          {d.review.valuationGapCount > 0
            ? <><b className="num">{d.review.valuationGapCount}</b> 项估值缺口<Link href="/health">数据健康 →</Link></>
            : <Link href="/health">数据健康 →</Link>}
        </span>
        <span className="overview-evidence-pnl" data-testid="overview-today-pnl" data-amount={d.marketDayPnl.toFixed(2)}>
          <ScopeLabel scope="MARKET_DAY_PNL" badgeClassName="is-inline" />
          <b className={cx('num', (d.marketDayPnl ?? 0) >= 0 ? 'text-up' : 'text-down')}>
            {(d.marketDayPnl ?? 0) >= 0 ? '+' : '−'}{fmtCNY(Math.abs(d.marketDayPnl ?? 0))}
            <em>{fmtPct(d.marketDayPnlPct, { sign: true })}</em>
          </b>
        </span>
      </section>

      <section className="overview-performance" aria-labelledby="overview-performance-title">
        <div className="overview-section-heading">
          <div>
            <h2 id="overview-performance-title">{periodLabel}投资表现</h2>
          </div>
          <span><ScopeLabel scope="INVESTABLE" badgeClassName="is-inline" /></span>
        </div>

        <div className="overview-performance-grid">
          <div className="overview-performance-metrics">
            <div>
              <span>投资收益</span>
              <strong className={cx('num', (performance.amount ?? 0) >= 0 ? 'text-up' : 'text-down')}>{money(performance.amount, true)}</strong>
              <small>{performance.basisDate ?? '—'} → {performance.endDate ?? '—'} · 已扣除外部资金流</small>
            </div>
            <div>
              <span>外部净投入</span>
              <strong className="num">{money(performance.netFlow, true)}</strong>
              <small>转入减转出，不含内部买卖与结算腿</small>
            </div>
            <div>
              <span>组合收益率 TWR</span>
              <strong className={cx('num', (performance.pct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtPct(performance.pct, { sign: true })}</strong>
              <small>时间加权，衡量组合路径</small>
            </div>
          </div>
          <div className="overview-performance-summary">
            <span>{periodLabel}可投资资产变化</span>
            <strong className={cx('num', (periodChange ?? 0) >= 0 ? 'text-up' : 'text-down')}>{money(periodChange, true)}</strong>
            <small>
              {periodChange == null
                ? '本周期尚无可对账变化'
                : <>由净投入 {money(performance.netFlow, true)} 与投资收益 {money(performance.amount, true)} 共同构成</>}
            </small>
            <Link href={reviewHref}>查看完整复盘 →</Link>
          </div>
        </div>

        <div className="overview-equation" aria-label={`${periodLabel}结果桥`}>
          <div><span><ScopeLabel scope="PERIOD_START_INVESTABLE" badgeClassName="is-inline" /></span><strong className="num">{money(performance.baseNetWorth)}</strong></div>
          <i aria-hidden="true">+</i>
          <div><span>净投入</span><strong className="num">{money(performance.netFlow, true)}</strong></div>
          <i aria-hidden="true">+</i>
          <div><span>投资收益</span><strong className={cx('num', (performance.amount ?? 0) >= 0 ? 'text-up' : 'text-down')}>{money(performance.amount, true)}</strong></div>
          <i aria-hidden="true">=</i>
          <div className="overview-equation-result"><span><ScopeLabel scope="PERIOD_END_INVESTABLE" badgeClassName="is-inline" /></span><strong className="num">{money(performance.endNetWorth)}</strong></div>
        </div>
      </section>

      <section className="overview-main-grid">
        <div className="overview-chart-surface">
          <div className="overview-section-heading">
            <div><h2>财富轨迹</h2></div>
            <span>轨迹至 {wealthChartSeries.length ? fmtDate(wealthChartSeries[wealthChartSeries.length - 1].date) : '—'}</span>
          </div>
          <div className="overview-chart-summary">
            <span>净资产 <b className="num">{fmtCNY(d.state.netWorth)}</b></span>
            <span>累计净投入 <b className="num">{fmtCNY(d.attribution.contributions)}</b></span>
            <span>累计投资收益 <b className={cx('num', d.attribution.gain >= 0 ? 'text-up' : 'text-down')}>{fmtCNY(d.attribution.gain, { sign: true })}</b></span>
          </div>
          <WealthChart data={wealthChartSeries} showRange height={270} />
        </div>

        <aside className="overview-tasks" aria-labelledby="overview-tasks-title">
          <div className="overview-section-heading">
            <div><h2 id="overview-tasks-title">待办</h2></div>
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
                    <span className="overview-task-count num">{task.count}</span>
                    <span className="overview-task-body">
                      <strong>{task.title}</strong>
                      <small>{taskDetail(task)}</small>
                    </span>
                    <span className="overview-task-action">{task.action} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="overview-tasks-note">待核对不等于未执行；实际结果以平台与账本流水为准。</p>
        </aside>
      </section>

      <section className="overview-secondary-grid">
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

        <div className="overview-compact-panel">
          <div className="overview-section-heading">
            <div><h2>在途与资金状态</h2></div>
            <Link href="/health">健康中心 →</Link>
          </div>
          <div className="overview-state-list">
            <Link href="/accounts?view=calendar" className={d.state.pendingSettlements.length + d.state.pendingFundPurchases.length > 0 ? 'is-info' : 'is-ok'}>
              <i aria-hidden="true" /><span className="num">{d.state.inTransit > 0 ? fmtCNY(d.state.inTransit) : '已结清'}</span><strong>{d.state.pendingSettlements.length + d.state.pendingFundPurchases.length > 0 ? `${d.state.pendingSettlements.length + d.state.pendingFundPurchases.length} 笔在途` : '当前无在途资产'}</strong>
            </Link>
            <Link href="/fund-confirmations" className={d.state.pendingFundPurchases.length > 0 ? 'is-warning' : 'is-ok'}>
              <i aria-hidden="true" /><span className="num">{d.state.pendingFundPurchases.length}</span><strong>{d.state.pendingFundPurchases.length > 0 ? '笔基金份额待确认' : '无待确认基金份额'}</strong>
            </Link>
            <Link href="/health" className={d.review.valuationGapCount > 0 ? 'is-warning' : 'is-ok'}>
              <i aria-hidden="true" /><span className="num">{fmtPct(valuationCoverage)}</span><strong>{d.review.valuationGapCount > 0 ? `${d.review.valuationGapCount} 项资产估值存在缺口` : '当前估值无缺口'}</strong>
            </Link>
            <Link href="/allocation" className={concentration && concentration.weight > 0.25 ? 'is-warning' : 'is-info'}>
              <i aria-hidden="true" /><span className="num">{concentration ? fmtPct(concentration.weight) : '—'}</span><strong>{concentration ? `最大可投资持仓 · ${concentration.name}` : '暂无非现金持仓'}</strong>
            </Link>
          </div>
        </div>
      </section>

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
        className="overview-source-summary"
      />
    </div>
  )
}
