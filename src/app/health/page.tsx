import Link from 'next/link'
import { getDashboard } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { verifyChain } from '@/lib/audit'
import { marketHealth } from '@/lib/market/cache'
import { ReadOnlyNotice, SetupScreen, Tag } from '@/components/ui'
import { cx, fmtCNY, fmtDate, fmtDateTime, fmtPct } from '@/lib/format'
import { HealthRepairActions } from '@/components/health-repair-actions'
import { ConfirmFundSettlementButton } from '@/components/confirm-fund-settlement-button'
import { GovernanceNav } from '@/components/governance-nav'

export const dynamic = 'force-dynamic'

type Severity = 'BLOCKING' | 'WARNING' | 'INFO'

interface HealthIssue {
  id: string
  severity: Severity
  category: string
  title: string
  detail: string
  metric: string
  href: string
  action: string
}

const SEVERITY_LABEL: Record<Severity, string> = {
  BLOCKING: '需处理',
  WARNING: '需核对',
  INFO: '提醒',
}

export default async function DataHealthPage() {
  const dashboard = await getDashboard('THIS_MONTH')
  if (!dashboard) return <SetupScreen />
  const db = scopedDb(prisma, dashboard.ctx)
  const [accounts, latestSnapshot, failedImports, allocationTargetCount, chain, refreshLogs, reconciliationLogs, fundEvents, settlementConfirmations] = await Promise.all([
    db.account.findMany({ orderBy: { createdAt: 'asc' } }),
    db.snapshot.findFirst({ orderBy: { date: 'desc' } }),
    db.importBatch.findMany({ where: { failedCount: { gt: 0 } }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.allocationTarget.count(),
    verifyChain(prisma, dashboard.ctx.familyId),
    db.auditLog.findMany({ where: { action: 'REFRESH', entity: 'PriceBar' }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.auditLog.findMany({ where: { action: 'RECONCILE', entity: 'Account' }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.transaction.findMany({
      where: {
        voidedAt: null,
        asset: { cls: 'FUND' },
        OR: [{ navSource: { in: ['ESTIMATE', 'PENDING'] } }, { type: 'SELL', settlementDate: { not: null } }],
      },
      include: { asset: true, account: true },
      orderBy: { occurredAt: 'desc' },
      take: 80,
    }),
    db.auditLog.findMany({ where: { action: 'FUND_SETTLEMENT_CONFIRMED', entity: 'Transaction' }, select: { entityId: true } }),
  ])
  const issues: HealthIssue[] = []
  const state = dashboard.state

  const missingQuotes = state.valued.filter((position) => (
    Math.abs(position.quantity) > 1e-9
    && !position.asset.manual
    && position.asset.cls !== 'CASH'
    && position.asset.cls !== 'REAL_ESTATE'
    && position.priceSource === 'COST'
  ))
  if (missingQuotes.length > 0) {
    issues.push({
      id: 'missing-quotes',
      severity: 'BLOCKING',
      category: '估值完整性',
      title: `${missingQuotes.length} 项持仓缺少可用行情`,
      detail: `当前以成本暂代估值：${missingQuotes.slice(0, 3).map((item) => item.asset.name).join('、')}${missingQuotes.length > 3 ? '等' : ''}。这会影响净资产与收益判断。`,
      metric: fmtCNY(missingQuotes.reduce((sum, item) => sum + item.value, 0)),
      href: '/positions',
      action: '查看持仓',
    })
  }

  const staleBefore = Date.now() - 90 * 86400000
  const missingManualValuations = state.valued.filter((position) => (
    position.value > 0
    && (position.asset.manual || position.asset.cls === 'REAL_ESTATE')
    && position.priceSource === 'COST'
  ))
  if (missingManualValuations.length > 0) {
    issues.push({
      id: 'missing-manual-valuations',
      severity: 'WARNING',
      category: '手动估值',
      title: `${missingManualValuations.length} 项手动资产仍以成本估值`,
      detail: `${missingManualValuations.slice(0, 4).map((item) => item.asset.name).join('、')}尚未录入独立估值，当前市值可能只反映历史成本。`,
      metric: fmtCNY(missingManualValuations.reduce((sum, item) => sum + item.value, 0)),
      href: '/positions',
      action: '补充估值',
    })
  }
  const staleManual = state.valued.filter((position) => (
    position.priceSource === 'MANUAL'
    && position.value > 0
    && (!position.lastValuationAt || position.lastValuationAt.getTime() < staleBefore)
  ))
  if (staleManual.length > 0) {
    issues.push({
      id: 'stale-manual',
      severity: 'WARNING',
      category: '手动估值',
      title: `${staleManual.length} 项手动估值超过 90 天未更新`,
      detail: staleManual.slice(0, 4).map((item) => `${item.asset.name} · ${item.lastValuationAt ? fmtDate(item.lastValuationAt) : '从未估值'}`).join('；'),
      metric: fmtCNY(staleManual.reduce((sum, item) => sum + item.value, 0)),
      href: '/positions',
      action: '更新估值',
    })
  }

  if (dashboard.review.valuationGapCount > 0 && missingQuotes.length === 0) {
    issues.push({
      id: 'period-valuation-gaps',
      severity: 'WARNING',
      category: '期间估值',
      title: `本月收益序列含 ${dashboard.review.valuationGapCount} 个估值缺口`,
      detail: '当前行情可用，但本月部分历史时点沿用了旧价格或缺少收盘价；收益复盘会明确显示覆盖率。',
      metric: fmtPct(dashboard.review.valuationCoverage),
      href: '/review',
      action: '查看复盘',
    })
  }

  const negativeCash = state.valued.filter((position) => position.asset.cls === 'CASH' && position.value < -0.005)
  if (negativeCash.length > 0) {
    issues.push({
      id: 'negative-cash',
      severity: 'BLOCKING',
      category: '账本一致性',
      title: `${negativeCash.length} 个账户出现负现金`,
      detail: '通常由缺少入金、结算账户配置不完整或历史流水顺序错误造成，请从对应账户流水核对。',
      metric: fmtCNY(negativeCash.reduce((sum, item) => sum + item.value, 0)),
      href: '/transactions',
      action: '核对流水',
    })
  }

  const unsettledAccounts = accounts.filter((account) => (
    (account.type === 'BROKERAGE' || account.type === 'FUND') && !account.settlementAccountId
  ))
  if (unsettledAccounts.length > 0) {
    issues.push({
      id: 'unsettled-accounts',
      severity: 'WARNING',
      category: '资金结算',
      title: `${unsettledAccounts.length} 个投资账户未配置资金账户`,
      detail: unsettledAccounts.map((account) => account.name).join('、'),
      metric: `${unsettledAccounts.length} 个账户`,
      href: '/accounts',
      action: '配置结算',
    })
  }

  const estimatedNav = state.ledgerTxs.filter((tx) => (
    !tx.voidedAt && tx.assetClass === 'FUND' && (tx.navSource === 'ESTIMATE' || tx.navSource === 'PENDING')
  ))
  if (estimatedNav.length > 0) {
    issues.push({
      id: 'estimated-nav',
      severity: 'WARNING',
      category: '基金确认',
      title: `${estimatedNav.length} 笔基金净值或份额待确认`,
      detail: '官方成交净值到达后应确认替换；系统会保留原记录的冲正链。',
      metric: `${estimatedNav.length} 笔`,
      href: '/fund-confirmations',
      action: '核对份额',
    })
  }

  if (state.pendingSettlements.length > 0) {
    issues.push({
      id: 'pending-settlement',
      severity: 'INFO',
      category: '在途资金',
      title: `${state.pendingSettlements.length} 笔赎回资金尚未到账`,
      detail: `最晚预计 ${fmtDate([...state.pendingSettlements].sort((a, b) => b.settlementDate.getTime() - a.settlementDate.getTime())[0].settlementDate)} 到账；当前已计入净资产与可投资口径。`,
      metric: fmtCNY(state.redemptionInTransit),
      href: '/accounts?view=calendar',
      action: '查看日历',
    })
  }

  const failedRows = failedImports.reduce((sum, batch) => sum + batch.failedCount, 0)
  if (failedRows > 0) {
    issues.push({
      id: 'failed-imports',
      severity: 'WARNING',
      category: '数据导入',
      title: `最近导入有 ${failedRows} 行未成功`,
      detail: '失败行不会进入账本；请修正原文件后重新导入，系统会按文件内容识别重复批次。',
      metric: `${failedImports.length} 个批次`,
      href: '/transactions/imports',
      action: '查看导入',
    })
  }

  if (!chain.ok) {
    issues.push({
      id: 'audit-chain',
      severity: 'BLOCKING',
      category: '审计完整性',
      title: '审计链校验未通过',
      detail: '存在记录脱节或内容被改动，继续写入前应先核对数据库与最近备份。',
      metric: `${chain.count} 条记录`,
      href: '/audit',
      action: '查看审计',
    })
  }

  if (allocationTargetCount === 0) {
    issues.push({
      id: 'allocation-target',
      severity: 'INFO',
      category: '计划完整性',
      title: '尚未设置资产配置目标',
      detail: '建立目标后，系统才能区分正常波动与需要核对的配置偏离。',
      metric: '未配置',
      href: '/allocation',
      action: '设置目标',
    })
  }

  const reconciledAccountIds = new Set(reconciliationLogs.flatMap((log) => log.entityId ? [log.entityId] : []))
  const unreconciledAccounts = accounts.filter((account) => !reconciledAccountIds.has(account.id))
  if (unreconciledAccounts.length > 0) {
    issues.push({
      id: 'account-reconciliation',
      severity: 'INFO',
      category: '外部核对',
      title: `${unreconciledAccounts.length} 个账户尚未建立外部余额凭证`,
      detail: `可从券商、银行或基金平台账单录入核对时点：${unreconciledAccounts.slice(0, 4).map((account) => account.name).join('、')}。`,
      metric: `${accounts.length - unreconciledAccounts.length}/${accounts.length}`,
      href: '/reconciliation',
      action: '开始对账',
    })
  }

  const confirmedSettlementIds = new Set(settlementConfirmations.flatMap((log) => log.entityId ? [log.entityId] : []))
  const dueFundSettlements = fundEvents.filter((tx) => (
    tx.type === 'SELL'
    && tx.settlementDate != null
    && tx.settlementDate.getTime() <= Date.now()
    && !confirmedSettlementIds.has(tx.id)
  ))
  const actionableFundEvents = fundEvents.filter((tx) => (
    tx.navSource === 'ESTIMATE' || tx.navSource === 'PENDING'
    || (tx.type === 'SELL' && tx.settlementDate != null && !confirmedSettlementIds.has(tx.id))
  ))
  if (dueFundSettlements.length > 0) {
    issues.push({
      id: 'fund-settlement-confirmation',
      severity: 'WARNING',
      category: '基金确认',
      title: `${dueFundSettlements.length} 笔基金赎回已到预计到账日`,
      detail: '账本已按预计日期计入现金，请与基金平台或银行入账记录核对后确认；如金额不一致，请冲正原流水。',
      metric: `${dueFundSettlements.length} 笔`,
      href: '#fund-confirmation',
      action: '核对到账',
    })
  }

  const latestRefresh = refreshLogs[0]
  const latestRefreshJobFailed = (latestRefresh?.detail ?? '').includes('JOB_FAILED')
  const latestRefreshFailures = latestRefresh
    ? [...(latestRefresh.detail ?? '').matchAll(/:FAILED:/g)].length
    : 0
  if (latestRefreshJobFailed || latestRefreshFailures > 0) {
    issues.push({
      id: 'market-refresh-failed',
      severity: 'WARNING',
      category: '行情刷新',
      title: latestRefreshJobFailed ? '最近一次行情刷新任务失败' : `最近一次行情刷新有 ${latestRefreshFailures} 项失败`,
      detail: `失败记录时间 ${fmtDateTime(latestRefresh!.createdAt)}。请先核对行情来源与受影响持仓，再决定是否人工补齐。`,
      metric: latestRefreshJobFailed ? '任务失败' : `${latestRefreshFailures} 项`,
      href: '/health/market',
      action: '检查行情',
    })
  }

  const order: Record<Severity, number> = { BLOCKING: 0, WARNING: 1, INFO: 2 }
  const impactOrder = [
    'audit-chain', 'negative-cash', 'missing-quotes', 'market-refresh-failed',
    'period-valuation-gaps', 'estimated-nav', 'fund-settlement-confirmation',
    'failed-imports', 'missing-manual-valuations', 'stale-manual',
    'unsettled-accounts', 'pending-settlement', 'account-reconciliation', 'allocation-target',
  ]
  issues.sort((a, b) => order[a.severity] - order[b.severity]
    || impactOrder.indexOf(a.id) - impactOrder.indexOf(b.id))
  const blocking = issues.filter((issue) => issue.severity === 'BLOCKING').length
  const warnings = issues.filter((issue) => issue.severity === 'WARNING').length
  const infos = issues.filter((issue) => issue.severity === 'INFO').length
  const healthState = blocking > 0 ? '存在影响口径的问题' : warnings > 0 ? '数据可用，但有待核对项' : '核心数据状态良好'
  const providerStats = marketHealth().providers
  const latestSnapshotAge = latestSnapshot ? Math.floor((Date.now() - latestSnapshot.date.getTime()) / 86400000) : null

  return (
    <div className="page-shell health-page">
      <header className="health-header">
        <div><h1>数据健康中心</h1></div>
        <div className="flex gap-6"><Link href="/health/market">行情质量 →</Link><Link href="/audit">审计记录 →</Link></div>
      </header>
      <GovernanceNav active="health" />

      <section className={cx('health-status-hero', blocking > 0 ? 'is-blocking' : warnings > 0 ? 'is-warning' : 'is-healthy')}>
        <div className="health-status-main">
          <span>当前判断</span>
          <h2>{healthState}</h2>
          <p>检查时间 {fmtDate(new Date())} · 估值覆盖 {fmtPct(dashboard.review.valuationCoverage)} · 审计链 {chain.ok ? '完整' : '异常'}</p>
        </div>
        <div className="health-status-counts">
          <div><strong className="num">{blocking}</strong><span>需处理</span></div>
          <div><strong className="num">{warnings}</strong><span>需核对</span></div>
          <div><strong className="num">{infos}</strong><span>提醒</span></div>
        </div>
        <div className="health-status-rail" aria-hidden="true">
          {/* 按真实计数渲染：没有该项时不显示对应色段 */}
          {blocking > 0 && <i className="is-blocking" style={{ flexGrow: blocking }} />}
          {warnings > 0 && <i className="is-warning" style={{ flexGrow: warnings }} />}
          {infos > 0 && <i className="is-info" style={{ flexGrow: infos }} />}
          {issues.length === 0 && <i className="is-empty" style={{ flexGrow: 1 }} />}
        </div>
      </section>

      <section className="health-layout">
        <div className="health-issue-panel">
          <header><div><h2>待办检查</h2></div><span>{issues.length} 项</span></header>
          {issues.length === 0 ? (
            <div className="health-empty"><strong>没有待处理的数据问题</strong><p>账本、估值、账户结算和审计链均通过当前检查。</p></div>
          ) : (
            <div className="health-issue-list">
              {issues.map((issue) => (
                <article key={issue.id} className={`is-${issue.severity.toLowerCase()}`}>
                  <div className="health-issue-state"><i /><span>{SEVERITY_LABEL[issue.severity]}</span></div>
                  <div className="health-issue-copy"><span>{issue.category}</span><h3>{issue.title}</h3><p>{issue.detail}</p></div>
                  <strong className="num health-issue-metric">{issue.metric}</strong>
                  <Link href={issue.href}>{issue.action} →</Link>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="health-evidence-panel">
          <header><h2>检查依据</h2></header>
          <div className="health-evidence-list">
            <div><span>组合估值覆盖</span><strong className="num">{fmtPct(dashboard.review.valuationCoverage)}</strong><small>{dashboard.review.valuationGapCount} 项缺口</small></div>
            <div><span>最近快照</span><strong className="num">{latestSnapshot ? fmtDate(latestSnapshot.date) : '—'}</strong><small>{latestSnapshotAge == null ? '尚无快照' : latestSnapshotAge === 0 ? '今天已生成' : `${latestSnapshotAge} 天前`}</small></div>
            <div><span>审计链</span><strong>{chain.ok ? '完整' : '异常'}</strong><small>{chain.count} 条记录已校验</small></div>
            <div><span>行情源运行记录</span><strong>{providerStats.length > 0 ? `${providerStats.length} 个源` : '尚无请求'}</strong><small><Link href="/health/market" className="text-accent">查看持久化日度证据</Link></small></div>
          </div>
          {providerStats.length > 0 && (
            <div className="health-provider-list">
              {providerStats.slice(0, 5).map((provider) => {
                const rate = provider.requests > 0 ? provider.ok / provider.requests : null
                return <div key={provider.provider}><span>{provider.provider}</span><Tag tone={rate === 1 ? 'down' : rate != null && rate > 0 ? 'amber' : 'up'}>{fmtPct(rate)}</Tag></div>
              })}
            </div>
          )}
        </aside>
      </section>

      <details id="market-jobs" className="health-maintenance">
        <summary>
          <div><h2>行情任务中心</h2><span>定时刷新、运行记录与人工修复</span></div>
          <small className="num">06:30 · 16:30 · 22:30</small>
        </summary>
        <div className="health-maintenance-body">
          {dashboard.ctx.role === 'VIEWER' && <ReadOnlyNotice what="可以查看行情任务与检查依据，但不能手动补齐行情或重建快照" />}
          {dashboard.ctx.role !== 'VIEWER' && (
            <section className="health-repair-strip">
              <div><strong title="服务器按市场收盘时段自动增量刷新；人工修复不会改写交易流水">需要时手动补齐</strong></div>
              <HealthRepairActions />
            </section>
          )}
          <section className="health-job-center">
            <div className="health-job-grid">
              <div className="health-job-schedule"><div><b className="num">06:30</b><span>美股收盘与外汇</span></div><div><b className="num">16:30</b><span>A/H 股收盘</span></div><div><b className="num">22:30</b><span>基金官方净值</span></div></div>
              <div className="health-job-timeline">
                {refreshLogs.length === 0 ? <p>尚无刷新记录。</p> : refreshLogs.map((log) => {
                  const jobFailed = (log.detail ?? '').includes('JOB_FAILED')
                  const failed = [...(log.detail ?? '').matchAll(/:FAILED:/g)].length
                  return <article key={log.id}><i className={jobFailed || failed > 0 ? 'is-warning' : 'is-ok'} /><time className="num">{fmtDateTime(log.createdAt)}</time><strong>{jobFailed ? '任务失败' : failed > 0 ? `${failed} 个标的失败` : '刷新完成'}</strong><span>{log.actorName}</span></article>
                })}
              </div>
            </div>
          </section>
        </div>
      </details>

      <section id="fund-confirmation" className="health-confirmation-center">
        <header><div><h2>基金确认闭环</h2></div><Link href="/fund-confirmations">进入份额核对 →</Link></header>
        <div className="health-confirmation-list">
          {actionableFundEvents.length === 0 ? <div className="health-empty"><strong>没有待确认的基金事件</strong><p>估算净值与赎回到账均已闭环。</p></div> : actionableFundEvents.map((tx) => {
            const isEstimate = tx.navSource === 'ESTIMATE' || tx.navSource === 'PENDING'
            const isSettlement = tx.type === 'SELL' && tx.settlementDate != null
            const settlementConfirmed = confirmedSettlementIds.has(tx.id)
            const settlementDue = tx.settlementDate != null && tx.settlementDate.getTime() <= Date.now()
            if (!isEstimate && (!isSettlement || settlementConfirmed)) return null
            return <article key={tx.id}><div><span>{isEstimate ? tx.navSource === 'PENDING' ? '份额待确认' : '待官方净值' : settlementDue ? '待确认到账' : '等待到账日'}</span><strong>{tx.asset.name}</strong><small>{tx.account.name} · 交易 {fmtDate(tx.occurredAt)}{tx.settlementDate ? ` · 预计到账 ${fmtDate(tx.settlementDate)}` : ''}</small></div><b className="num">{fmtCNY(Number(tx.amount))}</b><div>{isEstimate && <Link href={`/fund-confirmations?transaction=${tx.id}`} className="text-[13px] text-accent">核对份额</Link>}{!isEstimate && isSettlement && settlementDue && dashboard.ctx.role !== 'VIEWER' && <ConfirmFundSettlementButton id={tx.id} />}</div></article>
          })}
        </div>
      </section>
    </div>
  )
}
