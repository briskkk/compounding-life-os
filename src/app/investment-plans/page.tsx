import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, PageHeader, SetupScreen, Tag, ReadOnlyNotice } from '@/components/ui'
import { InvestmentPlanForm, EndInvestmentPlanButton } from '@/components/investment-plan-form'
import { InvestmentPlanQuickEntry, type QuickEntryDay } from '@/components/investment-plan-quick-entry'
import { RevokeInvestmentPlanNoBuyButton } from '@/components/investment-plan-no-buy-button'
import { HashOpenDetails } from '@/components/hash-open-details'
import { buildInvestmentPlanMonth, unrecordedScheduledDatesInMonth, type InvestmentPlanPace } from '@/lib/engine/investment-plan'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { cx, fmtDate, fmtMoney, fmtPct } from '@/lib/format'

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

function scheduleLabel(cadence: keyof typeof CADENCE_LABEL, scheduleDay: number | null): string {
  if (cadence === 'WEEKDAY') return CADENCE_LABEL[cadence]
  if (cadence === 'WEEKLY') return `${CADENCE_LABEL[cadence]}${['日', '一', '二', '三', '四', '五', '六'][scheduleDay ?? 1]}`
  return `${CADENCE_LABEL[cadence]} ${scheduleDay ?? 1} 日`
}

export default async function InvestmentPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
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
  const quickEntryPlanDates = new Set(quickEntryDays.flatMap((day) => day.rows.map((row) => `${row.planId}|${day.date}`)))

  const planById = new Map(plans.map((plan) => [plan.id, plan]))
  const currentMonth = monthKey()
  const visibleRows = report.rows.filter((row) => (
    row.scheduledDates.length > 0
    || row.transactionCount > 0
    || (selectedMonth === currentMonth && planById.get(row.id)?.status === 'ACTIVE')
  ))
  const totalsByCurrency = new Map<string, { planned: number; due: number; actual: number }>()
  for (const row of visibleRows) {
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
        kicker="Plan × ledger"
        title="定投不是一串提醒，而是一条可核对的轨道。"
        description="计划定义节奏，账本记录实际投入。可在下方批量核对并录入平台已发生的申购；计划本身不会自动下单或写入交易。"
        right={(
          <div className="flex flex-wrap items-center justify-end gap-4">
            <Link href="/accounts?view=calendar" className="text-[13px] text-ink-dim transition-colors hover:text-accent">资金日历 →</Link>
            {canWrite && <a href="#new-investment-plan" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 text-[14px] font-medium text-bg">新建计划</a>}
          </div>
        )}
      />

      <section className="investment-plan-console" aria-label="定投月度执行摘要">
        <header>
          <div><span className="eyebrow">Execution month</span><h2>{year} 年 {month} 月</h2></div>
          <nav aria-label="定投月份">
            <Link href={`/investment-plans?month=${shiftMonth(selectedMonth, -1)}`}>← 上月</Link>
            <Link href="/investment-plans">本月</Link>
            <Link href={`/investment-plans?month=${shiftMonth(selectedMonth, 1)}`}>下月 →</Link>
          </nav>
        </header>
        <div className="investment-plan-summary">
          <div><span>有效计划</span><strong className="num">{report.activePlans}</strong><small>只统计未结束策略</small></div>
          <div><span>本月计划</span><strong className="num">{amountList('planned')}</strong><small>{report.scheduledOccurrences} 个计划节点</small></div>
          <div><span>截至今日应投</span><strong className="num">{amountList('due')}</strong><small>{report.dueOccurrences} 个已到期节点</small></div>
          <div><span>账本实际投入</span><strong className="num text-accent">{amountList('actual')}</strong><small>{report.transactionCount} 笔有效 BUY</small></div>
          <div><span>净值待确认</span><strong className="num text-amber">{report.pendingCount}</strong><small>金额已计入实际投入</small></div>
        </div>
      </section>

      <section className="investment-plan-quick-entry" aria-label="定投实际申购快速录入">
        <header>
          <div><span className="eyebrow">Confirm actual buys</span><h2>核对并快速录入</h2></div>
          <p>按日核对：勾选实际买入的基金；若未勾选的当天确实没买，可一次确认未执行。两种结果均由你明确确认，未买入不会生成流水。</p>
        </header>
        {canWrite ? <InvestmentPlanQuickEntry days={quickEntryDays} foldBefore={selectedMonth === monthKey() ? dateKeyAt(new Date(Date.now() - 7 * 86400000)) : undefined} /> : <ReadOnlyNotice what="可以查看计划与执行记录，但不能录入实际申购" className="investment-plan-entry-empty" />}
      </section>

      <section className="investment-plan-workbench">
        <div className="investment-plan-ledger">
          <header>
            <div><span className="eyebrow">Plan × ledger</span><h2>逐日执行</h2></div>
            <p>每个计划日直接标明账本是否已有买入；净值待确认的买入仍计入实际投入。</p>
          </header>

          {visibleRows.length === 0 ? (
            <Empty action={canWrite ? { href: '#new-investment-plan', label: '建立第一条定投计划' } : undefined}>
              {plans.length === 0 ? '还没有定投计划' : '所选月份没有计划或实际买入'}
            </Empty>
          ) : (
            <div className="investment-plan-rows">
              {visibleRows.map((row) => {
                const plan = planById.get(row.id)!
                const pace = PACE[row.pace]
                const difference = row.actualAmount - row.dueAmount
                const recordedDays = row.days.filter((day) => day.status === 'RECORDED').length
                const confirmedNoBuyDays = row.days.filter((day) => day.status === 'CONFIRMED_NO_BUY').length
                const unrecordedDays = row.days.filter((day) => day.status === 'UNRECORDED_DUE').length
                const upcomingDays = row.days.filter((day) => day.status === 'UPCOMING').length
                const firstDayOffset = plan.cadence === 'WEEKDAY' && row.days.length > 0
                  ? (row.days[0].date.getDay() + 6) % 7
                  : 0
                return (
                  <article key={row.id} className={cx('investment-plan-row', row.pace === 'ENDED' && 'is-ended')}>
                    <header>
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><h3>{plan.name}</h3><Tag tone={pace.tone}>{pace.label}</Tag></div>
                        <p>{scheduleLabel(plan.cadence, plan.scheduleDay)} · 每期 {fmtMoney(Number(plan.amount), plan.currency)} · {plan.account?.name ?? '全部同币种账户'}</p>
                      </div>
                      <div className="investment-plan-row-actions">
                        <Link href={plan.accountId ? `/transactions?account=${plan.accountId}&type=BUY` : '/transactions?type=BUY'}>查看流水</Link>
                        {canWrite && plan.status === 'ACTIVE' && row.pace !== 'ENDED' && <EndInvestmentPlanButton id={plan.id} name={plan.name} />}
                      </div>
                    </header>

                    <div className="investment-plan-amounts">
                      <div><span>本月计划</span><b className="num">{fmtMoney(row.plannedAmount, row.currency)}</b></div>
                      <div><span>截至今日</span><b className="num">{fmtMoney(row.dueAmount, row.currency)}</b></div>
                      <div><span>实际投入</span><b className="num text-accent">{fmtMoney(row.actualAmount, row.currency)}</b></div>
                      <div><span>相对到期计划</span><b className={cx('num', difference >= -0.01 ? 'text-down' : 'text-amber')}>{fmtMoney(difference, row.currency, { sign: true })}</b></div>
                      <div><span>截至今日金额完成率</span><b className="num">{fmtPct(row.dueAmount > 0 ? row.actualAmount / row.dueAmount : null)}</b></div>
                    </div>

                    <div className="investment-plan-execution" aria-label={`${plan.name}本月逐日执行情况`}>
                      <div className="investment-plan-execution-heading">
                        <strong>本月计划日 · {row.days.length}</strong>
                        <div className="investment-plan-execution-counts">
                          <span className="is-recorded">已录入 {recordedDays}</span>
                          <span className="is-no-buy">已核对未买 {confirmedNoBuyDays}</span>
                          <span className="is-unrecorded">到期未录 {unrecordedDays}</span>
                          <span className="is-upcoming">未到期 {upcomingDays}</span>
                        </div>
                      </div>
                      {row.days.length > 0 ? (
                        <div className={cx('investment-plan-day-grid', plan.cadence === 'WEEKDAY' && 'is-weekday')}>
                          {plan.cadence === 'WEEKDAY' && ['周一', '周二', '周三', '周四', '周五'].map((day) => <span key={day} className="investment-plan-weekday-label">{day}</span>)}
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
                    </div>

                    <footer>
                      <div>{plan.assets.map((item) => <span key={item.id}><b>{item.asset.symbol}</b>{item.asset.name}</span>)}</div>
                      <p>{row.pendingCount > 0 ? `${row.pendingCount} 笔 / ${fmtMoney(row.pendingAmount, row.currency)} 待官方净值确认` : row.nextDate ? `下一计划日 ${fmtDate(row.nextDate)}` : '本计划没有后续节点'}</p>
                    </footer>
                  </article>
                )
              })}
            </div>
          )}
          <p className="investment-plan-boundary">实际投入按“候选资产＋可选账户＋当月有效 BUY”合并。它用于执行核对，不证明每一笔买入都由计划触发；收益仍以组合复盘为准。</p>
        </div>

        {canWrite ? <HashOpenDetails
          id="new-investment-plan"
          className="investment-plan-editor"
          summary={<><span><span className="eyebrow">Start a plan</span><strong>建立定投轨道</strong></span><small>按需展开计划编辑</small></>}
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
