// 账户中心：按托管账户观察资产、收益与资金结算关系
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { loadEngineState, type EngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, PageHeader, Panel, SetupScreen, Stat, Tag, ScopeLabel, ReadOnlyNotice } from '@/components/ui'
import { AccountForm, AssetForm } from '@/components/account-forms'
import { LiabilityEntryForm, LiabilityForm } from '@/components/liability-forms'
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, LIABILITY_TYPE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtMoney, fmtPct, fmtPrice } from '@/lib/format'
import { CLASS_COLORS } from '@/lib/colors'
import { MarketSourceTag, PositionSourceTag } from '@/components/valuation-source'
import { summarizeAccountPositions, type AccountPositionSummary } from '@/lib/engine/account-summary'
import type { ValuedPosition } from '@/lib/engine/valuation'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { buildCashCalendar, type CashCalendarEvent } from '@/lib/engine/cash-calendar'
import { CashPlanForm, DeleteCashPlanButton } from '@/components/cash-plan-form'
import { TableScroll } from '@/components/table-scroll'
import { livePreviousClose } from '@/lib/engine/portfolio-day'
import { investmentPlanMatchesBuy, type InvestmentPlanInput } from '@/lib/engine/investment-plan'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { HashOpenDetails } from '@/components/hash-open-details'
import { AssetDomainNav } from '@/components/asset-domain-nav'
import { RecordDomainNav } from '@/components/record-domain-nav'

export const dynamic = 'force-dynamic'

/** 资金计划的方向与重复节奏：只影响计划本身的展示，不参与账本口径。 */
const CASH_PLAN_DIRECTION_LABEL: Record<string, string> = {
  INFLOW: '计划流入',
  OUTFLOW: '计划流出',
  MILESTONE: '仅提醒',
}

const CASH_PLAN_RECURRENCE_LABEL: Record<string, string> = {
  NONE: '不重复',
  MONTHLY: '每月',
  YEARLY: '每年',
}

type AccountView = 'overview' | 'assets' | 'liabilities' | 'calendar'

function parseView(value: string | undefined): AccountView {
  return value === 'assets' || value === 'liabilities' || value === 'calendar' ? value : 'overview'
}

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

function selectedDayKey(value: string | undefined, month: string, events: CashCalendarEvent[]): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value.startsWith(`${month}-`)) {
    const candidate = new Date(`${value}T12:00:00`)
    if (!Number.isNaN(candidate.getTime()) && dateKeyAt(candidate) === value) return value
  }
  const today = dateKeyAt(new Date())
  if (today.startsWith(`${month}-`)) return today
  return events[0] ? dateKeyAt(events[0].date) : `${month}-01`
}

function dayEventGroups(events: CashCalendarEvent[]): Array<{
  key: string
  label: string
  count: number
  amountCny: number
  tone: 'buy' | 'sell' | 'redeem'
}> {
  const groups = [
    { key: 'buy', label: '买入', matches: (event: CashCalendarEvent) => event.source === 'TRADE' && event.direction === 'OUTFLOW', tone: 'buy' as const },
    { key: 'sell', label: '卖出', matches: (event: CashCalendarEvent) => event.source === 'TRADE' && event.direction === 'INFLOW', tone: 'sell' as const },
    { key: 'redeem', label: '赎回到账', matches: (event: CashCalendarEvent) => event.source === 'SETTLEMENT', tone: 'redeem' as const },
  ]
  return groups.flatMap((group) => {
    const matching = events.filter(group.matches)
    return matching.length === 0 ? [] : [{
      key: group.key,
      label: group.label,
      count: matching.length,
      amountCny: matching.reduce((sum, event) => sum + event.amountCny, 0),
      tone: group.tone,
    }]
  })
}

function calendarEventMeta(event: CashCalendarEvent): { label: string; href: string | null } {
  if (event.source === 'TRADE') {
    return {
      label: `${event.direction === 'OUTFLOW' ? '实际买入' : '实际卖出'}${event.pending ? ' · 份额待确认' : ''}`,
      href: null,
    }
  }
  return { label: '赎回待到账', href: '/transactions?type=SELL' }
}

function CalendarEventRow({
  event,
  activeDay,
}: {
  event: CashCalendarEvent
  activeDay: string
}) {
  const meta = calendarEventMeta(event)
  const href = event.source === 'TRADE'
    ? `/transactions?date=${activeDay}&type=${event.direction === 'OUTFLOW' ? 'BUY' : 'SELL'}`
    : meta.href
  const className = event.source === 'TRADE'
    ? `is-trade is-${event.direction === 'OUTFLOW' ? 'buy' : 'sell'}`
    : 'is-settlement'

  return (
    <div className={className}>
      <span aria-hidden="true"><i /></span>
      <div>
        {href ? <Link href={href}><strong>{event.title}</strong></Link> : <strong>{event.title}</strong>}
        <small>{meta.label}{event.accountName ? ` · ${event.accountName}` : ''}</small>
        {event.relatedPlanName && <small className="is-relation">对应 {event.relatedPlanName}</small>}
      </div>
      <b className="num">
        {`${event.direction === 'OUTFLOW' ? '−' : '+'}${fmtMoney(event.amount, event.currency)}`}
      </b>
    </div>
  )
}

function originalValue(
  currency: string,
  summary: AccountPositionSummary,
  positions: ValuedPosition[],
  state: EngineState,
): number | null {
  if (currency === 'CNY') return summary.valueCny
  for (const position of positions) {
    const quote = state.quotes.get(position.asset.symbol)
    if (quote && quote.price > 0) return summary.valueCny / (quote.priceCny / quote.price)
    if (position.asset.cls === 'CASH' && position.price && position.price > 0) return summary.valueCny / position.price
    if (position.costBasis > 0 && position.costCny > 0) return summary.valueCny / (position.costCny / position.costBasis)
  }
  return null
}

function DeltaAmount({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-faint">—</span>
  return (
    <span className={cx('num', value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-ink-dim')}>
      {fmtCNY(value, { sign: true })}
    </span>
  )
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; day?: string }>
}) {
  const sp = await searchParams
  const activeView = parseView(sp.view)
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)
  const selectedMonth = monthKey(sp.month)
  const calendarWindow = monthWindow(selectedMonth)
  const [state, accounts, assets, cashPlans, investmentPlans] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
    db.asset.findMany({ orderBy: { createdAt: 'asc' } }),
    db.cashPlan.findMany({ include: { account: true }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
    db.investmentPlan.findMany({
      include: { account: true, assets: { include: { asset: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
  ])

  const now = new Date()
  const positionsByAccount = new Map<string, ValuedPosition[]>()

  const valueByAsset = new Map<string, number>()
  const positionByAsset = new Map<string, ValuedPosition>()
  for (const position of state.valued) {
    valueByAsset.set(position.assetId, (valueByAsset.get(position.assetId) ?? 0) + position.value)
    if (!positionByAsset.has(position.assetId)) positionByAsset.set(position.assetId, position)
    if (isPortfolioAssetClass(position.asset.cls)) {
      const accountPositions = positionsByAccount.get(position.accountId) ?? []
      accountPositions.push(position)
      positionsByAccount.set(position.accountId, accountPositions)
    }
  }

  const summaryByAccount = new Map(accounts.map((account) => {
    const positions = positionsByAccount.get(account.id) ?? []
    return [account.id, summarizeAccountPositions(positions, (symbol) => {
      const quote = state.quotes.get(symbol)
      const asset = state.assets.find((item) => item.symbol === symbol)
      // 归属口径统一按北京日（与总览/看盘/日历同源，ADR-027）：美股美东 D 日计入北京 D+1
      return livePreviousClose({
        asset: { symbol, currency: asset?.currency, cls: asset?.cls },
        exchangeTradingDate: quote?.tradingDate,
        prevClose: quote?.prevCloseCny,
        now,
      })
    })]
  }))
  const cashAccountIds = new Set(
    state.valued.filter((position) => position.asset.cls === 'CASH' && Math.abs(position.value) > 1e-9).map((position) => position.accountId),
  )
  const settlementTargetIds = new Set(accounts.flatMap((account) => account.settlementAccountId ? [account.settlementAccountId] : []))
  const fundingAccountIds = new Set(accounts.filter((account) => (
    account.type === 'BANK'
    || cashAccountIds.has(account.id)
    || settlementTargetIds.has(account.id)
  )).map((account) => account.id))
  const totalAssets = [...summaryByAccount.values()].reduce((sum, summary) => sum + summary.valueCny, 0)
  const totalCash = [...summaryByAccount.values()].reduce((sum, summary) => sum + summary.cashCny, 0)
  const dayPnlValues = [...summaryByAccount.values()].map((summary) => summary.dayPnlCny).filter((value): value is number => value != null)
  const totalDayPnl = dayPnlValues.reduce((sum, value) => sum + value, 0)
  const unsettledAccounts = accounts.filter((account) => (
    (account.type === 'BROKERAGE' || account.type === 'FUND') && !account.settlementAccountId
  ))
  const latestActivityByAccount = new Map<string, Date>()
  for (const tx of state.ledgerTxs) {
    if (!isPortfolioAssetClass(tx.assetClass)) continue
    const current = latestActivityByAccount.get(tx.accountId)
    if (!current || tx.occurredAt > current) latestActivityByAccount.set(tx.accountId, tx.occurredAt)
  }
  const assetNameById = new Map(state.assets.map((asset) => [asset.id, asset.name]))
  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]))
  const investmentPlanInputs: InvestmentPlanInput[] = investmentPlans.map((plan) => ({
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
  const rateFor = (currency: string) => state.currencyRates[currency as keyof typeof state.currencyRates] ?? 1
  // 只把账本真实发生的事放进日历：赎回到账在途 + 实际买入/卖出。
  // 定投计划节点与手工资金计划都不占格（计划不是流水，见引擎注释）。
  const cashCalendar = buildCashCalendar(
    selectedMonth,
    state.pendingSettlements.map((settlement) => ({
      id: settlement.sellTxId ?? `${settlement.accountId}:${settlement.settlementDate.toISOString()}`,
      title: `${settlement.sellAssetId ? assetNameById.get(settlement.sellAssetId) ?? '基金' : '基金'}赎回到账`,
      amountCny: settlement.amount * (state.currencyRates[settlement.currency as keyof typeof state.currencyRates] ?? 1),
      dueDate: settlement.settlementDate,
    })),
    state.ledgerTxs.filter((tx) => (
      (tx.type === 'BUY' || tx.type === 'SELL')
      && !tx.voidedAt
      && !tx.internal
      && isPortfolioAssetClass(tx.assetClass)
      && tx.occurredAt >= calendarWindow.start
      && tx.occurredAt <= calendarWindow.end
    )).map((tx) => {
      const relatedPlan = tx.type === 'BUY'
        ? investmentPlanInputs.find((plan) => investmentPlanMatchesBuy(plan, {
          id: tx.id ?? '',
          accountId: tx.accountId,
          assetId: tx.assetId,
          amount: tx.amount,
          occurredAt: tx.occurredAt,
          navSource: tx.navSource ?? null,
        }))
        : null
      return {
        id: tx.id ?? `${tx.accountId}:${tx.assetId}:${tx.occurredAt.toISOString()}`,
        title: assetNameById.get(tx.assetId) ?? '未命名资产',
        type: tx.type as 'BUY' | 'SELL',
        amount: tx.amount,
        amountCny: tx.amount * rateFor(tx.currency ?? 'CNY'),
        currency: tx.currency ?? 'CNY',
        occurredAt: tx.occurredAt,
        accountName: accountNameById.get(tx.accountId) ?? '未命名账户',
        relatedPlanName: relatedPlan?.name ?? null,
        pending: tx.navSource === 'PENDING',
      }
    }),
  )
  const [calendarYear, calendarMonth] = selectedMonth.split('-').map(Number)
  const calendarDays = new Date(calendarYear, calendarMonth, 0).getDate()
  const calendarOffset = (new Date(calendarYear, calendarMonth - 1, 1).getDay() + 6) % 7
  const eventsByDay = new Map<number, typeof cashCalendar.events>()
  for (const event of cashCalendar.events) {
    const day = event.date.getDate()
    const list = eventsByDay.get(day) ?? []
    list.push(event)
    eventsByDay.set(day, list)
  }
  const activeDay = selectedDayKey(sp.day, selectedMonth, cashCalendar.events)
  const selectedDayEvents = cashCalendar.events.filter((event) => dateKeyAt(event.date) === activeDay)
  const selectedTrades = selectedDayEvents.filter((event) => event.source === 'TRADE')
  const selectedSettlements = selectedDayEvents.filter((event) => event.source === 'SETTLEMENT')

  const tabs: { view: AccountView; label: string; count: number }[] = [
    { view: 'overview', label: '账户概览', count: accounts.length },
    { view: 'assets', label: '资产目录', count: assets.length },
    { view: 'liabilities', label: '负债管理', count: state.liabilities.length },
    { view: 'calendar', label: '资金日历', count: cashCalendar.events.length },
  ]
  const headerDescription: Record<AccountView, string> = {
    overview: '查看各账户的资产、现金和结算关系。',
    assets: '维护资产目录与估值方式，实际归属仍由交易流水决定。',
    liabilities: '查看由负债条目推导的余额，并记录放款、还款或调整。',
    calendar: '按日查看账本里实际发生的买入、卖出与赎回到账。',
  }
  const headerAction: Record<AccountView, { href: string; label: string }> = {
    overview: { href: '#new-cash-plan', label: '添加计划' },
    assets: { href: '#new-asset', label: '登记资产' },
    liabilities: { href: '#new-liability', label: '登记负债' },
    calendar: { href: '/transactions#new-entry', label: '录入流水' },
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="账户中心"
        description={headerDescription[activeView]}
        right={(
          <div className="flex flex-wrap items-end gap-5">
            <div><div className="text-[14px] text-ink-faint"><ScopeLabel scope="PORTFOLIO_ASSETS" /></div><div className="num mt-2 whitespace-nowrap text-[34px] text-ink">{fmtCNY(totalAssets)}</div></div>
            <Link href="/investment-plans" className="inline-flex min-h-11 shrink-0 items-center text-[14px] whitespace-nowrap text-accent">定投管理 →</Link>
            {canWrite && (
              <Link href={headerAction[activeView].href} className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-accent px-5 text-[14px] font-medium whitespace-nowrap text-bg">
                ＋ {headerAction[activeView].label}
              </Link>
            )}
          </div>
        )}
      />

      {activeView === 'calendar'
        ? <RecordDomainNav active="calendar" />
        : <AssetDomainNav active="accounts" />}

      {!canWrite && <ReadOnlyNotice what="可以查看账户、资产与负债，但不能新建或修改" />}

      <nav className="account-view-nav" aria-label="账户中心视图">
        {tabs.map((tab) => (
          <Link
            key={tab.view}
            href={tab.view === 'overview' ? '/accounts' : `/accounts?view=${tab.view}`}
            className={cx(
              'flex items-center gap-2 border-b-2 px-0.5 py-3 text-[15px] transition-colors',
              activeView === tab.view
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-dim hover:text-ink',
            )}
          >
            <span>{tab.label}</span>
            <span className="num text-[12px] opacity-60">{tab.count}</span>
          </Link>
        ))}
      </nav>

      {activeView === 'overview' && (
        <>
          <div className="metric-band">
            <Stat
              label="今日盈亏"
              value={<span data-testid="accounts-today-pnl" data-amount={totalDayPnl.toFixed(2)}><DeltaAmount value={totalDayPnl} /></span>}
              hint="仅汇总交易日属于北京时间今日的行情资产"
            />
            <Stat label="现金余额" value={<span className="text-accent">{fmtCNY(totalCash)}</span>} sub={<span className="text-ink-dim">占资产 {fmtPct(totalAssets > 0 ? totalCash / totalAssets : null)}</span>} />
            <Stat
              label="账户结构"
              value={<span className="text-info">{accounts.length}</span>}
              sub={<span className="text-ink-dim">{fundingAccountIds.size} 个资金/综合账户</span>}
              hint={unsettledAccounts.length > 0 ? `${unsettledAccounts.length} 个投资账户未配置结算` : '资金结算关系完整'}
            />
          </div>

          <div className="space-y-3">
            <Panel
              title="账户资产分布"
              bodyClassName="p-0"
              right={<span className="text-[12px] text-ink-faint">点击账户查看明细</span>}
            >
              {accounts.length === 0 ? (
                <Empty action={{ href: '#new-account', label: '新建账户' }}>暂无账户</Empty>
              ) : (
                <TableScroll label="账户持仓汇总表">
                  <table className="w-full text-[14px] whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                        <th className="px-4 py-2.5 font-normal">账户</th>
                        <th className="px-2 py-2.5 font-normal">角色</th>
                        <th className="px-2 py-2.5 text-right font-normal">持仓</th>
                        <th className="px-2 py-2.5 text-right font-normal">资产市值</th>
                        <th className="px-2 py-2.5 text-right font-normal">今日盈亏</th>
                        <th className="px-2 py-2.5 text-right font-normal">现金</th>
                        <th className="px-4 py-2.5 font-normal">资金结算</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {[...accounts].sort((a, b) => (summaryByAccount.get(b.id)?.valueCny ?? 0) - (summaryByAccount.get(a.id)?.valueCny ?? 0)).map((account) => {
                        const positions = positionsByAccount.get(account.id) ?? []
                        const summary = summaryByAccount.get(account.id)!
                        const hasCash = summary.cashCny > 1e-9
                        const hasInvestments = positions.some((position) => position.asset.cls !== 'CASH' && Math.abs(position.value) > 1e-9)
                        const role = hasCash && hasInvestments ? '综合账户' : fundingAccountIds.has(account.id) ? '资金账户' : '投资账户'
                        const original = originalValue(account.currency, summary, positions, state)
                        return (
                          <tr key={account.id} className="transition-colors hover:bg-panel2/50">
                            <td className="px-4 py-3">
                              <Link href={`/accounts/${account.id}`} className="font-medium text-ink hover:text-accent">{account.name}</Link>
                              <div className="mt-0.5 text-[12px] text-ink-faint">
                                {account.institution ?? '未登记机构'} · {account.currency}
                                {latestActivityByAccount.get(account.id) && ` · 更新于 ${fmtDate(latestActivityByAccount.get(account.id)!)}`}
                              </div>
                            </td>
                            <td className="px-2 py-3">
                              <Tag tone={role === '投资账户' ? 'info' : role === '综合账户' ? 'accent' : 'dim'}>{role}</Tag>
                              <div className="mt-1 text-[12px] text-ink-faint">{ACCOUNT_TYPE_LABEL[account.type]}</div>
                            </td>
                            <td className="num px-2 py-3 text-right text-ink-dim">{summary.holdingCount} 项</td>
                            <td className="num px-2 py-3 text-right text-ink">
                              {fmtCNY(summary.valueCny)}
                              {account.currency !== 'CNY' && original != null && (
                                <div className="text-[12px] text-ink-faint">≈ {fmtMoney(original, account.currency)}</div>
                              )}
                            </td>
                            <td className="px-2 py-3 text-right"><DeltaAmount value={summary.dayPnlCny} /></td>
                            <td className="num px-2 py-3 text-right text-ink-dim">{summary.cashCny > 0 ? fmtCNY(summary.cashCny) : '—'}</td>
                            <td className="px-4 py-3 text-ink-dim">
                              {account.settlementAccount ? (
                                <span>{account.name} <span className="text-ink-faint">→</span> {account.settlementAccount.name}</span>
                              ) : fundingAccountIds.has(account.id) ? (
                                <span className="text-ink-faint">独立持有资金</span>
                              ) : (
                                <span className="text-amber">未配置</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Panel>

            <Panel title="资金计划" bodyClassName="p-0">
              {cashPlans.length === 0 ? (
                <Empty action={{ href: '#new-cash-plan', label: '添加计划' }}>暂无资金计划</Empty>
              ) : (
                <div className="divide-y divide-line/60">
                  {cashPlans.map((plan) => (
                    <div key={plan.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm text-ink">{plan.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-faint">
                          <Tag tone={plan.direction === 'INFLOW' ? 'accent' : plan.direction === 'OUTFLOW' ? 'dim' : 'info'}>
                            {CASH_PLAN_DIRECTION_LABEL[plan.direction]}
                          </Tag>
                          <span className="num">{fmtDate(plan.dueDate)}</span>
                          <span>{CASH_PLAN_RECURRENCE_LABEL[plan.recurrence]}</span>
                          {plan.account && <span>· {plan.account.name}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {plan.direction !== 'MILESTONE' && <span className="num text-ink">{fmtCNY(Number(plan.amountCny))}</span>}
                        {canWrite && <DeleteCashPlanButton id={plan.id} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {canWrite && (
              <HashOpenDetails
                id="new-cash-plan"
                className="ledger-entry-workspace"
                summary={<><span>添加资金计划</span><small>保险、奖金、缴费或提醒</small></>}
              >
                <div className="action-workspace-body">
                  <CashPlanForm accounts={accounts.map((account) => ({ id: account.id, name: account.name }))} />
                </div>
              </HashOpenDetails>
            )}

            <div className={cx('grid grid-cols-1 items-start gap-3', canWrite && 'xl:grid-cols-2')}>
              <Panel title="资金结算关系">
                <div className="space-y-2.5">
                  {accounts.filter((account) => account.type === 'BROKERAGE' || account.type === 'FUND').map((account) => (
                    <Link key={account.id} href={`/accounts/${account.id}`} className="flex items-center justify-between gap-3 rounded border border-line bg-panel2 px-3 py-2 transition-colors hover:border-ink-faint">
                      <span className="truncate text-xs text-ink-dim">{account.name}</span>
                      <span className={cx('shrink-0 text-[12px]', account.settlementAccount ? 'text-ink-faint' : 'text-amber')}>
                        {account.settlementAccount?.name ?? '待配置'} →
                      </span>
                    </Link>
                  ))}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">关联现金是共享引用，只计入资金账户，不在各投资账户重复形成余额。</p>
              </Panel>

              {canWrite && (
                <Panel title="新建账户" className="scroll-mt-6" >
                  <div id="new-account" />
                  <AccountForm />
                  <p className="mt-4 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-faint">创建后进入账户详情配置同币种资金结算账户。</p>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}

      {activeView === 'assets' && (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
          <Panel title="资产目录" className="xl:col-span-2" bodyClassName="p-0" right={<span className="num text-[12px] text-ink-faint">{assets.length} 项</span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                    <th className="px-4 py-2.5 font-normal">代码</th>
                    <th className="px-2 py-2.5 font-normal">名称</th>
                    <th className="px-2 py-2.5 font-normal">类别</th>
                    <th className="px-2 py-2.5 text-right font-normal">现价</th>
                    <th className="px-2 py-2.5 text-right font-normal">持有市值</th>
                    <th className="px-4 py-2.5 text-right font-normal">估值方式</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {assets.map((asset) => {
                    const quote = state.quotes.get(asset.symbol)
                    const position = positionByAsset.get(asset.id)
                    return (
                      <tr key={asset.id} className="transition-colors hover:bg-panel2/50">
                        <td className="num px-4 py-2.5 text-ink-dim">{asset.symbol}</td>
                        <td className="px-2 py-2.5">
                          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: CLASS_COLORS[asset.cls] }} />
                          <Link href={`/positions/${asset.id}`} className="text-ink hover:text-accent">{asset.name}</Link>
                          {asset.cls === 'HUAWEI_STOCK' && (
                            <div className="ml-3.5 mt-0.5 text-[12px] text-amber">长期资产 · 不进入持仓、流水和收益率</div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-ink-dim">{ASSET_CLASS_LABEL[asset.cls]}</td>
                        <td className="num px-2 py-2.5 text-right text-ink-dim">{quote ? fmtPrice(quote.price) : position?.price != null ? fmtPrice(position.price) : '—'}</td>
                        <td className="num px-2 py-2.5 text-right text-ink">{fmtCNY(valueByAsset.get(asset.id) ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {position ? (
                            <PositionSourceTag priceSource={position.priceSource} marketSource={quote?.source} showProvider />
                          ) : asset.manual || asset.cls === 'REAL_ESTATE' ? (
                            <PositionSourceTag priceSource="MANUAL" />
                          ) : asset.cls === 'CASH' ? (
                            <PositionSourceTag priceSource="FACE" />
                          ) : (
                            <MarketSourceTag source={quote?.source} showProvider />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          {canWrite && (
            <Panel title="登记资产" className="scroll-mt-6">
              <div id="new-asset" />
              <AssetForm />
              <p className="mt-4 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-faint">资产是全局标的目录；实际归属账户由交易流水决定。</p>
            </Panel>
          )}
        </div>
      )}

      {activeView === 'liabilities' && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <Stat label="负债余额" value={<span className="text-up">−{fmtCNY(state.liabilitiesTotal)}</span>} hint="从家庭净资产中扣减" />
            <Stat label="负债项目" value={<span className="text-ink">{state.liabilities.length}</span>} hint="余额同样由负债条目推导" />
          </div>
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
            <Panel title="负债列表" className="xl:col-span-2" bodyClassName="p-0">
              {state.liabilities.length === 0 ? (
                <Empty action={{ href: '#new-liability', label: '登记负债' }}>暂无负债项目</Empty>
              ) : (
                <div className="divide-y divide-line/60">
                  {state.liabilities.map((liability) => (
                    <div key={liability.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div>
                        <div className="text-sm text-ink">{liability.name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Tag tone="amber">{LIABILITY_TYPE_LABEL[liability.type]}</Tag>
                          <span className="text-[12px] text-ink-faint">{liability.rate != null ? `年利率 ${(liability.rate * 100).toFixed(2)}%` : '利率未登记'}</span>
                        </div>
                      </div>
                      <div className="num text-lg text-up">−{fmtCNY(liability.balance)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            {canWrite && (
              <div className="space-y-3">
                <Panel title="登记负债" className="scroll-mt-6">
                  <div id="new-liability" />
                  <LiabilityForm />
                </Panel>
                <Panel title="放款 / 还款 / 调整">
                  <LiabilityEntryForm liabilities={state.liabilities.map((liability) => ({ id: liability.id, name: liability.name }))} />
                </Panel>
              </div>
            )}
          </div>
        </>
      )}

      {activeView === 'calendar' && (
        <div className="cash-calendar-page">
          <div className="cash-calendar-evidence" aria-label="日历口径说明">
            <span><i className="is-ledger" />实际买入 / 卖出</span>
            <span><i className="is-settlement" />赎回到账在途</span>
          </div>
          <section className="cash-calendar-summary">
            <div><span>当前现金</span><strong className="num">{fmtCNY(totalCash)}</strong><small>当前账本余额</small></div>
            <div className="is-buy"><span>实际买入</span><strong className="num">{fmtCNY(cashCalendar.actualBuy)}</strong><small>{cashCalendar.buyCount} 笔{cashCalendar.linkedBuyCount > 0 ? ` · ${cashCalendar.linkedBuyCount} 笔对应定投` : ''}</small></div>
            <div className="is-sell"><span>实际卖出</span><strong className="num">{fmtCNY(cashCalendar.actualSell)}</strong><small>{cashCalendar.sellCount} 笔</small></div>
            <div className="is-settlement"><span>赎回到账在途</span><strong className="num">{fmtCNY(cashCalendar.settlementInflow)}</strong><small>{cashCalendar.settlementCount} 笔待确认</small></div>
          </section>

          <section className="cash-calendar-layout">
            <div className="cash-calendar-board">
              <header>
                <div><h2>{calendarYear} 年 {calendarMonth} 月</h2></div>
                <nav aria-label="资金日历月份">
                  <Link href={`/accounts?view=calendar&month=${shiftMonth(selectedMonth, -1)}`}>← 上月</Link>
                  <Link href="/accounts?view=calendar">本月</Link>
                  <Link href={`/accounts?view=calendar&month=${shiftMonth(selectedMonth, 1)}`}>下月 →</Link>
                </nav>
              </header>
              <div className="cash-calendar-weekdays">
                {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="cash-calendar-grid">
                {Array.from({ length: calendarOffset }, (_, index) => <div key={`blank-${index}`} className="is-blank" />)}
                {Array.from({ length: calendarDays }, (_, index) => {
                  const day = index + 1
                  const events = eventsByDay.get(day) ?? []
                  const groups = dayEventGroups(events)
                  const dayKey = `${selectedMonth}-${String(day).padStart(2, '0')}`
                  const isToday = selectedMonth === monthKey() && day === new Date().getDate()
                  return (
                    <Link
                      key={day}
                      href={`/accounts?view=calendar&month=${selectedMonth}&day=${dayKey}`}
                      aria-current={activeDay === dayKey ? 'date' : undefined}
                      className={cx('cash-calendar-day', isToday && 'is-today', activeDay === dayKey && 'is-selected', events.length > 0 && 'has-events')}
                    >
                      <span className="num">{day}</span>
                      <div>
                        {groups.map((group) => (
                          <article key={group.key} className={`is-${group.tone}`}>
                            <div><i /><strong>{group.label}</strong><small>{group.count}</small></div>
                            {group.amountCny > 0 && <b className="num">{fmtCNY(group.amountCny)}</b>}
                          </article>
                        ))}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>

            <aside className="cash-calendar-sidebar">
              <Panel
                title={`${Number(activeDay.slice(5, 7))} 月 ${Number(activeDay.slice(8, 10))} 日明细`}
                className="cash-calendar-inspector"
                bodyClassName="cash-calendar-inspector-body"
                right={<span className="num text-[12px] text-ink-faint">{selectedDayEvents.length} 项</span>}
              >
                {selectedDayEvents.length === 0 ? <Empty>当天没有账本买卖流水</Empty> : (
                  <div className="cash-calendar-inspector-scroll">
                    <nav className="cash-calendar-inspector-actions" aria-label="当日操作">
                      <Link href={`/transactions?date=${activeDay}`}>查看当日流水</Link>
                    </nav>
                    {selectedTrades.length > 0 && (
                      <section className="cash-calendar-agenda-group">
                        <h3>实际买卖 <span>{selectedTrades.length}</span></h3>
                        <div className="cash-calendar-agenda">
                          {selectedTrades.map((event) => <CalendarEventRow key={event.id} event={event} activeDay={activeDay} />)}
                        </div>
                      </section>
                    )}
                    {selectedSettlements.length > 0 && (
                      <section className="cash-calendar-agenda-group">
                        <h3>赎回到账 <span>{selectedSettlements.length}</span></h3>
                        <div className="cash-calendar-agenda">
                          {selectedSettlements.map((event) => <CalendarEventRow key={event.id} event={event} activeDay={activeDay} />)}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </Panel>
              <p className="cash-calendar-disclaimer">只呈现账本实际发生过的买卖与赎回到账；定投计划与手工资金计划不占日历格。</p>
            </aside>
          </section>
        </div>
      )}
    </div>
  )
}
