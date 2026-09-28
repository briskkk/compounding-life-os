import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, PageHeader, SetupScreen, Tag, ReadOnlyNotice } from '@/components/ui'
import { InvestmentPlanForm, EndInvestmentPlanButton } from '@/components/investment-plan-form'
import { InvestmentPlanEditDialog } from '@/components/investment-plan-edit-dialog'
import { InvestmentPlanQuickEntry, type QuickEntryDay, type NoBuyWindowPlan } from '@/components/investment-plan-batch-entry'
import { RevokeInvestmentPlanNoBuyButton } from '@/components/investment-plan-no-buy-button'
import { HashOpenDetails } from '@/components/hash-open-details'
import { buildInvestmentPlanMonth, scheduledDatesInMonth, unrecordedScheduledDatesInMonth, type InvestmentPlanPace } from '@/lib/engine/investment-plan'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { cx, fmtDate, fmtMoney, fmtPct } from '@/lib/format'
import { RecordDomainNav } from '@/components/record-domain-nav'

export const dynamic = 'force-dynamic'

function monthKey(value?: string): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

const CADENCE_LABEL = {
  WEEKDAY: '每个工作日',
  WEEKLY: '每周',
  MONTHLY: '每月',
} as const

const PACE: Record<InvestmentPlanPace, { label: string; tone: 'down' | 'amber' | 'info' | 'dim' }> = {
  ON_TRACK: { label: '达到到期计划', tone: 'down' },
  BEHIND: { label: '低于到期计划', tone: 'amber' },
  UPCOMING: { label: '尚未到期', tone: 'info' },
  ENDED: { label: '已结束', tone: 'dim' },
}

function dateInput(value: Date | null | undefined): string {
  if (!value) return ''
  return value.toISOString().slice(0, 10)
}

function scheduleLabel(cadence: keyof typeof CADENCE_LABEL, scheduleDay: number | null): string {
  if (cadence === 'WEEKDAY') return CADENCE_LABEL[cadence]
  if (cadence === 'WEEKLY') return `${CADENCE_LABEL[cadence]}${['日', '一', '二', '三', '四', '五', '六'][scheduleDay ?? 1]}`
  return `${CADENCE_LABEL[cadence]} ${scheduleDay ?? 1} 日`
}

export default async function InvestmentPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string }>
}) {
  const sp = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)
  const selectedMonth = monthKey(sp.month)
  const window = monthWindow(selectedMonth)
  const [plans, buys, reviews, assets, accounts] = await Promise.all([
    db.investmentPlan.findMany({
      include: { account: true, assets: { include: { asset: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
    db.transaction.findMany({
      where: {
        type: 'BUY',
        voidedAt: null,
        occurredAt: { gte: window.start, lte: window.end },
      },
      orderBy: { occurredAt: 'asc' },
    }),
    db.investmentPlanDayReview.findMany({
      where: { scheduledDate: { gte: window.start, lte: window.end } },
    }),
    db.asset.findMany({
      where: { cls: { in: ['STOCK', 'FUND', 'ETF', 'GOLD'] } },
      orderBy: [{ currency: 'asc' }, { cls: 'asc' }, { symbol: 'asc' }],
    }),
    db.account.findMany({ orderBy: [{ currency: 'asc' }, { createdAt: 'asc' }] }),
  ])

  const enginePlans = plans.map((plan) => ({
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
  const engineBuys = buys.map((buy) => ({
      id: buy.id,
      accountId: buy.accountId,
      assetId: buy.assetId,
      amount: Number(buy.amount),
      occurredAt: buy.occurredAt,
      navSource: buy.navSource,
    }))
  const engineReviews = reviews.map((review) => ({
    planId: review.planId,
    scheduledDate: review.scheduledDate,
    revokedAt: review.revokedAt,
  }))
  const reviewByPlanDay = new Map(reviews.filter((review) => !review.revokedAt)
    .map((review) => [`${review.planId}|${dateKeyAt(review.scheduledDate)}`, review.id]))
  const report = buildInvestmentPlanMonth(selectedMonth, enginePlans, engineBuys, new Date(), engineReviews)
  const quickEntryByDay = new Map<string, QuickEntryDay>()
  for (const plan of plans) {
    if (!plan.accountId || plan.assets.length !== 1 || plan.assets[0].asset.cls !== 'FUND') continue
    const entryPlan = enginePlans.find((item) => item.id === plan.id)!
    const asset = plan.assets[0].asset
    for (const date of unrecordedScheduledDatesInMonth(selectedMonth, entryPlan, engineBuys, new Date(), engineReviews)) {
      const dateKey = dateKeyAt(date)
      const key = `${dateKey}|${plan.currency}`
      const day = quickEntryByDay.get(key) ?? { date: dateKey, currency: plan.currency, rows: [] }
      day.rows.push({
        planId: plan.id,
        assetName: asset.name,
        symbol: asset.symbol,
        accountName: plan.account?.name ?? '未指定账户',
        amount: Number(plan.amount),
        currency: plan.currency,
      })
      quickEntryByDay.set(key, day)
    }
  }
  const quickEntryDays = [...quickEntryByDay.values()].sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency))
  // 区间未买需要知道每个计划在该月的全部计划日；已限定账户 + 单只场外基金的计划才参与
  const quickEntryPlanIds = new Set(plans
    .filter((plan) => plan.accountId && plan.assets.length === 1 && plan.assets[0].asset.cls === 'FUND')
    .map((plan) => plan.id))
  const windowPlans: NoBuyWindowPlan[] = plans
    .filter((plan) => quickEntryPlanIds.has(plan.id))
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      amount: Number(plan.amount),
      currency: plan.currency,
      dates: scheduledDatesInMonth(selectedMonth, enginePlans.find((item) => item.id === plan.id)!)
        .map((date) => dateKeyAt(date))
        .filter((date) => date <= dateKeyAt(new Date())),
    }))
    .filter((plan) => plan.dates.length > 0)
  const quickEntryPlanDates = new Set(quickEntryDays.flatMap((day) => day.rows.map((row) => `${row.planId}|${day.date}`)))
  const pendingNodes = quickEntryDays.reduce((sum, day) => sum + day.rows.length, 0)
  const earliestPending = quickEntryDays[0] ? quickEntryDays[0].date.slice(5).replace('-', '/') : null
  // 批量核对只支持「已限定账户 + 单只场外基金」（ADR-024 第 5 条）；其余计划的待核对节点必须有出口。
  const cannotBatchEnter = plans.flatMap((plan) => {
    if (plan.accountId && plan.assets.length === 1 && plan.assets[0].asset.cls === 'FUND') return []
    const entryPlan = enginePlans.find((item) => item.id === plan.id)!
    const count = unrecordedScheduledDatesInMonth(selectedMonth, entryPlan, engineBuys, new Date(), engineReviews).length
    if (count === 0) return []
    const reason = plan.assets.length !== 1 ? `${plan.assets.length} 只候选资产` : !plan.accountId ? '未限定账户' : '非场外基金'
    return [{ name: plan.name, reason, count }]
  })

  const planById = new Map(plans.map((plan) => [plan.id, plan]))
  const currentMonth = monthKey()
  const monthRows = report.rows.filter((row) => (
    row.scheduledDates.length > 0
    || row.transactionCount > 0
    || (selectedMonth === currentMonth && planById.get(row.id)?.status === 'ACTIVE')
  ))
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const endedPlans = plans
    .filter((plan) => (
      plan.status === 'ENDED'
      || Boolean(plan.endDate && new Date(plan.endDate.getFullYear(), plan.endDate.getMonth(), plan.endDate.getDate()).getTime() < todayStart.getTime())
    ))
    .sort((a, b) => (b.endedAt ?? b.endDate ?? b.updatedAt).getTime() - (a.endedAt ?? a.endDate ?? a.updatedAt).getTime())
  const activeMonthRows = monthRows.filter((row) => row.pace !== 'ENDED')
  // 本轮仍有待核对节点的计划：用于「待核对」筛选，不受已勾选状态影响
  const plansWithPending = new Set(quickEntryDays.flatMap((day) => day.rows.map((row) => row.planId)))
  const PLAN_VIEWS = ['all', 'pending', 'behind', 'ended'] as const
  const view = (PLAN_VIEWS as readonly string[]).includes(sp.view ?? '') ? sp.view as typeof PLAN_VIEWS[number] : 'all'
  const viewCount = (key: typeof PLAN_VIEWS[number]) => key === 'ended'
    ? endedPlans.length
    : activeMonthRows.filter((row) => (
      key === 'all' ? true
        : key === 'pending' ? plansWithPending.has(row.id)
          : row.pace === 'BEHIND'
    )).length
  const visibleRows = activeMonthRows.filter((row) => (
    view === 'all' ? true
      : view === 'pending' ? plansWithPending.has(row.id)
        : view === 'behind' ? row.pace === 'BEHIND' : false
  ))
  const visibleGroups = [
    ...accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      rows: visibleRows.filter((row) => planById.get(row.id)?.accountId === account.id),
    })),
    {
      id: 'all-accounts',
      name: '全部同币种账户',
      currency: null,
      rows: visibleRows.filter((row) => !planById.get(row.id)?.accountId),
    },
  ].filter((group) => group.rows.length > 0)
  const endedGroups = [
    ...accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      plans: endedPlans.filter((plan) => plan.accountId === account.id),
    })),
    {
      id: 'all-accounts',
      name: '全部同币种账户',
      currency: null,
      plans: endedPlans.filter((plan) => !plan.accountId),
    },
  ].filter((group) => group.plans.length > 0)
  const totalsByCurrency = new Map<string, { planned: number; due: number; actual: number }>()
  for (const row of view === 'ended' ? activeMonthRows : visibleRows) {
    const totals = totalsByCurrency.get(row.currency) ?? { planned: 0, due: 0, actual: 0 }
    totals.planned += row.plannedAmount
    totals.due += row.dueAmount
    totals.actual += row.actualAmount
    totalsByCurrency.set(row.currency, totals)
  }
  const amountList = (key: 'planned' | 'due' | 'actual') => [...totalsByCurrency]
    .map(([currency, totals]) => fmtMoney(totals[key], currency))
    .join(' / ') || '—'
  const [year, month] = selectedMonth.split('-').map(Number)

  return (
    <div className="page-shell investment-plans-page">
      <PageHeader
        title="定投核对"
        description="计划定义节奏，账本记录实际投入；未买结论需人工确认。"
        right={(
          <div className="flex flex-wrap items-center justify-end gap-4">
            <Link href="/accounts?view=calendar" className="text-[13px] text-ink-dim transition-colors hover:text-accent">资金日历 →</Link>
            {canWrite && <a href="#new-investment-plan" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 text-[14px] font-medium text-bg">新建计划</a>}
          </div>
        )}
      />

      <RecordDomainNav active="plans" />

      <section className="investment-plan-console" aria-label="定投月度执行摘要">
        <header>
          <div><h2>{year} 年 {month} 月</h2></div>
          <nav aria-label="定投月份">
            <Link href={`/investment-plans?month=${shiftMonth(selectedMonth, -1)}`}>← 上月</Link>
            <Link href="/investment-plans">本月</Link>
            <Link href={`/investment-plans?month=${shiftMonth(selectedMonth, 1)}`}>下月 →</Link>
          </nav>
        </header>
        <div className="investment-plan-summary">
          <div className="is-pending"><span>待核对</span><strong className="num text-amber">{pendingNodes}</strong><small title={earliestPending ? `最早待核对计划日 ${earliestPending}` : '本月没有待核对节点'}>{earliestPending ? `最早 ${earliestPending}` : '本月已核对完'} →</small></div>
          <div><span>有效计划</span><strong className="num">{report.activePlans}</strong><small>只统计未结束策略</small></div>
          <div><span>本月计划</span><strong className="num">{amountList('planned')}</strong><small>{report.scheduledOccurrences} 个计划节点</small></div>
          <div><span>截至今日应投</span><strong className="num">{amountList('due')}</strong><small>{report.dueOccurrences} 个已到期节点</small></div>
          <div><span>账本实际投入</span><strong className="num text-accent">{amountList('actual')}</strong><small>{report.transactionCount} 笔有效 BUY</small></div>
          <div><span>净值待确认</span><strong className="num text-amber">{report.pendingCount}</strong><small><Link href="/fund-confirmations">去基金确认 →</Link></small></div>
        </div>
      </section>

      <section className="investment-plan-quick-entry" id="confirm-actual-buys" aria-label="定投实际申购批量核对">
        <header>
          <div><h2>核对并快速录入</h2></div>
          <p title="按日核对：勾选实际买入的基金，未勾选的当天确实没买时可用「本日未买」一次确认。两种结果都由你明确确认，未买入不会生成流水。">{pendingNodes > 0 ? `${quickEntryDays.length} 个待核对日 · ${pendingNodes} 个节点` : '本月没有待核对节点'}</p>
        </header>
        {canWrite ? <InvestmentPlanQuickEntry days={quickEntryDays} windowPlans={windowPlans} /> : <ReadOnlyNotice what="可以查看计划与执行记录，但不能录入实际申购" className="investment-plan-entry-empty" />}
        {cannotBatchEnter.length > 0 && (
          <p className="investment-plan-entry-limit">
            另有 {cannotBatchEnter.reduce((sum, item) => sum + item.count, 0)} 个节点需在
            {' '}<Link href="/transactions?type=BUY">流水页录入</Link>：{cannotBatchEnter.map((item) => `${item.name}（${item.reason}）`).join('、')}
          </p>
        )}
      </section>

      <section className="investment-plan-workbench">
        <div className="investment-plan-ledger">
          <header>
            <div><h2 title={view === 'ended' ? '历史计划仅保留配置与流水入口' : '每个计划日直接标明账本是否已有买入；净值待确认的买入仍计入实际投入'}>{view === 'ended' ? '历史计划' : '逐日执行'}</h2></div>
            <nav className="investment-plan-view-filter" aria-label="计划筛选">
              {([['all', '进行中'], ['pending', '待核对'], ['behind', '落后'], ['ended', '已结束']] as const).map(([key, label]) => (
                <Link
                  key={key}
                  href={key === 'all' ? `/investment-plans?month=${selectedMonth}` : `/investment-plans?month=${selectedMonth}&view=${key}`}
                  aria-current={view === key ? 'page' : undefined}
                >
                  {label} <span className="num">{viewCount(key)}</span>
                </Link>
              ))}
            </nav>
          </header>

          {view === 'ended' ? endedPlans.length === 0 ? (
            <Empty>还没有已结束的定投计划</Empty>
          ) : (
            <div className="investment-plan-account-groups investment-plan-archive-groups">
              {endedGroups.map((group) => (
                <section key={group.id} className="investment-plan-account-group" aria-label={`${group.name}的历史定投计划`}>
                  <header>
                    <div>
                      <h3>{group.name}</h3>
                      <p>{group.currency ? `${group.currency} 账户` : '未限定具体账户'}</p>
                    </div>
                    <span className="num">{group.plans.length} 条历史</span>
                  </header>
                  <div className="investment-plan-archive-list">
                    {group.plans.map((plan) => {
                      const closedAt = plan.endedAt ?? plan.endDate
                      const lifecycle = plan.status === 'ENDED' ? '已终止' : '已到期'
                      return (
                        <article key={plan.id} className="investment-plan-archive-row">
                          <div className="investment-plan-archive-id">
                            <div><h4>{plan.name}</h4><Tag tone="dim">{lifecycle}</Tag></div>
                            <p>{plan.assets.map((item) => item.asset.name).join(' + ')} · {plan.assets.map((item) => item.asset.symbol).join(' + ')}</p>
                          </div>
                          <div className="investment-plan-archive-meta">
                            <span>{scheduleLabel(plan.cadence, plan.scheduleDay)}</span>
                            <b className="num">{fmtMoney(Number(plan.amount), plan.currency)}</b>
                          </div>
                          <div className="investment-plan-archive-meta">
                            <span>运行区间</span>
                            <b className="num">{fmtDate(plan.startDate)} — {closedAt ? fmtDate(closedAt) : '—'}</b>
                          </div>
                          <Link href={plan.accountId ? `/transactions?account=${plan.accountId}&type=BUY` : '/transactions?type=BUY'}>查看历史流水</Link>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <Empty action={canWrite ? { href: '#new-investment-plan', label: '建立第一条定投计划' } : undefined}>
              {plans.length === 0 ? '还没有定投计划' : view === 'all' ? '所选月份没有进行中的计划或实际买入' : '当前筛选下没有计划'}
            </Empty>
          ) : (
            <div className="investment-plan-account-groups">
              {visibleGroups.map((group) => (
                <section key={group.id} className="investment-plan-account-group" aria-label={`${group.name}的定投计划`}>
                  <header>
                    <div>
                      <h3>{group.name}</h3>
                      <p>{group.currency ? `${group.currency} 账户` : '未限定具体账户'}</p>
                    </div>
                    <span className="num">{group.rows.length} 条计划</span>
                  </header>
                  <div className="investment-plan-rows">
              {group.rows.map((row) => {
                const plan = planById.get(row.id)!
                const pace = PACE[row.pace]
                const completion = row.dueAmount > 0 ? row.actualAmount / row.dueAmount : null
                const recordedDays = row.days.filter((day) => day.status === 'RECORDED').length
                const confirmedNoBuyDays = row.days.filter((day) => day.status === 'CONFIRMED_NO_BUY').length
                const unrecordedDays = row.days.filter((day) => day.status === 'UNRECORDED_DUE').length
                const upcomingDays = row.days.filter((day) => day.status === 'UPCOMING').length
                // 7 列真实月历：按该月 1 日的星期定位，不再假定「周一开工、周末无节点」
                const firstDayOffset = row.days.length > 0
                  ? (new Date(row.days[0].date.getFullYear(), row.days[0].date.getMonth(), 1).getDay() + 6) % 7
                  : 0
                // 进度条颜色跟「是否落后于到期计划」走，而不是按百分比阈值；
                // 定投早期完成率天然很低，按阈值上色会把正常进度画成告警。
                const behind = row.pace === 'BEHIND'
                const progressTone = row.pace === 'ENDED' ? 'is-dim' : behind ? 'is-behind' : 'is-on-track'
                return (
                  <article key={row.id} className={cx('investment-plan-row', row.pace === 'ENDED' && 'is-ended')}>
                    <div className="investment-plan-row-main">
                      <div className="investment-plan-row-id">
                        <div className="flex flex-wrap items-center gap-2"><h3>{plan.name}</h3><Tag tone={pace.tone}>{pace.label}</Tag></div>
                        <p>{scheduleLabel(plan.cadence, plan.scheduleDay)} · 每期 {fmtMoney(Number(plan.amount), plan.currency)} · {plan.account?.name ?? '全部同币种账户'} · {plan.assets.map((item) => item.asset.symbol).join(' + ')}</p>
                      </div>
                      <div className="investment-plan-row-metrics">
                        <div className="investment-plan-completion">
                          <span>{row.pace === 'ENDED' ? '结束前完成率' : '截至今日完成率'}</span>
                          <b className={cx('num', row.pace === 'ENDED' ? 'text-dim' : behind ? 'text-amber' : undefined)}>{fmtPct(completion)}</b>
                          <div className="investment-plan-completion-bar" aria-hidden="true"><i className={progressTone} style={{ width: `${Math.min(100, Math.max(0, (completion ?? 0) * 100))}%` }} /></div>
                        </div>
                        <div><span>实际 / 到期</span><b className="num">{fmtMoney(row.actualAmount, row.currency)} <small>/ {fmtMoney(row.dueAmount, row.currency)}</small></b></div>
                        <div><span>本月计划</span><b className="num text-dim">{fmtMoney(row.plannedAmount, row.currency)}</b></div>
                        <div><span>下一计划日</span><b className="num text-dim">{row.nextDate ? fmtDate(row.nextDate).slice(5) : '—'}</b></div>
                        <div className="investment-plan-row-actions">
                          <Link href={plan.accountId ? `/transactions?account=${plan.accountId}&type=BUY` : '/transactions?type=BUY'}>查看流水</Link>
                          {canWrite && plan.status === 'ACTIVE' && row.pace !== 'ENDED' && (
                            <InvestmentPlanEditDialog
                              initial={{
                                id: plan.id,
                                name: plan.name,
                                amount: Number(plan.amount),
                                cadence: plan.cadence,
                                scheduleDay: plan.scheduleDay,
                                startDate: dateInput(plan.startDate),
                                endDate: plan.endDate ? dateInput(plan.endDate) : null,
                                accountId: plan.accountId,
                                assetIds: plan.assets.map((item) => item.assetId),
                                note: plan.note,
                              }}
                              assets={assets.map((asset) => ({ id: asset.id, symbol: asset.symbol, name: asset.name, cls: asset.cls, currency: asset.currency }))}
                              accounts={accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency }))}
                            />
                          )}
                          {canWrite && plan.status === 'ACTIVE' && row.pace !== 'ENDED' && <EndInvestmentPlanButton id={plan.id} name={plan.name} />}
                        </div>
                      </div>
                    </div>

                    <details className="investment-plan-row-detail" open={unrecordedDays > 0}>
                      <summary>
                        <span>逐日证据</span>
                        <span className="is-recorded">已录入 {recordedDays}</span>
                        <span className="is-no-buy">已核对未买 {confirmedNoBuyDays}</span>
                        <span className="is-unrecorded">待核对 {unrecordedDays}</span>
                        <span className="is-upcoming">未到期 {upcomingDays}</span>
                        <em>本月计划日 {row.days.length}</em>
                      </summary>
                      <div className="investment-plan-execution" aria-label={`${plan.name}本月逐日执行情况`}>
                        {row.days.length > 0 ? (
                          <div className="investment-plan-day-grid">
                            {['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day} className="investment-plan-weekday-label">{day}</span>)}
                            {Array.from({ length: firstDayOffset }, (_, index) => <span key={`empty-${index}`} className="investment-plan-day-empty" aria-hidden="true" />)}
                            {row.days.map((day) => {
                              const dateKey = dateKeyAt(day.date)
                              const canQuickEnter = canWrite && day.status === 'UNRECORDED_DUE' && quickEntryPlanDates.has(`${plan.id}|${dateKey}`)
                              const dayClass = cx('investment-plan-day', `is-${day.status.toLowerCase().replace('_', '-')}`, canQuickEnter && 'is-actionable')
                              const dayLabel = `${fmtDate(day.date)}：${day.status === 'RECORDED' ? `账本已录入 ${fmtMoney(day.actualAmount, row.currency)}${day.pendingCount ? '，份额待确认' : ''}` : day.status === 'CONFIRMED_NO_BUY' ? '已核对当天未买入' : day.status === 'UNRECORDED_DUE' ? canQuickEnter ? '到期但账本未录入，前往按日核对' : '到期但账本未录入' : '尚未到期'}`
                              const dayContent = <>
                                <span className="investment-plan-day-date num">{String(day.date.getMonth() + 1).padStart(2, '0')}/{String(day.date.getDate()).padStart(2, '0')}</span>
                                <strong>{day.status === 'RECORDED' ? '已录入' : day.status === 'CONFIRMED_NO_BUY' ? '未买入' : day.status === 'UNRECORDED_DUE' ? '待核对' : '未到期'}</strong>
                                <small>{day.status === 'RECORDED' ? fmtMoney(day.actualAmount, row.currency) : `计划 ${fmtMoney(Number(plan.amount), row.currency)}`}</small>
                                {day.pendingCount > 0 && <em>份额待确认</em>}
                                {day.hasNoBuyReviewConflict && <em className="investment-plan-day-review-conflict">账本已有买入，此前未买确认需撤销</em>}
                                {canQuickEnter && <em className="investment-plan-day-action">去核对本日 →</em>}
                                {canWrite && (day.status === 'CONFIRMED_NO_BUY' || day.hasNoBuyReviewConflict) && reviewByPlanDay.has(`${plan.id}|${dateKey}`) && <RevokeInvestmentPlanNoBuyButton id={reviewByPlanDay.get(`${plan.id}|${dateKey}`)!} />}
                              </>
                              return canQuickEnter
                                ? <a key={day.date.getTime()} href={`#quick-entry-${dateKey}-${row.currency}`} className={dayClass} aria-label={dayLabel}>{dayContent}</a>
                                : <div key={day.date.getTime()} className={dayClass} aria-label={dayLabel}>{dayContent}</div>
                            })}
                          </div>
                        ) : <p className="investment-plan-day-none">本月没有计划日；实际买入仍在金额和流水中显示。</p>}
                        {row.offScheduleDates.length > 0 && <p className="investment-plan-off-schedule">另有 {row.offScheduleDates.length} 个非计划日买入：{row.offScheduleDates.map((date) => `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`).join('、')}，已计入实际投入。</p>}
                        <p className="investment-plan-row-note">{row.pendingCount > 0 ? `${row.pendingCount} 笔 / ${fmtMoney(row.pendingAmount, row.currency)} 待官方净值确认` : '本月无待确认份额'}</p>
                      </div>
                    </details>
                  </article>
                )
              })}
                  </div>
                </section>
              ))}
            </div>
          )}
          <p className="investment-plan-boundary">{view === 'ended' ? '历史计划不再参与待核对和逐日执行；真实买入仍保留在账本流水中。' : '实际投入按“候选资产 + 账户 + 当月有效 BUY”合并，用于执行核对；收益仍以组合复盘为准。'}</p>
        </div>

        {canWrite ? <HashOpenDetails
          id="new-investment-plan"
          className="investment-plan-editor"
          summary={<><span><strong>建立定投轨道</strong></span><small>按需展开计划编辑</small></>}
        >
          {assets.length > 0 ? (
            <InvestmentPlanForm
              assets={assets.map((asset) => ({ id: asset.id, symbol: asset.symbol, name: asset.name, cls: asset.cls, currency: asset.currency }))}
              accounts={accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency }))}
            />
          ) : <Empty action={{ href: '/accounts?view=assets', label: '先登记投资资产' }}>暂无可用于定投的资产</Empty>}
        </HashOpenDetails> : <ReadOnlyNotice what="可以查看计划与实际执行，但不能创建或结束计划" className="investment-plan-readonly" />}
      </section>
    </div>
  )
}
