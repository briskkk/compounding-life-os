import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { Empty, Panel, SetupScreen, Stat, Tag } from '@/components/ui'
import { SettlementAccountForm } from '@/components/account-forms'
import { TxForm } from '@/components/tx-form'
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TX_TYPE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import { CLASS_COLORS } from '@/lib/colors'
import { PositionSourceTag } from '@/components/valuation-source'
import { positionDayPnlCny, summarizeAccountPositions } from '@/lib/engine/account-summary'
import { isPortfolioAssetClass } from '@/lib/asset-classification'

export const dynamic = 'force-dynamic'

function DeltaAmount({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-faint">—</span>
  return (
    <span className={cx('num', value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-ink-dim')}>
      {fmtCNY(value, { sign: true })}
    </span>
  )
}

export default async function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)
  const [account, accounts, assets, state, recentTransactions] = await Promise.all([
    db.account.findFirst({ where: { id: accountId }, include: { settlementAccount: true } }),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
    db.asset.findMany({ orderBy: { createdAt: 'asc' } }),
    loadEngineState(ctx),
    db.transaction.findMany({
      where: { accountId, asset: { cls: { not: 'HUAWEI_STOCK' } } },
      include: { asset: true },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    }),
  ])
  if (!account) return notFound()

  const positions = state.valued
    .filter((position) => position.accountId === account.id
      && isPortfolioAssetClass(position.asset.cls)
      && (Math.abs(position.quantity) > 1e-9 || Math.abs(position.value) > 1e-9))
    .sort((a, b) => b.value - a.value)
  const summary = summarizeAccountPositions(positions, (symbol) => state.quotes.get(symbol)?.prevCloseCny)
  const accountWeight = state.metrics.portfolioValue > 0 ? summary.valueCny / state.metrics.portfolioValue : null
  const cashAccountIds = new Set(
    state.valued.filter((position) => position.asset.cls === 'CASH' && Math.abs(position.value) > 1e-9).map((position) => position.accountId),
  )
  const settlementTargetIds = new Set(accounts.flatMap((candidate) => candidate.settlementAccountId ? [candidate.settlementAccountId] : []))
  const settlementCandidates = accounts.filter((candidate) => (
    candidate.currency === account.currency
    && (
      candidate.id === account.id
      || candidate.id === account.settlementAccountId
      || candidate.type === 'BANK'
      || cashAccountIds.has(candidate.id)
      || settlementTargetIds.has(candidate.id)
    )
  ))
  const settlementPositions = account.settlementAccountId && account.settlementAccountId !== account.id
    ? state.valued.filter((position) => position.accountId === account.settlementAccountId && position.asset.cls === 'CASH')
    : []
  const sharedCashCny = settlementPositions.reduce((sum, position) => sum + position.value, 0)

  return (
    <div className="space-y-4">
      <Link href="/accounts" className="text-xs text-ink-faint hover:text-ink">← 返回账户概览</Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-medium text-ink">{account.name}</h1>
            <Tag tone="dim">{ACCOUNT_TYPE_LABEL[account.type]}</Tag>
            <Tag tone={account.currency === 'CNY' ? 'dim' : 'gold'}>{account.currency}</Tag>
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            {account.institution ?? '未登记机构'} · 账户内资产按托管关系独立展示，不与其他账户合并
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/transactions?account=${account.id}`} className="rounded border border-line bg-panel px-3 py-2 text-xs text-ink-dim hover:border-ink-faint hover:text-ink">查看全部流水</Link>
          <Link href="/accounts?view=assets" className="rounded border border-line bg-panel px-3 py-2 text-xs text-ink-dim hover:border-ink-faint hover:text-ink">资产目录</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="账户资产" en="VALUE" value={<span className="text-ink">{fmtCNY(summary.valueCny)}</span>} hint="人民币折算口径" />
        <Stat label="今日盈亏" en="DAY P&L" value={<DeltaAmount value={summary.dayPnlCny} />} hint="仅含有昨收行情的资产" />
        <Stat label="未实现盈亏" en="UNREALIZED" value={<DeltaAmount value={summary.unrealizedCny} />} />
        <Stat label="本账户现金" en="CASH" value={<span className="text-gold">{fmtCNY(summary.cashCny)}</span>} hint={sharedCashCny > 0 ? `另关联共享现金 ${fmtCNY(sharedCashCny)}` : '仅统计本账户持有现金'} />
        <Stat label="投资组合占比" en="WEIGHT" value={<span className="text-info">{fmtPct(accountWeight)}</span>} hint={`${summary.holdingCount} 项当前持仓`} />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
        <Panel title="账户持仓" en="ACCOUNT POSITIONS" className="xl:col-span-2" bodyClassName="p-0" right={<span className="num text-[12px] text-ink-faint">{summary.holdingCount} 项</span>}>
          {positions.length === 0 ? (
            <Empty>当前账户暂无持仓</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                    <th className="px-4 py-2.5 font-normal">资产</th>
                    <th className="px-2 py-2.5 text-right font-normal">数量</th>
                    <th className="px-2 py-2.5 text-right font-normal">现价 / 来源</th>
                    <th className="px-2 py-2.5 text-right font-normal">市值</th>
                    <th className="px-2 py-2.5 text-right font-normal">今日盈亏</th>
                    <th className="px-2 py-2.5 text-right font-normal">未实现盈亏</th>
                    <th className="px-4 py-2.5 text-right font-normal">账户占比</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {positions.map((position) => {
                    const quote = state.quotes.get(position.asset.symbol)
                    const dayPnl = positionDayPnlCny(position, quote?.prevCloseCny)
                    return (
                      <tr key={position.assetId} className="transition-colors hover:bg-panel2/50">
                        <td className="px-4 py-3">
                          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: CLASS_COLORS[position.asset.cls] }} />
                          <Link href={`/positions/${position.assetId}`} className="text-ink hover:text-gold">{position.asset.name}</Link>
                          <div className="num ml-3.5 mt-0.5 text-[12px] text-ink-faint">{position.asset.symbol} · {ASSET_CLASS_LABEL[position.asset.cls]}</div>
                        </td>
                        <td className="num px-2 py-3 text-right text-ink-dim">{fmtQty(position.quantity)}</td>
                        <td className="px-2 py-3 text-right">
                          <div className="num text-ink-dim">
                            {position.asset.cls === 'CASH'
                              ? fmtMoney(1, position.asset.currency)
                              : quote
                                ? fmtMoney(quote.price, position.asset.currency)
                                : position.price != null
                                  ? fmtMoney(position.price, position.asset.currency)
                                  : '—'}
                          </div>
                          <div className="mt-1"><PositionSourceTag priceSource={position.priceSource} marketSource={quote?.source} /></div>
                        </td>
                        <td className="num px-2 py-3 text-right text-ink">{fmtCNY(position.value)}</td>
                        <td className="px-2 py-3 text-right"><DeltaAmount value={dayPnl} /></td>
                        <td className="px-2 py-3 text-right"><DeltaAmount value={position.asset.cls === 'CASH' ? null : position.unrealized} /></td>
                        <td className="num px-4 py-3 text-right text-ink-dim">{fmtPct(summary.valueCny > 0 ? position.value / summary.valueCny : null)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-3">
          <Panel title="资金结算" en="CASH ROUTING">
            <div className="rounded border border-line bg-panel2 px-3 py-2.5">
              <div className="text-[12px] text-ink-faint">当前关系</div>
              <div className="mt-1.5 text-sm text-ink">
                {account.name} <span className="mx-1 text-ink-faint">→</span> {account.settlementAccount?.name ?? '不自动联动现金'}
              </div>
              {account.settlementAccountId && account.settlementAccountId !== account.id && (
                <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">共享资金余额 {fmtCNY(sharedCashCny)}，仅计入 {account.settlementAccount?.name}，不重复计入本账户。</p>
              )}
            </div>
            {canWrite && (
              <SettlementAccountForm
                accountId={account.id}
                currentId={account.settlementAccountId}
                accounts={settlementCandidates.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
              />
            )}
          </Panel>

          {canWrite && (
            <Panel title="录入账户流水" en="NEW TRANSACTION">
              <TxForm
                lockAccount
                initialAccountId={account.id}
                accounts={[{
                  id: account.id,
                  name: account.name,
                  currency: account.currency,
                  settlementAccountId: account.settlementAccountId,
                  settlementAccountName: account.settlementAccount?.name ?? null,
                }]}
                assets={assets.filter((asset) => asset.currency === account.currency && isPortfolioAssetClass(asset.cls)).map((asset) => ({
                  id: asset.id,
                  symbol: asset.symbol,
                  name: asset.name,
                  cls: asset.cls,
                  currency: asset.currency,
                }))}
              />
            </Panel>
          )}
        </div>
      </div>

      <Panel
        title="最近流水"
        en="RECENT LEDGER"
        bodyClassName="p-0"
        right={<Link href={`/transactions?account=${account.id}`} className="text-[12px] text-ink-faint hover:text-gold">查看全部 →</Link>}
      >
        {recentTransactions.length === 0 ? (
          <Empty>当前账户暂无流水</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px] whitespace-nowrap">
              <thead>
                <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                  <th className="px-4 py-2.5 font-normal">日期</th>
                  <th className="px-2 py-2.5 font-normal">类型</th>
                  <th className="px-2 py-2.5 font-normal">资产</th>
                  <th className="px-2 py-2.5 text-right font-normal">数量</th>
                  <th className="px-2 py-2.5 text-right font-normal">金额</th>
                  <th className="px-4 py-2.5 text-right font-normal">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {recentTransactions.map((transaction) => (
                  <tr key={transaction.id} className={cx(transaction.voidedAt && 'opacity-40')}>
                    <td className="num px-4 py-2.5 text-ink-dim">{fmtDate(transaction.occurredAt)}</td>
                    <td className="px-2 py-2.5"><Tag tone="dim">{TX_TYPE_LABEL[transaction.type]}</Tag>{transaction.internal && <span className="ml-1 text-[11px] text-ink-faint">结算</span>}</td>
                    <td className="px-2 py-2.5"><Link href={`/positions/${transaction.assetId}`} className="text-ink hover:text-gold">{transaction.asset.name}</Link></td>
                    <td className="num px-2 py-2.5 text-right text-ink-dim">{transaction.quantity != null ? fmtQty(Number(transaction.quantity)) : '—'}</td>
                    <td className="num px-2 py-2.5 text-right text-ink">{fmtMoney(Number(transaction.amount), transaction.asset.currency)}</td>
                    <td className="max-w-[260px] truncate px-4 py-2.5 text-right text-[12px] text-ink-faint">{transaction.voidedAt ? '已冲正' : transaction.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
