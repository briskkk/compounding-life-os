import Link from 'next/link'
import { getSession } from '@/lib/session'
import { getWatchData } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { summarizeAccountPositions } from '@/lib/engine/account-summary'
import { dateKeyAt, previousCloseOnPortfolioDay } from '@/lib/engine/watch-market'
import { Empty, PageHeader, Panel, SetupScreen, Tag } from '@/components/ui'
import { ReconciliationForm } from '@/components/reconciliation-form'
import { cx, fmtCNY, fmtDateTime } from '@/lib/format'

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
  const todayKey = dateKeyAt(new Date())
  const accountRows = accounts.map((account) => {
    const summary = summarizeAccountPositions(
      state.valued.filter((position) => position.accountId === account.id),
      (symbol) => {
        const quote = state.quotes.get(symbol)
        return previousCloseOnPortfolioDay(quote?.prevCloseCny, quote?.tradingDate, todayKey)
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
        kicker="Evidence checkpoint"
        title="账户对账"
        description="把券商、银行或基金平台显示的余额与当前账本逐账户核对。核对凭证只追加到审计链，绝不会直接改写资产。"
        right={<Link href="/health" className="text-[14px] text-accent">返回健康中心 →</Link>}
      />

      <section className="reconciliation-summary">
        <div><span>已建立凭证</span><strong className="num">{accountRows.filter((row) => row.latest).length}/{accountRows.length}</strong></div>
        <div><span>最近一致</span><strong className="num text-down">{matchedCount}</strong></div>
        <div><span>最近差额合计</span><strong className={cx('num', Math.abs(differenceTotal) < 0.01 ? 'text-down' : 'text-amber')}>{fmtCNY(differenceTotal, { sign: true })}</strong></div>
        <p>差额不等于收益。发现差异后，请回到流水补录遗漏交易或冲正错误记录。</p>
      </section>

      <Panel title="当前账户核对状态" en="ACCOUNT CHECKPOINTS" bodyClassName="p-0">
        <div className="table-scroll">
          <table className="w-full whitespace-nowrap text-[14px]">
            <thead><tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint"><th className="px-4 py-3 font-normal">账户</th><th className="px-2 py-3 text-right font-normal">当前账本</th><th className="px-2 py-3 text-right font-normal">最近账单</th><th className="px-2 py-3 text-right font-normal">差额</th><th className="px-4 py-3 font-normal">状态</th></tr></thead>
            <tbody className="divide-y divide-line/60">{accountRows.map((row) => {
              const evidence = row.latest?.evidence
              const matched = evidence && Math.abs(evidence.differenceCny) < 0.01
              return <tr key={row.id}><td className="px-4 py-3"><strong className="font-medium text-ink">{row.name}</strong><small className="mt-1 block text-ink-faint">{row.institution ?? '未登记机构'}</small></td><td className="num px-2 py-3 text-right text-ink">{fmtCNY(row.ledgerValueCny)}</td><td className="num px-2 py-3 text-right text-ink-dim">{evidence ? fmtCNY(evidence.observedValueCny) : '—'}</td><td className={cx('num px-2 py-3 text-right', matched ? 'text-down' : evidence ? 'text-amber' : 'text-ink-faint')}>{evidence ? fmtCNY(evidence.differenceCny, { sign: true }) : '—'}</td><td className="px-4 py-3">{evidence ? <Tag tone={matched ? 'down' : 'amber'}>{matched ? '一致' : '有差额'}</Tag> : <Tag tone="dim">未核对</Tag>}</td></tr>
            })}</tbody>
          </table>
        </div>
      </Panel>

      {ctx.role !== 'VIEWER' && (
        <Panel title="新增核对凭证" en="APPEND EVIDENCE">
          <ReconciliationForm accounts={accountRows.map(({ id, name, ledgerValueCny }) => ({ id, name, ledgerValueCny }))} />
          <p className="mt-4 text-[12px] leading-6 text-ink-faint">凭证是核对时点的证据，不是资产余额字段。提交后如需修正，请新增一条凭证保留历史。</p>
        </Panel>
      )}

      <Panel title="核对历史" en="RECONCILIATION TRAIL" bodyClassName="p-0">
        {evidenceRows.length === 0 ? <Empty>尚无账户核对凭证</Empty> : <div className="reconciliation-history">{evidenceRows.map((row) => <article key={row.id}><time className="num">{fmtDateTime(row.createdAt)}</time><div><strong>{row.accountName}</strong><span>{row.sourceName} · 账单日 {row.asOfDate}</span></div><b className={Math.abs(row.differenceCny) < 0.01 ? 'text-down' : 'text-amber'}>{fmtCNY(row.differenceCny, { sign: true })}</b><small>{row.actorName}{row.note ? ` · ${row.note}` : ''}</small></article>)}</div>}
      </Panel>
    </div>
  )
}
