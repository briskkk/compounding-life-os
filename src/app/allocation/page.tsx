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

export const dynamic = 'force-dynamic'

function statusLabel(status: 'IN_RANGE' | 'OVER' | 'UNDER'): string {
  if (status === 'OVER') return '高于目标'
  if (status === 'UNDER') return '低于目标'
  return '范围内'
}

export default async function AllocationPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const db = scopedDb(prisma, ctx)
  const [state, savedTargets] = await Promise.all([
    loadEngineState(ctx),
    db.allocationTarget.findMany({ orderBy: { cls: 'asc' } }),
  ])
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

  return (
    <div className="page-shell allocation-page">
      <PageHeader
        title="目标配置偏离"
        description="把当前可投资资产与自己设定的资产大类目标对照。偏离只用于观察，不会生成自动买卖或改写账本。"
        right={<Link href="/positions" className="allocation-back-link">返回持仓 →</Link>}
      />

      <AssetDomainNav active="allocation" />

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
