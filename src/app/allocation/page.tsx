import Link from 'next/link'
import { getSession } from '@/lib/session'
import { loadEngineState } from '@/lib/queries'
import { prisma } from '@/lib/db'
import { scopedDb } from '@/lib/scoped'
import { PageHeader, SetupScreen, Tag, ReadOnlyNotice } from '@/components/ui'
import { AllocationTargetEditor } from '@/components/allocation-target-editor'
import { ALLOCATION_TARGET_CLASSES, buildAllocationDrift } from '@/lib/engine/allocation-drift'
import { ASSET_CLASS_LABEL } from '@/lib/labels'
import { CLASS_COLORS } from '@/lib/colors'
import { cx, fmtCNY, fmtPct } from '@/lib/format'
import { AssetDomainNav } from '@/components/asset-domain-nav'
import { StrategyTargetEditor } from '@/components/strategy-target-editor'
import { buildStrategyDrift, strategyName, UNASSIGNED_STRATEGY } from '@/lib/engine/strategy-allocation'
import { isInvestableAsset } from '@/lib/asset-classification'

export const dynamic = 'force-dynamic'

function statusLabel(status: 'IN_RANGE' | 'OVER' | 'UNDER'): string {
  if (status === 'OVER') return '高于目标'
  if (status === 'UNDER') return '低于目标'
  return '范围内'
}

export default async function AllocationPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [state, savedTargets, strategyTargets, assets] = await Promise.all([
    loadEngineState(ctx),
    db.allocationTarget.findMany({ orderBy: { cls: 'asc' } }),
    db.strategyTarget.findMany({ orderBy: { name: 'asc' } }),
    db.asset.findMany({ select: { id: true, strategyGroup: true } }),
  ])
  const strategyByAsset = new Map(assets.map((asset) => [asset.id, asset.strategyGroup]))
  const strategyCurrent = state.valued
    .filter((position) => isInvestableAsset(position.asset) && position.investable > 0.005)
    .map((position) => ({ name: strategyName(strategyByAsset.get(position.assetId)), amount: position.investable }))
  for (const pending of state.pendingFundPurchases) {
    strategyCurrent.push({ name: strategyName(strategyByAsset.get(pending.assetId)), amount: pending.amount })
  }
  if (state.redemptionInTransit > 0) strategyCurrent.push({ name: UNASSIGNED_STRATEGY, amount: state.redemptionInTransit })
  const strategyDrift = buildStrategyDrift(strategyCurrent, strategyTargets)
  const activeView = params.view === 'strategy' || (params.view !== 'class' && strategyTargets.length > 0) ? 'strategy' : 'class'
  const current = state.valued
    .filter((position) => position.investable > 0.005)
    .map((position) => ({ cls: position.asset.cls, amount: position.investable }))
  if (state.purchaseInTransit > 0) current.push({ cls: 'FUND', amount: state.purchaseInTransit })
  const drift = buildAllocationDrift(
    current,
    savedTargets.map((target) => ({
      cls: target.cls,
      targetWeight: target.targetWeight,
      tolerance: target.tolerance,
    })),
    state.redemptionInTransit,
  )
  const canWrite = ctx.role !== 'VIEWER'

  const initialWeights = ALLOCATION_TARGET_CLASSES.map((cls) => ({
    cls,
    weightPct: Number(((savedTargets.find((target) => target.cls === cls)?.targetWeight
      ?? drift.rows.find((row) => row.cls === cls)?.currentWeight
      ?? 0) * 100).toFixed(1)),
  }))
  if (savedTargets.length === 0 && drift.currentTotal > 0) {
    const total = initialWeights.reduce((sum, item) => sum + item.weightPct, 0)
    const largest = [...initialWeights].sort((a, b) => b.weightPct - a.weightPct)[0]
    if (largest) largest.weightPct = Number((largest.weightPct + 100 - total).toFixed(1))
  }
  const tolerancePct = Number(((savedTargets[0]?.tolerance ?? 0.03) * 100).toFixed(1))

  if (activeView === 'strategy') {
    const strategyRows = strategyDrift.rows.length > 0 ? [...strategyDrift.rows] : []
    if (!strategyRows.some((row) => row.name === UNASSIGNED_STRATEGY)) {
      strategyRows.push({ name: UNASSIGNED_STRATEGY, currentAmount: 0, currentWeight: 0, targetWeight: 0, tolerance: 0.03, driftWeight: 0, status: 'IN_RANGE' })
    }
    const initial = strategyRows.map((row) => ({
      name: row.name,
      currentPct: row.currentWeight * 100,
      weightPct: Number(((strategyDrift.configured ? row.targetWeight : row.currentWeight) * 100).toFixed(1)),
    }))
    if (!strategyDrift.configured && strategyDrift.currentTotal > 0) {
      const largest = [...initial].sort((a, b) => b.weightPct - a.weightPct)[0]
      if (largest) largest.weightPct = Number((largest.weightPct + 100 - initial.reduce((sum, row) => sum + row.weightPct, 0)).toFixed(1))
    }
    return (
      <div className="page-shell allocation-page">
        <PageHeader title="自定义组合配置" description="按组合分组设置目标权重与容忍带。" right={<Link href="/positions?view=composition" className="allocation-back-link">整理资产分组 →</Link>} />
        <AssetDomainNav active="allocation" />
        <nav className="flex gap-2" aria-label="配置目标维度"><Link href="/allocation?view=strategy" aria-current="page" className="rounded border border-accent px-4 py-2 text-accent">自定义组合</Link><Link href="/allocation?view=class" className="rounded border border-line px-4 py-2 text-ink-dim">资产大类</Link></nav>
        <section className={cx('allocation-status-hero', !strategyDrift.configured && 'is-unconfigured')}>
          <div className="allocation-status-copy"><h2>{!strategyDrift.configured ? '尚未设置自定义组合目标' : strategyDrift.outOfRangeCount === 0 ? '各分组处于目标范围' : `${strategyDrift.outOfRangeCount} 个分组偏离目标`}</h2><p>先在结构分析中分组，再设置全天候组合权重。</p></div>
          <div className="allocation-status-metrics"><div><span>可投资组合</span><strong className="num">{fmtCNY(strategyDrift.currentTotal)}</strong></div><div><span>目标合计</span><strong className="num">{strategyDrift.configured ? fmtPct(strategyDrift.targetTotal) : '待设置'}</strong></div><div><span>待分组</span><strong className="num">{fmtCNY(strategyDrift.rows.find((row) => row.name === UNASSIGNED_STRATEGY)?.currentAmount ?? 0)}</strong></div></div>
        </section>
        <section className="allocation-workbench">
          <div className="allocation-drift-panel"><header><div><h2>当前与目标</h2></div>{strategyDrift.configured && <Tag tone={strategyDrift.outOfRangeCount > 0 ? 'amber' : 'down'}>{strategyDrift.outOfRangeCount > 0 ? '需要核对' : '范围内'}</Tag>}</header><div className="allocation-drift-rows">{strategyRows.map((row) => {
            const scale = Math.max(row.currentWeight, row.targetWeight, 0.01)
            return <div key={row.name} className="allocation-drift-row"><div className="allocation-drift-label"><i style={{ background: row.name === UNASSIGNED_STRATEGY ? '#94a3b8' : '#4776b8' }} /><div><strong>{row.name}</strong><span className="num">{fmtCNY(row.currentAmount)}</span></div></div><div className="allocation-drift-bars"><div><span>当前</span><i style={{ width: `${row.currentWeight / scale * 100}%`, background: '#4776b8' }} /><b className="num">{fmtPct(row.currentWeight)}</b></div><div><span>目标</span><i style={{ width: `${row.targetWeight / scale * 100}%` }} /><b className="num">{strategyDrift.configured ? fmtPct(row.targetWeight) : '—'}</b></div></div><div className={cx('allocation-drift-result', strategyDrift.configured && `is-${row.status.toLowerCase()}`)}><strong className="num">{strategyDrift.configured ? fmtPct(row.driftWeight, { sign: true }) : '—'}</strong><span>{strategyDrift.configured ? statusLabel(row.status) : '未设目标'}</span></div></div>
          })}</div><p className="allocation-scope-note"><span>待确认申购归入所属组；赎回在途归入未分组。</span><span className="ml-2">历史收益按当前分组重算。</span></p></div>
          <aside className="allocation-editor-panel"><header><h2>设置分组目标</h2></header>{canWrite ? <StrategyTargetEditor initial={initial} configured={strategyDrift.configured} tolerancePct={Number(((strategyTargets[0]?.tolerance ?? 0.03) * 100).toFixed(1))} /> : <ReadOnlyNotice what="可以查看偏离，但不能修改组合目标" className="allocation-readonly" />}</aside>
        </section>
      </div>
    )
  }

  return (
    <div className="page-shell allocation-page">
      <PageHeader
        title="目标配置偏离"
        description="把当前可投资资产与自己设定的资产大类目标对照。偏离只用于观察，不会生成自动买卖或改写账本。"
        right={<Link href="/positions" className="allocation-back-link">返回持仓 →</Link>}
      />

      <AssetDomainNav active="allocation" />
      <nav className="flex gap-2" aria-label="配置目标维度"><Link href="/allocation?view=strategy" className="rounded border border-line px-4 py-2 text-ink-dim">自定义组合</Link><Link href="/allocation?view=class" aria-current="page" className="rounded border border-accent px-4 py-2 text-accent">资产大类</Link></nav>

      <section className={cx('allocation-status-hero', !drift.configured && 'is-unconfigured')}>
        <div className="allocation-status-copy">
          <h2>{!drift.configured ? '尚未建立配置基准' : drift.outOfRangeCount === 0 ? '配置处于目标范围' : `${drift.outOfRangeCount} 类资产超出容忍带`}</h2>
          <p>{!drift.configured
            ? '下方已用当前配置预填，确认或调整为你的长期目标后即可开始追踪。'
            : drift.largestDrift
              ? `最大偏离来自${ASSET_CLASS_LABEL[drift.largestDrift.cls]}，与目标相差 ${fmtPct(Math.abs(drift.largestDrift.driftWeight))}。`
              : '当前各资产大类均在你设定的容忍范围内。'}</p>
        </div>
        <div className="allocation-status-metrics">
          <div><span>可投资资产</span><strong className="num">{fmtCNY(drift.currentTotal)}</strong></div>
          <div><span>目标合计</span><strong className="num">{drift.configured ? fmtPct(drift.targetTotal) : '待设置'}</strong></div>
          <div><span>容忍带</span><strong className="num">±{tolerancePct.toFixed(1)}%</strong></div>
        </div>
        <div className="allocation-signal-rail" aria-hidden="true">
          <i className={drift.configured && drift.outOfRangeCount > 0 ? 'is-alert' : 'is-idle'} />
          <i className={drift.configured && drift.outOfRangeCount > 0 ? 'is-current' : 'is-idle'} />
          <i className={drift.configured && drift.outOfRangeCount === 0 ? 'is-current' : 'is-idle'} />
        </div>
      </section>

      <section className="allocation-workbench">
        <div className="allocation-drift-panel">
          <header>
            <div><h2>当前与目标</h2></div>
            {drift.configured && <Tag tone={drift.outOfRangeCount > 0 ? 'amber' : 'down'}>{drift.outOfRangeCount > 0 ? '需要核对' : '范围内'}</Tag>}
          </header>
          <div className="allocation-drift-rows">
            {drift.rows.map((row) => {
              const maxScale = Math.max(row.currentWeight, row.targetWeight, 0.01)
              return (
                <div key={row.cls} className="allocation-drift-row">
                  <div className="allocation-drift-label">
                    <i style={{ background: CLASS_COLORS[row.cls] }} />
                    <div><strong>{ASSET_CLASS_LABEL[row.cls]}</strong><span className="num">{fmtCNY(row.currentAmount)}</span></div>
                  </div>
                  <div className="allocation-drift-bars">
                    <div><span>当前</span><i style={{ width: `${row.currentWeight / maxScale * 100}%`, background: CLASS_COLORS[row.cls] }} /><b className="num">{fmtPct(row.currentWeight)}</b></div>
                    <div><span>目标</span><i style={{ width: `${row.targetWeight / maxScale * 100}%` }} /><b className="num">{drift.configured ? fmtPct(row.targetWeight) : '—'}</b></div>
                  </div>
                  <div className={cx('allocation-drift-result', drift.configured && `is-${row.status.toLowerCase()}`)}>
                    <strong className="num">{drift.configured ? fmtPct(row.driftWeight, { sign: true }) : '—'}</strong>
                    <span>{drift.configured ? statusLabel(row.status) : '未设目标'}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="allocation-scope-note">申购待确认金额按基金计入，在途赎回按现金计入；房产、华为股票及其他不可投资资产不参与本页配置比例。</p>
        </div>

        <aside className="allocation-editor-panel">
          <header><h2>设置目标</h2></header>
          {canWrite ? (
            <AllocationTargetEditor initial={initialWeights} tolerancePct={tolerancePct} />
          ) : (
            <ReadOnlyNotice what="可以查看偏离，但不能修改目标配置" className="allocation-readonly" />
          )}
        </aside>
      </section>
    </div>
  )
}
