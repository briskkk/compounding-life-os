// 流水页：唯一事实源的浏览、筛选、手工录入与 CSV 导入
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { TxForm } from '@/components/tx-form'
import { CsvImport } from '@/components/csv-import'
import { ReverseButton } from '@/components/reverse-button'
import { TX_TYPE_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtMoney, fmtQty } from '@/lib/format'
import type { TxType } from '@/lib/engine/types'

export const dynamic = 'force-dynamic'

const TONE_BY_TYPE: Partial<Record<TxType, 'up' | 'down' | 'gold' | 'info' | 'amber'>> = {
  BUY: 'up',
  SELL: 'down',
  DIVIDEND: 'gold',
  INTEREST: 'gold',
  VALUATION: 'info',
  VEST: 'amber',
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; type?: string; q?: string }>
}) {
  const sp = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const canWrite = ctx.role !== 'VIEWER'
  const db = scopedDb(prisma, ctx)

  const [accounts, assets] = await Promise.all([
    db.account.findMany({ include: { settlementAccount: true } }),
    db.asset.findMany(),
  ])
  const where = {
    ...(sp.account ? { accountId: sp.account } : {}),
    ...(sp.type ? { type: sp.type as TxType } : {}),
  }
  const txs = await db.transaction.findMany({
    where,
    include: { account: true, asset: true },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })

  return (
    <div className="page-shell">
      <PageHeader
        kicker="Ledger"
        title="每一笔变化，都有出处。"
        description="交易流水是组合的唯一事实源；筛选、导出、录入、批量导入与冲正能力全部保留。"
        right={(
          <div className="flex items-center gap-5">
            <div><div className="text-[14px] text-ink-faint">交易笔数</div><div className="num mt-2 text-[28px] text-ink">{txs.length}</div></div>
            {canWrite && <a href="#new-entry" className="inline-flex min-h-11 items-center rounded-lg bg-gold px-5 text-[14px] font-medium text-bg">新增流水</a>}
          </div>
        )}
      />

      {/* 流水表 */}
      <Panel
        title="交易流水"
        en="LEDGER · SOURCE OF TRUTH"
        bodyClassName="p-0"
        right={<span className="num text-[12px] text-ink-faint">最近 {txs.length} 条</span>}
      >
        {/* 筛选 */}
        <form className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3" method="GET">
          <select name="account" defaultValue={sp.account ?? ''} className="rounded border border-line bg-panel2 px-2 py-1 text-xs text-ink-dim outline-none">
            <option value="">全部账户</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select name="type" defaultValue={sp.type ?? ''} className="rounded border border-line bg-panel2 px-2 py-1 text-xs text-ink-dim outline-none">
            <option value="">全部类型</option>
            {Object.entries(TX_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded border border-line bg-panel2 px-3 py-1 text-xs text-ink-dim hover:text-ink">
            筛选
          </button>
          {(sp.account || sp.type) && (
            <Link href="/transactions" className="text-xs text-ink-faint hover:text-ink">
              清除
            </Link>
          )}
          <a href="/api/export/transactions" className="ml-auto text-xs text-ink-faint hover:text-gold" download>
            ↓ 导出 CSV
          </a>
        </form>

        {txs.length === 0 ? (
          <Empty>无匹配流水</Empty>
        ) : (
          <div className="table-scroll">
          <table className="w-full text-[14px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                <th className="px-4 py-2.5 font-normal">日期</th>
                <th className="px-2 py-2.5 font-normal">类型</th>
                <th className="px-2 py-2.5 font-normal">资产</th>
                <th className="px-2 py-2.5 font-normal">账户</th>
                <th className="px-2 py-2.5 text-right font-normal">数量</th>
                <th className="px-2 py-2.5 text-right font-normal">单价</th>
                <th className="px-2 py-2.5 text-right font-normal">金额</th>
                <th className="px-2 py-2.5 text-right font-normal">备注</th>
                <th className="px-4 py-2.5 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {txs.map((t) => (
                <tr key={t.id} className={cx('transition-colors hover:bg-panel2/50', t.voidedAt && 'opacity-40')}>
                  <td className="num px-4 py-2 text-ink-dim">{fmtDate(t.occurredAt)}</td>
                  <td className="px-2 py-2">
                    <Tag tone={TONE_BY_TYPE[t.type] ?? 'dim'}>{TX_TYPE_LABEL[t.type]}</Tag>
                    {t.internal && <span className="ml-1 text-[11px] text-ink-faint">结算</span>}
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
                      t.type === 'SELL' || t.type === 'DIVIDEND' || t.type === 'DEPOSIT' || t.type === 'INTEREST'
                        ? 'text-up'
                        : t.type === 'BUY' || t.type === 'WITHDRAW' || t.type === 'FEE'
                          ? 'text-down'
                          : 'text-ink',
                    )}
                  >
                    {fmtMoney(Number(t.amount), t.asset.currency)}
                  </td>
                  <td className="max-w-[120px] truncate px-2 py-2 text-right text-[13px] text-ink-faint">{t.note ?? ''}</td>
                  <td className="px-4 py-2 text-right">
                    {t.voidedAt ? (
                      <span className="text-[12px] text-ink-faint">已冲正</span>
                    ) : (
                      canWrite &&
                      t.type !== 'REVERSAL' && (
                        <ReverseButton id={t.id} label={`${TX_TYPE_LABEL[t.type]} ${fmtCNY(Number(t.amount))}`} />
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Panel>

      {/* 录入 + 导入 */}
      <div id="new-entry" className="grid gap-12 xl:grid-cols-2">
        <Panel title="录入流水" en="NEW ENTRY">
          <TxForm
            initialAccountId={sp.account}
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
    </div>
  )
}
