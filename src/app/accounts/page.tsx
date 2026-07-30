// 账户中心：按托管账户观察资产、收益与资金结算关系
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { loadEngineState, type EngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, Panel, SetupScreen, Stat, Tag } from '@/components/ui'
import { AccountForm, AssetForm } from '@/components/account-forms'
import { LiabilityEntryForm, LiabilityForm } from '@/components/liability-forms'
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, LIABILITY_TYPE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtMoney, fmtPct, fmtPrice } from '@/lib/format'
import { CLASS_COLORS } from '@/lib/colors'
import { MarketSourceTag, PositionSourceTag } from '@/components/valuation-source'
import { summarizeAccountPositions, type AccountPositionSummary } from '@/lib/engine/account-summary'
import type { ValuedPosition } from '@/lib/engine/valuation'

export const dynamic = 'force-dynamic'

type AccountView = 'overview' | 'assets' | 'liabilities'

function parseView(value: string | undefined): AccountView {
  return value === 'assets' || value === 'liabilities' ? value : 'overview'
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
  searchParams: Promise<{ view?: string }>
}) {
  const sp = await searchParams
  const activeView = parseView(sp.view)
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)
  const [state, accounts, assets] = await Promise.all([
    loadEngineState(ctx),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
    db.asset.findMany({ orderBy: { createdAt: 'asc' } }),
  ])

  const positionsByAccount = new Map<string, ValuedPosition[]>()
  const valueByAsset = new Map<string, number>()
  const positionByAsset = new Map<string, ValuedPosition>()
  for (const position of state.valued) {
    const accountPositions = positionsByAccount.get(position.accountId) ?? []
    accountPositions.push(position)
    positionsByAccount.set(position.accountId, accountPositions)
    valueByAsset.set(position.assetId, (valueByAsset.get(position.assetId) ?? 0) + position.value)
    if (!positionByAsset.has(position.assetId)) positionByAsset.set(position.assetId, position)
  }

  const summaryByAccount = new Map(accounts.map((account) => {
    const positions = positionsByAccount.get(account.id) ?? []
    return [account.id, summarizeAccountPositions(positions, (symbol) => state.quotes.get(symbol)?.prevCloseCny)]
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
  const totalDayPnl = dayPnlValues.length > 0 ? dayPnlValues.reduce((sum, value) => sum + value, 0) : null
  const unsettledAccounts = accounts.filter((account) => (
    (account.type === 'BROKERAGE' || account.type === 'FUND') && !account.settlementAccountId
  ))
  const latestActivityByAccount = new Map<string, Date>()
  for (const tx of state.ledgerTxs) {
    const current = latestActivityByAccount.get(tx.accountId)
    if (!current || tx.occurredAt > current) latestActivityByAccount.set(tx.accountId, tx.occurredAt)
  }

  const tabs: { view: AccountView; label: string; en: string; count: number }[] = [
    { view: 'overview', label: '账户概览', en: 'OVERVIEW', count: accounts.length },
    { view: 'assets', label: '资产目录', en: 'ASSETS', count: assets.length },
    { view: 'liabilities', label: '负债管理', en: 'LIABILITIES', count: state.liabilities.length },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.24em] text-gold">CUSTODY &amp; CASH ROUTING</div>
          <h1 className="mt-1 text-xl font-medium text-ink">账户中心</h1>
          <p className="mt-1 text-xs text-ink-faint">按托管账户查看未合并持仓、收益及共享资金结算关系。</p>
        </div>
        <div className="text-right text-[10px] leading-relaxed text-ink-faint">
          <div>账户余额由交易流水重放推导</div>
          <div>共享结算现金只在资金账户计入一次</div>
        </div>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-line pb-3" aria-label="账户中心视图">
        {tabs.map((tab) => (
          <Link
            key={tab.view}
            href={tab.view === 'overview' ? '/accounts' : `/accounts?view=${tab.view}`}
            className={cx(
              'flex items-center gap-2 rounded border px-3 py-2 text-xs transition-colors',
              activeView === tab.view
                ? 'border-gold/40 bg-gold/10 text-gold'
                : 'border-line bg-panel text-ink-dim hover:border-ink-faint hover:text-ink',
            )}
          >
            <span>{tab.label}</span>
            <span className="text-[9px] tracking-wider opacity-60">{tab.en}</span>
            <span className="num rounded bg-panel2 px-1.5 py-0.5 text-[9px]">{tab.count}</span>
          </Link>
        ))}
      </nav>

      {activeView === 'overview' && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="账户总资产" en="GROSS ASSETS" value={<span className="text-ink">{fmtCNY(totalAssets)}</span>} hint="不扣除负债" />
            <Stat label="今日盈亏" en="DAY P&L" value={<DeltaAmount value={totalDayPnl} />} hint="仅汇总有昨收行情的资产" />
            <Stat label="现金余额" en="CASH" value={<span className="text-gold">{fmtCNY(totalCash)}</span>} sub={<span className="text-ink-dim">占资产 {fmtPct(totalAssets > 0 ? totalCash / totalAssets : null)}</span>} />
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
              right={<span className="text-[10px] text-ink-faint">点击账户查看明细</span>}
            >
              {accounts.length === 0 ? (
                <Empty>暂无账户</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-line text-left text-[10px] tracking-wider text-ink-faint">
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
                              <Link href={`/accounts/${account.id}`} className="font-medium text-ink hover:text-gold">{account.name}</Link>
                              <div className="mt-0.5 text-[10px] text-ink-faint">
                                {account.institution ?? '未登记机构'} · {account.currency}
                                {latestActivityByAccount.get(account.id) && ` · 更新于 ${fmtDate(latestActivityByAccount.get(account.id)!)}`}
                              </div>
                            </td>
                            <td className="px-2 py-3">
                              <Tag tone={role === '投资账户' ? 'info' : role === '综合账户' ? 'gold' : 'dim'}>{role}</Tag>
                              <div className="mt-1 text-[10px] text-ink-faint">{ACCOUNT_TYPE_LABEL[account.type]}</div>
                            </td>
                            <td className="num px-2 py-3 text-right text-ink-dim">{summary.holdingCount} 项</td>
                            <td className="num px-2 py-3 text-right text-ink">
                              {fmtCNY(summary.valueCny)}
                              {account.currency !== 'CNY' && original != null && (
                                <div className="text-[10px] text-ink-faint">≈ {fmtMoney(original, account.currency)}</div>
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
                </div>
              )}
            </Panel>

            <div className={cx('grid grid-cols-1 items-start gap-3', canWrite && 'xl:grid-cols-2')}>
              <Panel title="资金结算关系" en="CASH ROUTING">
                <div className="space-y-2.5">
                  {accounts.filter((account) => account.type === 'BROKERAGE' || account.type === 'FUND').map((account) => (
                    <Link key={account.id} href={`/accounts/${account.id}`} className="flex items-center justify-between gap-3 rounded border border-line bg-panel2 px-3 py-2 transition-colors hover:border-ink-faint">
                      <span className="truncate text-xs text-ink-dim">{account.name}</span>
                      <span className={cx('shrink-0 text-[10px]', account.settlementAccount ? 'text-ink-faint' : 'text-amber')}>
                        {account.settlementAccount?.name ?? '待配置'} →
                      </span>
                    </Link>
                  ))}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">关联现金是共享引用，只计入资金账户，不在各投资账户重复形成余额。</p>
              </Panel>

              {canWrite && (
                <Panel title="新建账户" en="ADD ACCOUNT">
                  <AccountForm />
                  <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">创建后进入账户详情配置同币种资金结算账户。</p>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}

      {activeView === 'assets' && (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
          <Panel title="资产目录" en="ASSET UNIVERSE" className="xl:col-span-2" bodyClassName="p-0" right={<span className="num text-[10px] text-ink-faint">{assets.length} 项</span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] tracking-wider text-ink-faint">
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
                          <Link href={`/positions/${asset.id}`} className="text-ink hover:text-gold">{asset.name}</Link>
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
            <Panel title="登记资产" en="ADD ASSET">
              <AssetForm />
              <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">资产是全局标的目录；实际归属账户由交易流水决定。</p>
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
                <Empty>暂无负债项目</Empty>
              ) : (
                <div className="divide-y divide-line/60">
                  {state.liabilities.map((liability) => (
                    <div key={liability.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div>
                        <div className="text-sm text-ink">{liability.name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Tag tone="amber">{LIABILITY_TYPE_LABEL[liability.type]}</Tag>
                          <span className="text-[10px] text-ink-faint">{liability.rate != null ? `年利率 ${(liability.rate * 100).toFixed(2)}%` : '利率未登记'}</span>
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
                <Panel title="登记负债" en="ADD LIABILITY"><LiabilityForm /></Panel>
                <Panel title="放款 / 还款 / 调整" en="LIABILITY ENTRY">
                  <LiabilityEntryForm liabilities={state.liabilities.map((liability) => ({ id: liability.id, name: liability.name }))} />
                </Panel>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
