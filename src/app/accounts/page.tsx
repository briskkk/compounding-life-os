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
import { dateKeyAt, previousCloseOnPortfolioDay } from '@/lib/engine/watch-market'
import { buildCashCalendar } from '@/lib/engine/cash-calendar'
import { CashPlanForm, DeleteCashPlanButton } from '@/components/cash-plan-form'
import { TableScroll } from '@/components/table-scroll'
import { portfolioDayKey } from '@/lib/engine/portfolio-day'

export const dynamic = 'force-dynamic'

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
  searchParams: Promise<{ view?: string; month?: string }>
}) {
  const sp = await searchParams
  const activeView = parseView(sp.view)
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)
  const selectedMonth = monthKey(sp.month)
  const [state, accounts, assets, cashPlans] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
    db.asset.findMany({ orderBy: { createdAt: 'asc' } }),
    db.cashPlan.findMany({ include: { account: true }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
  ])

  const now = new Date()
  const positionsByAccount = new Map<string, ValuedPosition[]>()
  const todayKey = dateKeyAt(now)
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
      // 海外持仓按各自市场的「今天」判定（与总览/看盘同源）
      const asset = state.assets.find((item) => item.symbol === symbol)
      return previousCloseOnPortfolioDay(quote?.prevCloseCny, quote?.tradingDate, portfolioDayKey({ symbol, currency: asset?.currency, cls: asset?.cls }, now))
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
  const cashCalendar = buildCashCalendar(
    selectedMonth,
    cashPlans.map((plan) => ({
      id: plan.id,
      title: plan.title,
      direction: plan.direction,
      amountCny: Number(plan.amountCny),
      dueDate: plan.dueDate,
      recurrence: plan.recurrence,
      endDate: plan.endDate,
      accountName: plan.account?.name ?? null,
      note: plan.note,
    })),
    state.pendingSettlements.map((settlement) => ({
      id: settlement.sellTxId ?? `${settlement.accountId}:${settlement.settlementDate.toISOString()}`,
      title: `${settlement.sellAssetId ? assetNameById.get(settlement.sellAssetId) ?? '基金' : '基金'}赎回到账`,
      amountCny: settlement.amount * (state.currencyRates[settlement.currency as keyof typeof state.currencyRates] ?? 1),
      dueDate: settlement.settlementDate,
    })),
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

  const tabs: { view: AccountView; label: string; en: string; count: number }[] = [
    { view: 'overview', label: '账户概览', en: 'OVERVIEW', count: accounts.length },
    { view: 'assets', label: '资产目录', en: 'ASSETS', count: assets.length },
    { view: 'liabilities', label: '负债管理', en: 'LIABILITIES', count: state.liabilities.length },
    { view: 'calendar', label: '资金日历', en: 'CASH CALENDAR', count: cashCalendar.events.length },
  ]

  return (
    <div className="page-shell">
      <PageHeader
        kicker="Custody & cash routing"
        title="账户中心"
        description={activeView === 'calendar'
          ? '把账本派生的在途到账与未来现金计划放在同一时间轴；计划事项不会提前改变真实余额。'
          : '跨账户汇总可投资组合；华为股票在资产目录中作为长期资产独立维护。'}
        right={(
          <div className="flex flex-wrap items-end gap-5">
            <div><div className="text-[14px] text-ink-faint"><ScopeLabel scope="PORTFOLIO_ASSETS" /></div><div className="num mt-2 whitespace-nowrap text-[34px] text-ink">{fmtCNY(totalAssets)}</div></div>
            <Link href="/investment-plans" className="inline-flex min-h-11 shrink-0 items-center text-[14px] whitespace-nowrap text-accent">定投管理 →</Link>
            {canWrite && (
              <a href={activeView === 'calendar' ? '#new-cash-plan' : '#new-account'} className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-accent px-5 text-[14px] font-medium whitespace-nowrap text-bg">
                ＋ {activeView === 'calendar' ? '添加计划' : '新建账户'}
              </a>
            )}
          </div>
        )}
      />

      {!canWrite && <ReadOnlyNotice what="可以查看账户、资产与负债，但不能新建或修改" />}

      <nav className="flex flex-wrap gap-8 border-b border-line" aria-label="账户中心视图">
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
              en="DAY P&L"
              value={<span data-testid="accounts-today-pnl" data-amount={totalDayPnl.toFixed(2)}><DeltaAmount value={totalDayPnl} /></span>}
              hint="仅汇总交易日属于北京时间今日的行情资产"
            />
            <Stat label="现金余额" en="CASH" value={<span className="text-accent">{fmtCNY(totalCash)}</span>} sub={<span className="text-ink-dim">占资产 {fmtPct(totalAssets > 0 ? totalCash / totalAssets : null)}</span>} />
            <Stat
              label="账户结构"
              en="STRUCTURE"
              value={<span className="text-info">{accounts.length}</span>}
              sub={<span className="text-ink-dim">{fundingAccountIds.size} 个资金/综合账户</span>}
              hint={unsettledAccounts.length > 0 ? `${unsettledAccounts.length} 个投资账户未配置结算` : '资金结算关系完整'}
            />
          </div>

          <div className="space-y-3">
            <Panel
              title="账户资产分布"
              en="ACCOUNT HOLDINGS"
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

            <div className={cx('grid grid-cols-1 items-start gap-3', canWrite && 'xl:grid-cols-2')}>
              <Panel title="资金结算关系" en="CASH ROUTING">
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
                <Panel title="新建账户" en="ADD ACCOUNT" className="scroll-mt-6" >
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
          <Panel title="资产目录" en="ASSET UNIVERSE" className="xl:col-span-2" bodyClassName="p-0" right={<span className="num text-[12px] text-ink-faint">{assets.length} 项</span>}>
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
            <Panel title="登记资产" en="ADD ASSET" className="scroll-mt-6">
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
            <Stat label="负债余额" en="LIABILITIES" value={<span className="text-up">−{fmtCNY(state.liabilitiesTotal)}</span>} hint="从家庭净资产中扣减" />
            <Stat label="负债项目" en="ITEMS" value={<span className="text-ink">{state.liabilities.length}</span>} hint="余额同样由负债条目推导" />
          </div>
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
            <Panel title="负债列表" en="LIABILITY BOOK" className="xl:col-span-2" bodyClassName="p-0">
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
                <Panel title="登记负债" en="ADD LIABILITY" className="scroll-mt-6">
                  <div id="new-liability" />
                  <LiabilityForm />
                </Panel>
                <Panel title="放款 / 还款 / 调整" en="LIABILITY ENTRY">
                  <LiabilityEntryForm liabilities={state.liabilities.map((liability) => ({ id: liability.id, name: liability.name }))} />
                </Panel>
              </div>
            )}
          </div>
        </>
      )}

      {activeView === 'calendar' && (
        <div className="cash-calendar-page">
          <section className="cash-calendar-summary">
            <div><span>当前现金</span><strong className="num">{fmtCNY(totalCash)}</strong><small>来自交易账本</small></div>
            <i>+</i>
            <div><span>本月计划流入</span><strong className="num text-up">{fmtCNY(cashCalendar.inflow)}</strong><small>其中在途确认 {fmtCNY(cashCalendar.confirmedInflow)}</small></div>
            <i>−</i>
            <div><span>本月计划流出</span><strong className="num text-ink-dim">{fmtCNY(cashCalendar.outflow)}</strong><small>仅计划，不扣减余额</small></div>
            <i>=</i>
            <div className="is-result"><span>月末计划后现金</span><strong className="num">{fmtCNY(totalCash + cashCalendar.net)}</strong><small>不含期间市场波动</small></div>
          </section>

          <section className="cash-calendar-layout">
            <div className="cash-calendar-board">
              <header>
                <div><span className="eyebrow">Cash timeline</span><h2>{calendarYear} 年 {calendarMonth} 月</h2></div>
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
                  const isToday = selectedMonth === monthKey() && day === new Date().getDate()
                  return (
                    <div key={day} className={cx('cash-calendar-day', isToday && 'is-today', events.length > 0 && 'has-events')}>
                      <span className="num">{day}</span>
                      <div>
                        {events.map((event) => (
                          <article key={event.id} className={`is-${event.direction.toLowerCase()}`} title={event.note ?? undefined}>
                            <div><i /><strong>{event.title}</strong></div>
                            {event.direction !== 'MILESTONE' && <b className="num">{event.direction === 'OUTFLOW' ? '−' : '+'}{fmtCNY(event.amountCny)}</b>}
                            <small>{event.source === 'SETTLEMENT' ? '在途确认' : event.accountName ?? (event.recurrence === 'NONE' ? '一次计划' : event.recurrence === 'MONTHLY' ? '每月计划' : '每年计划')}</small>
                          </article>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <aside className="cash-calendar-sidebar">
              {canWrite && (
                <Panel title="添加计划事项" en="ADD PLAN" className="scroll-mt-6">
                  <div id="new-cash-plan" />
                  <CashPlanForm accounts={accounts.map((account) => ({ id: account.id, name: account.name }))} />
                </Panel>
              )}
              <Panel title="本月事项" en="MONTH EVENTS" bodyClassName="p-0">
                {cashCalendar.events.length === 0 ? <Empty>本月暂无资金安排</Empty> : (
                  <div className="cash-calendar-agenda">
                    {cashCalendar.events.map((event) => (
                      <div key={event.id}>
                        <span className="num">{String(event.date.getDate()).padStart(2, '0')}</span>
                        <div><strong>{event.title}</strong><small>{event.source === 'SETTLEMENT' ? '账本派生 · 在途资金' : event.accountName ?? '未指定账户'}</small></div>
                        <b className={cx('num', event.direction === 'INFLOW' ? 'text-up' : event.direction === 'OUTFLOW' ? 'text-down' : 'text-info')}>
                          {event.direction === 'MILESTONE' ? '提醒' : `${event.direction === 'OUTFLOW' ? '−' : '+'}${fmtCNY(event.amountCny)}`}
                        </b>
                        {canWrite && event.planId && <DeleteCashPlanButton id={event.planId} />}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              <p className="cash-calendar-disclaimer">计划事项不会写入交易账本；实际发生后仍需录入流水。在途赎回由账本自动派生，不可在此删除。</p>
            </aside>
          </section>
        </div>
      )}
    </div>
  )
}
