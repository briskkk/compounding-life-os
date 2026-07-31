// 目标页：主目标概率 + 置信区间 + 其他目标列表
import { getSession } from '@/lib/session'
import { loadEngineState, loadGoals } from '@/lib/queries'
import { Empty, Panel, SetupScreen, Tag } from '@/components/ui'
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
  const goalViews = goals.map((goal) => {
    const data: ProjectionDatum[] = goal.projection.points
      .filter((_, index) => index % Math.ceil(goal.projection.points.length / 120) === 0 || index === goal.projection.points.length - 1)
      .map((point) => {
        const date = new Date(now)
        date.setMonth(date.getMonth() + point.month)
        return {
          label: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
          base: Math.round(point.p10),
          band: Math.round(point.p90 - point.p10),
          p50: Math.round(point.p50),
          target: goal.targetAmount,
        }
      })
    return { goal, data }
  })
  const primary = goalViews[0]

  return (
    <div className="page-shell">
      {primary ? (
        <section className="border-b border-line pb-12">
          <div className="eyebrow">核心目标</div>
          <div className="mt-5 grid gap-12 xl:grid-cols-[0.45fr_1fr] xl:items-center">
            <div>
              <div className="mb-3"><Tag tone="info">{GOAL_METRIC_LABEL[primary.goal.metric]}</Tag></div>
              <h1 className="text-[clamp(2rem,4vw,3.5rem)] font-medium tracking-[-0.05em] text-ink">{primary.goal.name}</h1>
              <p className="mt-3 text-[15px] leading-7 text-ink-faint">为下一代的教育、事业与生活，持续创造确定性。</p>
              <div className="mt-9 text-[15px] text-ink-faint">达成概率</div>
              <div className="num mt-2 text-[58px] leading-none text-ink">{fmtPct(primary.goal.projection.successProb)}</div>
              <div className="mt-4 text-[14px] text-ink-faint">基于当前计划 · 距 {fmtDate(primary.goal.targetDate)} 尚有 {primary.goal.monthsLeft} 个月</div>
              <div className="mt-7 text-[15px] text-ink-faint">目标金额</div>
              <div className="num mt-2 text-[25px] text-ink">{fmtCNY(primary.goal.targetAmount)}</div>
            </div>
            <ProjectionChart data={primary.data} target={primary.goal.mode === 'STREAM' ? 0 : primary.goal.targetAmount} targetLabel={primary.goal.mode === 'STREAM' ? '断供线' : '目标'} />
          </div>

          <div className="metric-band mt-10">
            <div><div className="text-[14px] text-ink-faint">预期年化收益</div><div className="num mt-2 text-[18px] text-ink">{fmtPct(primary.goal.expectedReturn)}</div></div>
            <div><div className="text-[14px] text-ink-faint">年均波动</div><div className="num mt-2 text-[18px] text-ink">{fmtPct(primary.goal.volatility)}</div></div>
            <div><div className="text-[14px] text-ink-faint">每月追加投入</div><div className="num mt-2 text-[18px] text-ink">{fmtCNY(primary.goal.monthlyContribution)}</div></div>
            <div><div className="text-[14px] text-ink-faint">达标所需月缴</div><div className={cx('num mt-2 text-[18px]', primary.goal.projection.requiredMonthly > primary.goal.monthlyContribution ? 'text-amber' : 'text-ink')}>{fmtCNY(primary.goal.projection.requiredMonthly)}</div></div>
          </div>

          <details className="mt-6 border-y border-line py-4">
            <summary className="flex list-none items-center justify-between text-[15px] text-ink-dim [&::-webkit-details-marker]:hidden"><span>编辑核心目标与假设</span><span>＋</span></summary>
            <div className="mt-6">
              <GoalForm mode="edit" goalId={primary.goal.id} initial={{ name: primary.goal.name, mode: primary.goal.mode, targetAmount: primary.goal.targetAmount, targetDate: primary.goal.targetDate.slice(0, 10), annualSpend: primary.goal.annualSpend, spendYears: primary.goal.spendYears, metric: primary.goal.metric, monthlyContribution: primary.goal.monthlyContribution, expectedReturn: primary.goal.expectedReturn, volatility: primary.goal.volatility, note: primary.goal.note ?? '' }} />
            </div>
          </details>
        </section>
      ) : (
        <section className="grid gap-12 border-b border-line pb-12 xl:grid-cols-[0.75fr_1fr] xl:items-end">
          <div>
            <div className="page-kicker">Goals</div>
            <h1 className="mt-4 max-w-2xl text-[clamp(2.5rem,5vw,4.5rem)] font-medium leading-[1.05] tracking-[-0.06em] text-ink">把未来变成可计算的路径。</h1>
            <p className="mt-6 max-w-lg text-[14px] leading-7 text-ink-faint">建立第一个目标后，系统会以真实持仓和现金流为基础，持续计算达成概率、资金缺口与所需投入。</p>
            <a href="#new-goal" className="mt-9 inline-flex min-h-11 items-center border-b border-info text-[15px] font-medium text-info transition-colors hover:text-ink">建立第一个目标 →</a>
          </div>
          <div className="metric-band" aria-label="目标规划步骤">
            <div><div className="eyebrow">01 · 定义</div><div className="mt-3 text-[16px] text-ink">目标与日期</div></div>
            <div><div className="eyebrow">02 · 计算</div><div className="mt-3 text-[16px] text-ink">概率与缺口</div></div>
            <div><div className="eyebrow">03 · 跟踪</div><div className="mt-3 text-[16px] text-ink">投入与进度</div></div>
          </div>
        </section>
      )}

      {goalViews.length > 0 && (
        <Panel title="其他目标" en="OTHER GOALS">
          {goalViews.length <= 1 ? <Empty>尚无其他目标</Empty> : (
          <div className="quiet-list">
            {goalViews.slice(1).map(({ goal }) => (
              <details key={goal.id} className="group py-5">
                <summary className="grid list-none gap-4 md:grid-cols-[1fr_auto_auto_24px] md:items-center [&::-webkit-details-marker]:hidden">
                  <div><div className="flex items-center gap-2"><span className="font-medium text-ink">{goal.name}</span><Tag tone="info">{GOAL_METRIC_LABEL[goal.metric]}</Tag></div><div className="mt-1 text-[13px] text-ink-faint">目标 {fmtCNY(goal.targetAmount)} · {fmtDate(goal.targetDate)}</div></div>
                  <div className="num text-[14px] text-ink">当前 {fmtCNY(goal.current)}</div>
                  <div className="num text-[18px] text-gold">{fmtPct(goal.projection.successProb)}</div>
                  <span className="text-ink-faint transition-transform group-open:rotate-45">＋</span>
                </summary>
                <div className="mt-6">
                  <GoalForm mode="edit" goalId={goal.id} initial={{ name: goal.name, mode: goal.mode, targetAmount: goal.targetAmount, targetDate: goal.targetDate.slice(0, 10), annualSpend: goal.annualSpend, spendYears: goal.spendYears, metric: goal.metric, monthlyContribution: goal.monthlyContribution, expectedReturn: goal.expectedReturn, volatility: goal.volatility, note: goal.note ?? '' }} />
                </div>
              </details>
            ))}
          </div>
          )}
        </Panel>
      )}

      <div id="new-goal" className="scroll-mt-6">
        <Panel title="新建目标" en="NEW GOAL">
          <GoalForm mode="create" />
          <p className="mt-5 border-t border-line pt-4 text-[14px] leading-7 text-ink-faint">预测基于 1500 条蒙特卡洛路径（月度步进）；有持仓时按实际类别权重做协方差组合模拟，否则退回单因子正态模型。</p>
        </Panel>
      </div>
    </div>
  )
}
