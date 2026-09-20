import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './account-detail.module.css'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { loadEngineState } from '@/lib/queries'
import { Empty, Panel, SetupScreen, Tag } from '@/components/ui'
import { SettlementAccountForm } from '@/components/account-forms'
import { TxForm } from '@/components/tx-form'
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TX_TYPE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import { CLASS_COLORS } from '@/lib/colors'
import { PositionSourceTag } from '@/components/valuation-source'
import { positionDayPnlCny, summarizeAccountPositions } from '@/lib/engine/account-summary'
import { holdingsIndex } from '@/lib/engine/ledger'
import { isPortfolioAssetClass } from '@/lib/asset-classification'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { livePreviousClose } from '@/lib/engine/portfolio-day'
import { BreadcrumbEntity } from '@/components/app-shell'

export const dynamic = 'force-dynamic'

function DeltaAmount({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-faint">—</span>
  return (
    <span className={cx('num', value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-ink-dim')}>
      {fmtCNY(value, { sign: true })}
    </span>
  )
}

function AccountMetric({ label, value, hint, primary = false }: {
  label: string
  value: ReactNode
  hint?: string
  primary?: boolean
}) {
  return (
    <div className={cx(styles.metric, primary && styles.primaryMetric)}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
      {hint && <p>{hint}</p>}
    </div>
  )
}

export default async function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)
  const [account, accounts, assets, state, recentTransactions, hiddenHistoryCount] = await Promise.all([
    db.account.findFirst({ where: { id: accountId }, include: { settlementAccount: true } }),
    db.account.findMany({ include: { settlementAccount: true }, orderBy: { createdAt: 'asc' } }),
    db.asset.findMany({ include: { fundTradePolicy: true }, orderBy: { createdAt: 'asc' } }),
    loadEngineState(ctx),
    db.transaction.findMany({
      // 与流水页默认视图同一口径：冲正历史默认不入列表，需要时走「查看全部」并显式打开
      where: { accountId, voidedAt: null, type: { not: 'REVERSAL' }, asset: { cls: { not: 'HUAWEI_STOCK' } } },
      include: { asset: true },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    }),
    db.transaction.count({
      where: {
        accountId,
        asset: { cls: { not: 'HUAWEI_STOCK' } },
        OR: [{ voidedAt: { not: null } }, { type: 'REVERSAL' }],
      },
    }),
  ])
  if (!account) return notFound()
  const now = new Date()

  const positions = state.valued
    .filter((position) => position.accountId === account.id
      && isPortfolioAssetClass(position.asset.cls)
      && (Math.abs(position.quantity) > 1e-9 || Math.abs(position.value) > 1e-9))
    .sort((a, b) => b.value - a.value)
  const summary = summarizeAccountPositions(positions, (symbol) => {
    const quote = state.quotes.get(symbol)
    const asset = positions.find((position) => position.asset.symbol === symbol)?.asset
    return livePreviousClose({
      asset: { symbol, currency: asset?.currency, cls: asset?.cls },
      exchangeTradingDate: quote?.tradingDate,
      prevClose: quote?.prevCloseCny,
      now,
    })
  })
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
    <div className={styles.page}>
      <Link href="/accounts" className={styles.backLink}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 5-7 7 7 7M5 12h14" />
        </svg>
        <span>返回账户概览</span>
      </Link>

      <div className={styles.header}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BreadcrumbEntity name={account.name} />
      <h1 className={styles.title}>{account.name}</h1>
            <Tag tone="dim">{ACCOUNT_TYPE_LABEL[account.type]}</Tag>
            <Tag tone={account.currency === 'CNY' ? 'dim' : 'accent'}>{account.currency}</Tag>
          </div>
          <p className={styles.description}>
            {account.institution ?? '未登记机构'} · 账户内资产按托管关系独立展示，不与其他账户合并
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/transactions?account=${account.id}`} className="rounded border border-line bg-panel px-3 py-2 text-xs text-ink-dim hover:border-ink-faint hover:text-ink">查看全部流水</Link>
          <Link href="/accounts?view=assets" className="rounded border border-line bg-panel px-3 py-2 text-xs text-ink-dim hover:border-ink-faint hover:text-ink">资产目录</Link>
        </div>
      </div>

      <dl className={styles.metrics}>
        <AccountMetric label="账户资产" primary value={<span className="text-ink">{fmtCNY(summary.valueCny)}</span>} hint="人民币折算口径" />
        <AccountMetric label="今日盈亏" value={<DeltaAmount value={summary.dayPnlCny} />} hint="仅含有昨收行情的资产" />
        <AccountMetric label="未实现盈亏" value={<DeltaAmount value={summary.unrealizedCny} />} />
        <AccountMetric label="本账户现金" value={<span className="text-accent">{fmtCNY(summary.cashCny)}</span>} hint={sharedCashCny > 0 ? `另关联共享现金 ${fmtCNY(sharedCashCny)}` : '仅统计本账户持有现金'} />
        <AccountMetric label="投资组合占比" value={<span className="text-info">{fmtPct(accountWeight)}</span>} hint={`${summary.holdingCount} 项当前持仓`} />
      </dl>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
        <Panel title="账户持仓" className="xl:col-span-2" bodyClassName="p-0" right={<span className="num text-[12px] text-ink-faint">{summary.holdingCount} 项</span>}>
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
                    const dayPnl = positionDayPnlCny(
                      position,
                      livePreviousClose({
                        asset: { symbol: position.asset.symbol, currency: position.asset.currency, cls: position.asset.cls },
                        exchangeTradingDate: quote?.tradingDate,
                        prevClose: quote?.prevCloseCny,
                        now,
                      }),
                    )
                    return (
                      <tr key={position.assetId} className="transition-colors hover:bg-panel2/50">
                        <td className="px-4 py-3">
                          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: CLASS_COLORS[position.asset.cls] }} />
                          <Link href={`/positions/${position.assetId}`} className="text-ink hover:text-accent">{position.asset.name}</Link>
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
          <Panel title="资金结算">
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
            <Panel title="录入账户流水">
              <TxForm
                lockAccount
                initialAccountId={account.id}
                holdings={holdingsIndex(state.valued)}
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
                  fundPolicy: asset.fundTradePolicy ? {
                    purchaseFeeRate: asset.fundTradePolicy.purchaseFeeRate,
                    redemptionFeeRules: asset.fundTradePolicy.redemptionFeeRules,
                    purchaseSuspendedFrom: asset.fundTradePolicy.purchaseSuspendedFrom?.toISOString() ?? null,
                    purchaseSuspendedUntil: asset.fundTradePolicy.purchaseSuspendedUntil?.toISOString() ?? null,
                    sourceName: asset.fundTradePolicy.sourceName,
                  } : null,
                }))}
              />
            </Panel>
          )}
        </div>
      </div>

      <Panel
        title="最近流水"
        bodyClassName="p-0"
        right={<Link href={`/transactions?account=${account.id}`} className="text-[12px] text-ink-faint hover:text-accent">查看全部 →</Link>}
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
                    <td className="px-2 py-2.5"><Tag tone="dim">{TX_TYPE_LABEL[transaction.type]}</Tag>{transaction.internal && <span className="ml-1 text-[12px] text-ink-faint">结算</span>}</td>
                    <td className="px-2 py-2.5"><Link href={`/positions/${transaction.assetId}`} className="text-ink hover:text-accent">{transaction.asset.name}</Link></td>
                    <td className="num px-2 py-2.5 text-right text-ink-dim">{transaction.quantity != null ? fmtQty(Number(transaction.quantity)) : '—'}</td>
                    <td className="num px-2 py-2.5 text-right text-ink">{fmtMoney(Number(transaction.amount), transaction.asset.currency)}</td>
                    <td className="max-w-[260px] truncate px-4 py-2.5 text-right text-[12px] text-ink-faint">{transaction.voidedAt ? '已冲正' : transaction.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hiddenHistoryCount > 0 && (
          <p className="border-t border-line px-4 py-3 text-[12px] text-ink-faint">
            另有 {hiddenHistoryCount} 条冲正或已作废记录
            <Link href={`/transactions?account=${account.id}&history=all`} className="ml-2 text-accent hover:underline">查看冲正历史 →</Link>
          </p>
        )}
      </Panel>
    </div>
  )
}
