import Link from 'next/link'
import { getDashboard } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { verifyChain } from '@/lib/audit'
import { marketHealth } from '@/lib/market/cache'
import { SetupScreen, Tag } from '@/components/ui'
import { cx, fmtCNY, fmtDate, fmtPct } from '@/lib/format'

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
  const [accounts, latestSnapshot, failedImports, allocationTargetCount, chain] = await Promise.all([
    db.account.findMany({ orderBy: { createdAt: 'asc' } }),
    db.snapshot.findFirst({ orderBy: { date: 'desc' } }),
    db.importBatch.findMany({ where: { failedCount: { gt: 0 } }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.allocationTarget.count(),
    verifyChain(prisma, dashboard.ctx.familyId),
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

  const estimatedNav = state.ledgerTxs.filter((tx) => !tx.voidedAt && tx.assetClass === 'FUND' && tx.navSource === 'ESTIMATE')
  if (estimatedNav.length > 0) {
    issues.push({
      id: 'estimated-nav',
      severity: 'WARNING',
      category: '基金确认',
      title: `${estimatedNav.length} 笔基金交易仍使用估算净值`,
      detail: '官方成交净值到达后应确认替换；系统会保留原估算记录的冲正链。',
      metric: `${estimatedNav.length} 笔`,
      href: '/transactions',
      action: '确认净值',
    })
  }

  if (state.pendingSettlements.length > 0) {
    issues.push({
      id: 'pending-settlement',
      severity: 'INFO',
      category: '在途资金',
      title: `${state.pendingSettlements.length} 笔赎回资金尚未到账`,
      detail: `最晚预计 ${fmtDate([...state.pendingSettlements].sort((a, b) => b.settlementDate.getTime() - a.settlementDate.getTime())[0].settlementDate)} 到账；当前已计入净资产与可投资口径。`,
      metric: fmtCNY(state.inTransit),
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
      href: '/transactions',
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

  const order: Record<Severity, number> = { BLOCKING: 0, WARNING: 1, INFO: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])
  const blocking = issues.filter((issue) => issue.severity === 'BLOCKING').length
  const warnings = issues.filter((issue) => issue.severity === 'WARNING').length
  const infos = issues.filter((issue) => issue.severity === 'INFO').length
  const healthState = blocking > 0 ? '存在影响口径的问题' : warnings > 0 ? '数据可用，但有待核对项' : '核心数据状态良好'
  const providerStats = marketHealth().providers
  const latestSnapshotAge = latestSnapshot ? Math.floor((Date.now() - latestSnapshot.date.getTime()) / 86400000) : null

  return (
    <div className="page-shell health-page">
      <header className="health-header">
        <div><span className="eyebrow">Data confidence center</span><h1>数据健康中心</h1><p>集中查看哪些数字可以直接使用、哪些仍依赖成本回落、手工估值或待确认事件。</p></div>
        <Link href="/audit">审计记录 →</Link>
      </header>

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
        <div className="health-status-rail"><i /><i /><i /></div>
      </section>

      <section className="health-layout">
        <div className="health-issue-panel">
          <header><div><span className="eyebrow">Action queue</span><h2>待办检查</h2></div><span>{issues.length} 项</span></header>
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
          <header><span className="eyebrow">Evidence</span><h2>检查依据</h2></header>
          <div className="health-evidence-list">
            <div><span>组合估值覆盖</span><strong className="num">{fmtPct(dashboard.review.valuationCoverage)}</strong><small>{dashboard.review.valuationGapCount} 项缺口</small></div>
            <div><span>最近快照</span><strong className="num">{latestSnapshot ? fmtDate(latestSnapshot.date) : '—'}</strong><small>{latestSnapshotAge == null ? '尚无快照' : latestSnapshotAge === 0 ? '今天已生成' : `${latestSnapshotAge} 天前`}</small></div>
            <div><span>审计链</span><strong>{chain.ok ? '完整' : '异常'}</strong><small>{chain.count} 条记录已校验</small></div>
            <div><span>行情源运行记录</span><strong>{providerStats.length > 0 ? `${providerStats.length} 个源` : '尚无请求'}</strong><small>仅显示本进程实际调用结果</small></div>
          </div>
          {providerStats.length > 0 && (
            <div className="health-provider-list">
              {providerStats.slice(0, 5).map((provider) => {
                const rate = provider.requests > 0 ? provider.ok / provider.requests : null
                return <div key={provider.provider}><span>{provider.provider}</span><Tag tone={rate === 1 ? 'down' : rate != null && rate > 0 ? 'amber' : 'up'}>{fmtPct(rate)}</Tag></div>
              })}
            </div>
          )}
          <p className="health-evidence-note">健康中心只诊断并提供修复入口，不会自动修改流水、估值或目标配置。</p>
        </aside>
      </section>
    </div>
  )
}
