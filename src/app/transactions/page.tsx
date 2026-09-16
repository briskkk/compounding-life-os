// 流水页：唯一事实源的浏览、筛选、手工录入与 CSV 导入
import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, PageHeader, Panel, SetupScreen, Tag, ReadOnlyNotice } from '@/components/ui'
import { TxForm } from '@/components/tx-form'
import { HashOpenDetails } from '@/components/hash-open-details'
import { foldTransactions, holdingsIndex } from '@/lib/engine/ledger'
import { TxFilters } from '@/components/tx-filters'
import { CsvImport } from '@/components/csv-import'
import { ReverseButton } from '@/components/reverse-button'
import { TxSortSelect } from '@/components/tx-sort-select'
import { DEFAULT_TX_SORT, parseTxSort, txAriaSort } from '@/lib/engine/tx-sort'
import { TX_TYPE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtDateTime, fmtMoney, fmtQty } from '@/lib/format'
import type { TxType } from '@/lib/engine/types'
import { TableScroll } from '@/components/table-scroll'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { settlementStatus } from '@/lib/engine/settlement-status'

export const dynamic = 'force-dynamic'

const TONE_BY_TYPE: Partial<Record<TxType, 'up' | 'down' | 'accent' | 'info' | 'amber'>> = {
  BUY: 'up',
  SELL: 'down',
  DIVIDEND: 'accent',
  INTEREST: 'accent',
  VALUATION: 'info',
}

const PAGE_SIZES = [25, 50, 100] as const

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; type?: string; q?: string; page?: string; size?: string; batch?: string; history?: string; sort?: string }>
}) {
  const sp = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)

  const [accounts, assets] = await Promise.all([
    db.account.findMany({ include: { settlementAccount: true } }),
    db.asset.findMany({ where: { cls: { not: 'HUAWEI_STOCK' } }, include: { fundTradePolicy: true } }),
  ])
  // 卖出自动关联：折叠全量账本得到各 (账户 × 资产) 的当前/可用份额（不拉行情，纯账本回放）
  const allTxs = await db.transaction.findMany({ orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] })
  const assetClsById = new Map(assets.map((a) => [a.id, a.cls]))
  const assetCcyById = new Map(assets.map((a) => [a.id, a.currency]))
  const holdings = holdingsIndex(foldTransactions(
    allTxs
      .filter((t) => assetClsById.has(t.assetId))
      .map((t) => ({
        accountId: t.accountId,
        assetId: t.assetId,
        type: t.type,
        quantity: t.quantity == null ? null : Number(t.quantity),
        price: t.price == null ? null : Number(t.price),
        amount: Number(t.amount),
        fee: Number(t.fee),
        occurredAt: t.occurredAt,
        navDate: t.navDate,
        assetClass: assetClsById.get(t.assetId)!,
        internal: t.internal,
        voidedAt: t.voidedAt,
        currency: assetCcyById.get(t.assetId),
      })),
  ))
  const showHistory = sp.history === 'all' || sp.type === 'REVERSAL'
  const todayKey = dateKeyAt(new Date())
  const baseWhere: Prisma.TransactionWhereInput = {
    asset: { cls: { not: 'HUAWEI_STOCK' as const } },
    ...(sp.account ? { accountId: sp.account } : {}),
    ...(sp.batch ? { importBatchId: sp.batch } : {}),
  }
  const where: Prisma.TransactionWhereInput = {
    ...baseWhere,
    ...(sp.type ? { type: sp.type as TxType } : showHistory ? {} : { type: { not: 'REVERSAL' } }),
    ...(showHistory ? {} : { voidedAt: null }),
  }
  // 服务端排序（URL 参数驱动）：净值日为空的行在 SQLite 下会排在最前（asc）或最后（desc）
  const activeSort = parseTxSort(sp.sort)
  const txOrderBy = activeSort === 'date-asc'
    ? [{ occurredAt: 'asc' as const }, { createdAt: 'asc' as const }]
    : activeSort === 'navDate-desc'
      ? [{ navDate: 'desc' as const }, { occurredAt: 'desc' as const }]
      : activeSort === 'navDate-asc'
        ? [{ navDate: 'asc' as const }, { occurredAt: 'asc' as const }]
        : [{ occurredAt: 'desc' as const }, { createdAt: 'desc' as const }]
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const requestedSize = Number(sp.size)
  const pageSize = PAGE_SIZES.find((size) => size === requestedSize) ?? 50
  const [txs, total, hiddenHistoryCount] = await Promise.all([
    db.transaction.findMany({
      where,
      include: { account: true, asset: true },
      orderBy: txOrderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.transaction.count({ where }),
    showHistory
      ? Promise.resolve(0)
      : db.transaction.count({
        where: {
          ...baseWhere,
          ...(sp.type
            ? { type: sp.type as TxType, voidedAt: { not: null } }
            : { OR: [{ voidedAt: { not: null } }, { type: 'REVERSAL' }] }),
        },
      }),
  ])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const filterParams = new URLSearchParams()
  if (sp.account) filterParams.set('account', sp.account)
  if (sp.type) filterParams.set('type', sp.type)
  if (sp.batch) filterParams.set('batch', sp.batch)
  if (pageSize !== 50) filterParams.set('size', String(pageSize))
  if (showHistory) filterParams.set('history', 'all')
  if (activeSort !== DEFAULT_TX_SORT) filterParams.set('sort', activeSort)
  const pageHref = (target: number) => {
    const params = new URLSearchParams(filterParams)
    if (target > 1) params.set('page', String(target))
    const qs = params.toString()
    return qs ? `/transactions?${qs}` : '/transactions'
  }

  return (
    <div className="page-shell">
      <PageHeader
        kicker="Ledger"
        title="每一笔变化，都有出处。"
        description="默认只展示当前有效流水；已冲正记录与系统冲正标记折叠到变更历史，需要审计时可随时展开。"
        right={(
          <div className="flex flex-wrap items-center gap-3">
            <div><div className="text-[14px] text-ink-faint">{showHistory ? '含历史记录' : '有效流水'}</div><div className="num mt-2 text-[28px] text-ink">{total}</div></div>
            <Link href="/fund-confirmations" className="inline-flex min-h-11 shrink-0 items-center text-[14px] whitespace-nowrap text-amber">份额确认 →</Link>
            <details className="ledger-operations">
              <summary>更多流水操作</summary>
              <nav aria-label="流水专项操作">
                <Link href="/transactions/imports">导入与批次核对</Link>
                <Link href="/corporate-actions">公司行动</Link>
                <Link href="/fund-operations">基金规则</Link>
              </nav>
            </details>
            {canWrite && <a href="#new-entry" className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-accent px-5 text-[14px] font-medium whitespace-nowrap text-bg">新增流水</a>}
          </div>
        )}
      />

      {!canWrite && <ReadOnlyNotice what="可以查看、筛选与导出流水，但不能录入、导入或冲正" />}
      {canWrite && (
        <HashOpenDetails
          id="new-entry"
          className="ledger-entry-workspace"
          summary={<><span>录入与导入</span><small>按需展开，不必穿过整页流水</small></>}
        >
          <div className="grid gap-6 p-4 xl:grid-cols-2">
            <Panel title="录入流水" en="NEW ENTRY">
              <TxForm
                initialAccountId={sp.account}
                holdings={holdings}
                accounts={accounts.map((a) => ({
                  id: a.id,
                  name: a.name,
                  currency: a.currency,
                  settlementAccountId: a.settlementAccountId,
                  settlementAccountName: a.settlementAccount?.name ?? null,
                }))}
                assets={assets.map((a) => ({
                  id: a.id,
                  symbol: a.symbol,
                  name: a.name,
                  cls: a.cls,
                  currency: a.currency,
                  fundPolicy: a.fundTradePolicy ? {
                    purchaseFeeRate: a.fundTradePolicy.purchaseFeeRate,
                    redemptionFeeRules: a.fundTradePolicy.redemptionFeeRules,
                    purchaseSuspendedFrom: a.fundTradePolicy.purchaseSuspendedFrom?.toISOString() ?? null,
                    purchaseSuspendedUntil: a.fundTradePolicy.purchaseSuspendedUntil?.toISOString() ?? null,
                    sourceName: a.fundTradePolicy.sourceName,
                  } : null,
                }))}
              />
            </Panel>
            <Panel title="CSV 导入" en="BULK IMPORT">
              <CsvImport
                accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
                assets={assets.map((a) => ({ id: a.id, symbol: a.symbol, name: a.name }))}
              />
            </Panel>
          </div>
        </HashOpenDetails>
      )}

      {/* 流水表 */}
      <Panel
        title="交易流水"
        en="LEDGER · SOURCE OF TRUTH"
        bodyClassName="p-0"
        right={<span className="num text-[12px] text-ink-faint">{total > 0 ? `第 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 条 / 共 ${total} 条` : '共 0 条'}</span>}
      >
        {/* 筛选 */}
        <TxFilters
          accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          types={Object.entries(TX_TYPE_LABEL)}
          account={sp.account ?? ''}
          type={sp.type ?? ''}
          showHistory={showHistory}
          hiddenHistoryCount={hiddenHistoryCount}
          pageSize={pageSize}
          batch={sp.batch ?? ''}
        />

        {txs.length === 0 ? (
          total > 0 ? (
            <Empty action={{ href: pageHref(totalPages), label: '回到末页' }}>这一页没有流水</Empty>
          ) : (
            <Empty
              action={sp.account || sp.type
                ? { href: '/transactions', label: '清除筛选' }
                : canWrite ? { href: '#new-entry', label: '录入第一笔流水' } : undefined}
            >
              {sp.account || sp.type ? '无匹配流水' : showHistory ? '暂无流水' : '暂无有效流水'}
            </Empty>
          )
        ) : (
          <TableScroll label="交易流水表">
          <table className="w-full text-[14px] whitespace-nowrap">
            <caption className="sr-only">交易流水表：日期、类型、资产、账户、数量、单价、金额、净值日、结算日与操作</caption>
            <thead>
              <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                <th scope="col" className="px-4 py-2.5 font-normal" aria-sort={txAriaSort(activeSort, 'date')}>
                  <div className="flex items-center gap-2">
                    <span>日期</span>
                    <TxSortSelect value={activeSort} />
                  </div>
                </th>
                <th scope="col" className="px-2 py-2.5 font-normal">类型</th>
                <th scope="col" className="px-2 py-2.5 font-normal">资产</th>
                <th scope="col" className="px-2 py-2.5 font-normal">账户</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">数量</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">单价</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">金额</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal" aria-sort={txAriaSort(activeSort, 'navDate')}>净值日</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">结算日</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">备注</th>
                <th scope="col" className="px-4 py-2.5 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {txs.map((t) => {
                const settlement = settlementStatus(t.settlementDate, todayKey)
                return (
                <tr
                  key={t.id}
                  title={t.voidedAt ? `该流水已于 ${fmtDateTime(t.voidedAt)} 冲正作废` : undefined}
                  className={cx('transition-colors hover:bg-panel2/50', t.voidedAt && 'bg-danger/[0.05] [&>td]:text-ink-dim')}
                >
                  <td className="num px-4 py-2 text-ink-dim">{fmtDate(t.occurredAt)}</td>
                  <td className="px-2 py-2">
                    <Tag tone={TONE_BY_TYPE[t.type] ?? 'dim'}>{TX_TYPE_LABEL[t.type]}</Tag>
                    {t.internal && <span className="ml-1 text-[12px] text-ink-faint">结算</span>}
                    {t.navSource === 'PENDING' && <span className="ml-1 text-[12px] text-amber">份额待确认</span>}
                    {t.voidedAt && <span className="ml-1"><Tag tone="danger">已作废</Tag></span>}
                  </td>
                  <td className="max-w-[180px] truncate px-2 py-2 text-ink">
                    {t.asset.name}
                    <span className="num ml-1 text-[12px] text-ink-faint">{t.asset.symbol}</span>
                  </td>
                  <td className="px-2 py-2 text-ink-dim">{t.account.name}</td>
                  <td className="num px-2 py-2 text-right text-ink-dim">{t.quantity != null ? fmtQty(Number(t.quantity)) : '—'}</td>
                  <td className="num px-2 py-2 text-right text-ink-dim">{t.price != null ? fmtMoney(Number(t.price), t.asset.currency) : '—'}</td>
                  <td
                    className={cx(
                      'num px-2 py-2 text-right',
                      t.type === 'DIVIDEND' || t.type === 'DEPOSIT' || t.type === 'INTEREST'
                        ? 'text-up'
                        : t.type === 'WITHDRAW' || t.type === 'FEE'
                          ? 'text-down'
                          : 'text-ink',
                    )}
                  >
                    {fmtMoney(Number(t.amount), t.asset.currency)}
                  </td>
                  <td className="num px-2 py-2 text-right text-[13px] text-ink-dim" title="份额对应的净值日期（场外基金按 15:00 前后取当日或下一交易日）">
                    {t.navDate ? fmtDate(t.navDate) : '—'}
                  </td>
                  <td className="num px-2 py-2 text-right text-[13px] text-ink-dim" title="资金到账日（申购/赎回的 T+N）；未到账即为在途">
                    {t.settlementDate ? (
                      // 在途语义：到账日未到且未作废时明确标出「在途 N 天」，而不是只给一个日期
                      t.voidedAt ? (
                        fmtDate(t.settlementDate)
                      ) : settlement.state === 'IN_TRANSIT' ? (
                        <span className="inline-flex items-center gap-1.5">
                          {fmtDate(t.settlementDate)}
                          <Tag tone="info">在途 {settlement.days} 天</Tag>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {fmtDate(t.settlementDate)}
                          <span className="text-ink-faint">已到账</span>
                        </span>
                      )
                    ) : '—'}
                  </td>
                  <td className="max-w-[120px] truncate px-2 py-2 text-right text-[13px] text-ink-faint">{t.note ?? ''}</td>
                  <td className="px-4 py-2 text-right">
                    {t.voidedAt ? (
                      <span className="text-[12px] text-ink-dim">已冲正 · {fmtDateTime(t.voidedAt)}</span>
                    ) : (
                      canWrite &&
                      t.type !== 'REVERSAL' && (
                        <>
                          <ReverseButton id={t.id} label={`${TX_TYPE_LABEL[t.type]} ${fmtCNY(Number(t.amount))}`} />
                          {t.asset.cls === 'FUND'
                            && (t.type === 'BUY' || t.type === 'SELL')
                            && (t.navSource === 'ESTIMATE' || t.navSource === 'PENDING')
                            && t.navDate
                            && <Link href={`/fund-confirmations?transaction=${t.id}`} className="ml-3 text-[13px] text-accent transition-colors hover:text-ink">核对份额</Link>}
                        </>
                      )
                    )}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          </TableScroll>
        )}
        {(total > pageSize || page > 1) && (
          <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 text-[13px]">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="text-ink-dim transition-colors hover:text-accent">← 上一页</Link>
            ) : (
              <span aria-disabled="true" className="text-ink-faint/50">← 上一页</span>
            )}
            <span className="num text-ink-faint">第 {page} / {totalPages} 页</span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="text-ink-dim transition-colors hover:text-accent">下一页 →</Link>
            ) : (
              <span aria-disabled="true" className="text-ink-faint/50">下一页 →</span>
            )}
          </div>
        )}
      </Panel>

    </div>
  )
}
