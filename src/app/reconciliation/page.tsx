import Link from 'next/link'
import { getSession } from '@/lib/session'
import { getWatchData } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { summarizeAccountPositions } from '@/lib/engine/account-summary'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { livePreviousClose } from '@/lib/engine/portfolio-day'
import { Empty, PageHeader, Panel, SetupScreen, Tag, ReadOnlyNotice } from '@/components/ui'
import { ReconciliationForm } from '@/components/reconciliation-form'
import { cx, fmtCNY, fmtDateTime } from '@/lib/format'
import { TableScroll } from '@/components/table-scroll'
import { HashOpenDetails } from '@/components/hash-open-details'

export const dynamic = 'force-dynamic'

interface ReconciliationEvidence {
  version: number
  accountName: string
  asOfDate: string
  observedValueCny: number
  ledgerValueCny: number
  differenceCny: number
  sourceName: string
  note: string | null
}

function parseEvidence(value: string | null): ReconciliationEvidence | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ReconciliationEvidence
    return parsed.version === 1 && Number.isFinite(parsed.differenceCny) ? parsed : null
  } catch {
    return null
  }
}

export default async function ReconciliationPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [watchData, accounts, logs] = await Promise.all([
    getWatchData(ctx),
    db.account.findMany({ orderBy: { createdAt: 'asc' } }),
    db.auditLog.findMany({
      where: { action: 'RECONCILE', entity: 'Account' },
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
  ])
  if (!watchData) return <SetupScreen />
  const state = watchData.state
  const now = new Date()
  const accountRows = accounts.map((account) => {
    const summary = summarizeAccountPositions(
      state.valued.filter((position) => position.accountId === account.id),
      (symbol) => {
        const quote = state.quotes.get(symbol)
        const asset = state.valued.find((position) => position.asset.symbol === symbol)?.asset
        return livePreviousClose({
          asset: { symbol, currency: asset?.currency, cls: asset?.cls },
          exchangeTradingDate: quote?.tradingDate,
          prevClose: quote?.prevCloseCny,
          now,
        })
      },
    )
    const latestLog = logs.find((log) => log.entityId === account.id)
    return {
      id: account.id,
      name: account.name,
      institution: account.institution,
      ledgerValueCny: Math.round(summary.valueCny * 100) / 100,
      latest: latestLog ? { createdAt: latestLog.createdAt, evidence: parseEvidence(latestLog.detail) } : null,
    }
  })
  const evidenceRows = logs.flatMap((log) => {
    const evidence = parseEvidence(log.detail)
    return evidence ? [{ ...evidence, id: log.id, createdAt: log.createdAt, actorName: log.actorName }] : []
  })
  const matchedCount = accountRows.filter((row) => row.latest?.evidence && Math.abs(row.latest.evidence.differenceCny) < 0.01).length
  const differenceTotal = accountRows.reduce((sum, row) => sum + (row.latest?.evidence?.differenceCny ?? 0), 0)

  return (
    <div className="page-shell reconciliation-page">
      <PageHeader
        title="账户对账"
        description="对照外部账单与账本余额；凭证只留核对记录，不改资产。"
        right={(
          <div className="flex items-center gap-5">
            <Link href="/health" className="text-[14px] text-accent">返回健康中心 →</Link>
            {ctx.role !== 'VIEWER' && <a href="#new-reconciliation" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 text-[14px] font-medium text-bg">新增凭证</a>}
          </div>
        )}
      />

      <section className="reconciliation-summary">
        <div><span>已建立凭证</span><strong className="num">{accountRows.filter((row) => row.latest).length}/{accountRows.length}</strong></div>
        <div><span>最近一致</span><strong className="num text-info">{matchedCount}</strong></div>
        <div><span>最近差额合计</span><strong className={cx('num', Math.abs(differenceTotal) < 0.01 ? 'text-info' : 'text-amber')}>{fmtCNY(differenceTotal, { sign: true })}</strong></div>
        <p>差额不等于收益。发现差异后，请回到流水补录遗漏交易或冲正错误记录。</p>
      </section>

      <Panel title="当前账户核对状态" bodyClassName="p-0">
        <TableScroll label="核对凭证表">
          <table className="w-full whitespace-nowrap text-[14px]">
            <thead><tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint"><th className="px-4 py-3 font-normal">账户</th><th className="px-2 py-3 text-right font-normal">当前账本</th><th className="px-2 py-3 text-right font-normal">最近账单</th><th className="px-2 py-3 text-right font-normal">差额</th><th className="px-4 py-3 font-normal">状态</th></tr></thead>
            <tbody className="divide-y divide-line/60">{accountRows.map((row) => {
              const evidence = row.latest?.evidence
              const matched = evidence && Math.abs(evidence.differenceCny) < 0.01
              return <tr key={row.id}><td className="px-4 py-3"><strong className="font-medium text-ink">{row.name}</strong><small className="mt-1 block text-ink-faint">{row.institution ?? '未登记机构'}</small></td><td className="num px-2 py-3 text-right text-ink">{fmtCNY(row.ledgerValueCny)}</td><td className="num px-2 py-3 text-right text-ink-dim">{evidence ? fmtCNY(evidence.observedValueCny) : '—'}</td><td className={cx('num px-2 py-3 text-right', matched ? 'text-info' : evidence ? 'text-amber' : 'text-ink-faint')}>{evidence ? fmtCNY(evidence.differenceCny, { sign: true }) : '—'}</td><td className="px-4 py-3">{evidence ? <Tag tone={matched ? 'info' : 'amber'}>{matched ? '一致' : '有差额'}</Tag> : <Tag tone="dim">未核对</Tag>}</td></tr>
            })}</tbody>
          </table>
        </TableScroll>
      </Panel>

      {ctx.role === 'VIEWER' && <ReadOnlyNotice what="可以查看核对凭证与差额，但不能追加外部凭证" />}
      {ctx.role !== 'VIEWER' && (
        <HashOpenDetails
          id="new-reconciliation"
          className="action-workspace"
          summary={<><span>新增核对凭证</span><small>有新账单时再展开</small></>}
        >
          <div className="action-workspace-body">
            <ReconciliationForm accounts={accountRows.map(({ id, name, ledgerValueCny }) => ({ id, name, ledgerValueCny }))} />
            <p className="mt-4 text-[12px] leading-6 text-ink-faint">如需修正，请新增凭证保留历史。</p>
          </div>
        </HashOpenDetails>
      )}

      <Panel title="核对历史" bodyClassName="p-0">
        {evidenceRows.length === 0 ? <Empty>尚无账户核对凭证</Empty> : <div className="reconciliation-history">{evidenceRows.map((row) => <article key={row.id}><time className="num">{fmtDateTime(row.createdAt)}</time><div><strong>{row.accountName}</strong><span>{row.sourceName} · 账单日 {row.asOfDate}</span></div><b className={Math.abs(row.differenceCny) < 0.01 ? 'text-info' : 'text-amber'}>{fmtCNY(row.differenceCny, { sign: true })}</b><small>{row.actorName}{row.note ? ` · ${row.note}` : ''}</small></article>)}</div>}
      </Panel>
    </div>
  )
}
