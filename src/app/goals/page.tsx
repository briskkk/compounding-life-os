// 目标页：蒙特卡洛路径带 + 达成概率 + 假设编辑
import { getSession } from '@/lib/session'
import { loadEngineState, loadGoals } from '@/lib/queries'
import { Panel, SetupScreen, Tag } from '@/components/ui'
import { ProjectionChart, type ProjectionDatum } from '@/components/charts'
import { GoalForm } from '@/components/goal-form'
import { GOAL_METRIC_LABEL } from '@/lib/labels'
import { cx, fmtCNY, fmtDate, fmtPct } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function GoalsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const state = await loadEngineState(ctx)
  const goals = await loadGoals(ctx, state)
  const now = new Date()

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {goals.map((g) => {
          const data: ProjectionDatum[] = g.projection.points
            .filter((_, i) => i % Math.ceil(g.projection.points.length / 120) === 0 || i === g.projection.points.length - 1)
            .map((p) => {
              const dt = new Date(now)
              dt.setMonth(dt.getMonth() + p.month)
              return {
                label: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`,
                base: Math.round(p.p10),
                band: Math.round(p.p90 - p.p10),
                p50: Math.round(p.p50),
                target: g.targetAmount,
              }
            })
          const prob = g.projection.successProb
          return (
            <Panel
              key={g.id}
              title={g.name}
              en={GOAL_METRIC_LABEL[g.metric]}
              right={<Tag tone={prob >= 0.7 ? 'down' : prob >= 0.45 ? 'amber' : 'up'}>达成概率 {fmtPct(prob)}</Tag>}
            >
              {g.mode === 'STREAM' && (
                <div className="mb-3 flex items-center gap-2 text-[11px] text-ink-faint">
                  <Tag tone="violet">支出流</Tag>
                  自 {fmtDate(g.targetDate)} 起每年支出 <span className="num text-ink">{fmtCNY(g.annualSpend ?? 0)}</span> · 共 {g.spendYears} 年
                  · 名义总额 <span className="num text-ink">{fmtCNY(g.targetAmount)}</span>
                </div>
              )}
              <ProjectionChart data={data} target={g.mode === 'STREAM' ? 0 : g.targetAmount} targetLabel={g.mode === 'STREAM' ? '断供线' : '目标'} />
              <div className="mt-3 grid grid-cols-4 gap-3 border-t border-line pt-3 text-center">
                <div>
                  <div className="num text-sm text-ink">{fmtCNY(g.current)}</div>
                  <div className="mt-0.5 text-[10px] text-ink-faint">当前（{GOAL_METRIC_LABEL[g.metric].slice(0, 4)}）</div>
                </div>
                <div>
                  <div className="num text-sm text-ink">{fmtCNY(g.projection.projectedMedian)}</div>
                  <div className="mt-0.5 text-[10px] text-ink-faint">{g.mode === 'STREAM' ? '支出期末中位余值' : '到期中位'}</div>
                </div>
                <div>
                  <div className="num text-sm text-ink">{g.monthsLeft} 月</div>
                  <div className="mt-0.5 text-[10px] text-ink-faint">剩余 {fmtDate(g.targetDate)}</div>
                </div>
                <div>
                  <div className={cx('num text-sm', g.projection.requiredMonthly > g.monthlyContribution ? 'text-amber' : 'text-ink')}>
                    {fmtCNY(g.projection.requiredMonthly)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-faint">达标所需月缴</div>
                </div>
              </div>
              <GoalForm
                mode="edit"
                goalId={g.id}
                initial={{
                  name: g.name,
                  mode: g.mode,
                  targetAmount: g.targetAmount,
                  targetDate: g.targetDate.slice(0, 10),
                  annualSpend: g.annualSpend,
                  spendYears: g.spendYears,
                  metric: g.metric,
                  monthlyContribution: g.monthlyContribution,
                  expectedReturn: g.expectedReturn,
                  volatility: g.volatility,
                  note: g.note ?? '',
                }}
              />
            </Panel>
          )
        })}

        <Panel title="新建目标" en="NEW GOAL">
          <GoalForm mode="create" />
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
            预测基于 1500 条蒙特卡洛路径（月度步进）：有持仓时按实际类别权重做协方差组合模拟（Cholesky 相关冲击），
            否则退回单因子正态模型。「达标所需月缴」由确定性中位路径反解；支出流目标的成功口径为「支出期全程不断供」。
          </p>
        </Panel>
      </div>
    </div>
  )
}
