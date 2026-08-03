import { getSession } from '@/lib/session'
import { loadEngineState, loadGoals, loadSavingsOverview } from '@/lib/queries'
import { Empty, SetupScreen, Tag } from '@/components/ui'
import { ProjectionChart, SavingsRateChart, type ProjectionDatum } from '@/components/charts'
import { GoalForm } from '@/components/goal-form'
import { GoalScenarioLab } from '@/components/goal-scenario-lab'
import { SavingsCheckIn } from '@/components/savings-check-in'
import { GOAL_METRIC_LABEL } from '@/lib/labels'
import { fmtCNY, fmtDate, fmtPct } from '@/lib/format'

export const dynamic = 'force-dynamic'

function goalStatus(probability: number): { label: string; tone: 'amber' | 'info' | 'down' } {
  if (probability < 0.55) return { label: '需要调整', tone: 'amber' }
  if (probability < 0.75) return { label: '持续观察', tone: 'info' }
  return { label: '路径稳健', tone: 'down' }
}

export default async function GoalsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const state = await loadEngineState(ctx)
  const [goals, savings] = await Promise.all([
    loadGoals(ctx, state),
    loadSavingsOverview(ctx),
  ])
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
  const currentMonth = savings.current.month
  const savingsChart = savings.months.map((month) => ({
    month: month.month,
    label: `${Number(month.month.slice(5))}月`,
    rate: month.savingsRate,
  }))
  const sustainable = Math.max(0, savings.sustainableMonthlySavings)

  return (
    <div className="page-shell goals-page">
      <header className="goal-page-header">
        <div>
          <div className="eyebrow">Goal planning</div>
          <h1>把目标变成可执行的资金路径</h1>
          <p>{goals.length} 项目标 · 以真实资产、储蓄节奏与投入计划持续重算</p>
        </div>
        <Tag tone="info">更新于 {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</Tag>
      </header>

      {primary ? (
        <section className="goal-hero">
          <div className="goal-hero-copy">
            <Tag tone="info">核心目标 · {GOAL_METRIC_LABEL[primary.goal.metric]}</Tag>
            <h2>{primary.goal.name}</h2>
            <div className="goal-probability"><span>预计达成概率</span><strong>{fmtPct(primary.goal.projection.successProb)}</strong></div>
            <div className="goal-context">
              <span>目标 <strong>{fmtCNY(primary.goal.targetAmount)}</strong></span>
              <span>当前口径资产 <strong>{fmtCNY(primary.goal.current)}</strong></span>
              <span>剩余 <strong>{primary.goal.monthsLeft} 个月</strong></span>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="#scenario-lab" className="inline-flex min-h-11 items-center rounded-lg border border-gold bg-gold px-4 py-2 text-[14px] font-medium text-bg">优化投入方案</a>
              <details className="goal-edit-details">
                <summary>编辑目标</summary>
                <div className="goal-edit-popover">
                  <GoalForm mode="edit" goalId={primary.goal.id} initiallyOpen initial={{
                    name: primary.goal.name,
                    mode: primary.goal.mode,
                    targetAmount: primary.goal.targetAmount,
                    targetDate: primary.goal.targetDate.slice(0, 10),
                    annualSpend: primary.goal.annualSpend,
                    spendYears: primary.goal.spendYears,
                    metric: primary.goal.metric,
                    monthlyContribution: primary.goal.monthlyContribution,
                    expectedReturn: primary.goal.expectedReturn,
                    volatility: primary.goal.volatility,
                    note: primary.goal.note ?? '',
                  }} />
                </div>
              </details>
            </div>
          </div>
          <div className="goal-chart-column">
            <ProjectionChart data={primary.data} target={primary.goal.mode === 'STREAM' ? 0 : primary.goal.targetAmount} targetLabel={primary.goal.mode === 'STREAM' ? '断供线' : '目标'} />
            <div className="goal-chart-legend"><span>中位路径 P50</span><span>保守—乐观区间 P10–P90</span><span>目标线</span></div>
          </div>
        </section>
      ) : (
        <section className="goal-empty-hero">
          <div><div className="eyebrow">First goal</div><h2>先定义一个真正重要的目标。</h2><p>建立目标后，系统会把当前资产、未来投入和储蓄能力合并成一条可执行路径。</p></div>
          <a href="#new-goal">建立第一个目标 →</a>
        </section>
      )}

      <section className="savings-rhythm">
        <div className="goal-section-head">
          <div><div className="eyebrow">Savings rhythm</div><h2>储蓄率决定目标计划能否持续</h2></div>
          <span>收入按月记录 · 消费可按周或按月补录</span>
        </div>
        <div className="savings-layout">
          <div className="savings-trend">
            <div className="savings-metrics">
              <div><span>{Number(currentMonth.slice(5))} 月储蓄率</span><strong>{fmtPct(savings.current.savingsRate)}</strong></div>
              <div><span>本月净储蓄</span><strong>{fmtCNY(savings.current.netSavings)}</strong></div>
              <div><span>近月平均</span><strong>{fmtPct(savings.averageRate)}</strong></div>
            </div>
            <SavingsRateChart data={savingsChart} />
            <div className="savings-goal-impact">
              <div><Tag tone="info">对目标的影响</Tag><span>{savings.recordedMonths > 0 ? `近三个月可持续净储蓄约 ${fmtCNY(sustainable)} / 月` : '记录首个月度收支后，即可评估可持续目标投入'}</span></div>
              {primary && sustainable > 0 && <a href="#scenario-lab">纳入目标方案 →</a>}
            </div>
          </div>
          <div className="savings-entry-surface">
            <SavingsCheckIn
              month={currentMonth}
              income={savings.current.income}
              spending={savings.current.spending}
              savedAmount={savings.current.savedAmount}
            />
          </div>
        </div>
      </section>

      {primary?.goal.mode === 'LUMP_SUM' && (() => {
        const finalPoint = primary.goal.projection.points.at(-1)
        if (!finalPoint) return null
        return (
          <div id="scenario-lab" className="scroll-mt-6">
            <GoalScenarioLab
              goalId={primary.goal.id}
              mode={primary.goal.mode}
              targetAmount={primary.goal.targetAmount}
              monthsLeft={primary.goal.monthsLeft}
              monthlyContribution={primary.goal.monthlyContribution}
              sustainableMonthlySavings={sustainable}
              expectedReturn={primary.goal.expectedReturn}
              projectedMedian={primary.goal.projection.projectedMedian}
              projectedP10={finalPoint.p10}
              projectedP90={finalPoint.p90}
              successProbability={primary.goal.projection.successProb}
            />
          </div>
        )
      })()}

      <section>
        <div className="goal-section-head">
          <div><div className="eyebrow">Goal portfolio</div><h2>全部目标</h2></div>
          <a href="#new-goal">新建目标</a>
        </div>
        {goalViews.length === 0 ? <Empty>尚未建立目标</Empty> : (
          <div className="goal-portfolio-list">
            {goalViews.map(({ goal }) => {
              const status = goalStatus(goal.projection.successProb)
              return (
                <details key={goal.id}>
                  <summary>
                    <div><strong>{goal.name}</strong><span>{goal.mode === 'STREAM' ? '持续支出' : fmtDate(goal.targetDate)} · {GOAL_METRIC_LABEL[goal.metric]}</span></div>
                    <div><span>当前口径资产</span><strong>{fmtCNY(goal.current)}</strong></div>
                    <div><span>达成概率</span><strong>{fmtPct(goal.projection.successProb)}</strong></div>
                    <Tag tone={status.tone}>{status.label}</Tag>
                  </summary>
                  <div className="goal-row-editor">
                    <GoalForm mode="edit" goalId={goal.id} initiallyOpen initial={{ name: goal.name, mode: goal.mode, targetAmount: goal.targetAmount, targetDate: goal.targetDate.slice(0, 10), annualSpend: goal.annualSpend, spendYears: goal.spendYears, metric: goal.metric, monthlyContribution: goal.monthlyContribution, expectedReturn: goal.expectedReturn, volatility: goal.volatility, note: goal.note ?? '' }} />
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </section>

      <details id="new-goal" className="new-goal-section">
        <summary><span><span className="eyebrow">New goal</span><strong>新建目标</strong></span><span>＋</span></summary>
        <div className="mt-6"><GoalForm mode="create" /></div>
      </details>
    </div>
  )
}
