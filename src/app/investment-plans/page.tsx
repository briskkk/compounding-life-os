import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, PageHeader, SetupScreen, Tag } from '@/components/ui'
import { InvestmentPlanForm, EndInvestmentPlanButton } from '@/components/investment-plan-form'
import { buildInvestmentPlanMonth, type InvestmentPlanPace } from '@/lib/engine/investment-plan'
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

function dayPosition(date: Date): string {
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return `${((date.getDate() - 0.5) / days) * 100}%`
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
  const [plans, buys, assets, accounts] = await Promise.all([
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
    db.asset.findMany({
      where: { cls: { in: ['STOCK', 'FUND', 'ETF', 'GOLD'] } },
      orderBy: [{ currency: 'asc' }, { cls: 'asc' }, { symbol: 'asc' }],
    }),
    db.account.findMany({ orderBy: [{ currency: 'asc' }, { createdAt: 'asc' }] }),
  ])

  const report = buildInvestmentPlanMonth(
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
        description="计划层定义节奏和候选资产；实际投入只读取有效 BUY 流水。候选基金之间可以替代执行，但计划不会创建交易或触发下单。"
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

      <section className="investment-plan-workbench">
        <div className="investment-plan-ledger">
          <header>
            <div><span className="eyebrow">Plan rail / ledger rail</span><h2>计划与实际</h2></div>
            <p>上轨是计划节点，下轨是账本中已录入 BUY 的日期；金额进度按同币种直接核对。</p>
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
                      <div><span>完成度</span><b className="num">{fmtPct(row.progress)}</b></div>
                    </div>

                    <div className="investment-plan-rail" aria-label={`${plan.name}计划与实际日期`}>
                      <div className="is-plan"><span>计划</span><div aria-hidden="true">{row.scheduledDates.map((date) => <i key={`p-${date.getTime()}`} style={{ left: dayPosition(date) }} title={fmtDate(date)} />)}</div></div>
                      <div className="is-actual"><span>实际</span><div aria-hidden="true">{row.actualDates.map((date) => <i key={`a-${date.getTime()}`} style={{ left: dayPosition(date) }} title={fmtDate(date)} />)}</div></div>
                      <footer><span>01</span><span>月中</span><span>{new Date(year, month, 0).getDate()}</span></footer>
                    </div>
                    <details className="investment-plan-date-details">
                      <summary>查看计划与实际日期</summary>
                      <div>
                        <section>
                          <h4>计划节点 · {row.scheduledDates.length}</h4>
                          <p>{row.scheduledDates.length ? row.scheduledDates.map(fmtDate).join('、') : '本月无计划节点'}</p>
                        </section>
                        <section>
                          <h4>账本买入 · {row.actualDates.length}</h4>
                          <p>{row.actualDates.length ? row.actualDates.map(fmtDate).join('、') : '本月无有效 BUY 流水'}</p>
                        </section>
                      </div>
                    </details>

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

        <aside id="new-investment-plan" className="investment-plan-editor">
          <header><span className="eyebrow">Start a plan</span><h2>建立定投轨道</h2></header>
          {canWrite ? (
            assets.length > 0 ? (
              <InvestmentPlanForm
                assets={assets.map((asset) => ({ id: asset.id, symbol: asset.symbol, name: asset.name, cls: asset.cls, currency: asset.currency }))}
                accounts={accounts.map((account) => ({ id: account.id, name: account.name, currency: account.currency }))}
              />
            ) : <Empty action={{ href: '/accounts?view=assets', label: '先登记投资资产' }}>暂无可用于定投的资产</Empty>
          ) : (
            <p className="investment-plan-readonly">你当前是只读成员，可以查看计划与实际执行，但不能创建或结束计划。</p>
          )}
        </aside>
      </section>
    </div>
  )
}
