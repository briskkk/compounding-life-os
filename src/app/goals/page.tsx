import { getSession } from '@/lib/session'
import { loadEngineState, loadGoals, loadSavingsOverview, type GoalView } from '@/lib/queries'
import { Empty, SetupScreen, Tag } from '@/components/ui'
import { ProjectionChart, SavingsRateChart, type ProjectionDatum } from '@/components/charts'
import { GoalForm } from '@/components/goal-form'
import { GoalEditDialog } from '@/components/goal-edit-dialog'
import { GoalScenarioLab } from '@/components/goal-scenario-lab'
import { SavingsCheckIn } from '@/components/savings-check-in'
import { fmtCNY, fmtDate, fmtMonth, fmtPct, firePaceNote } from '@/lib/format'

export const dynamic = 'force-dynamic'

function fireStatus(probability: number): { label: string; tone: 'amber' | 'info' | 'down' } {
  if (probability < 0.7) return { label: '需要调整', tone: 'amber' }
  if (probability < 0.9) return { label: '接近稳健', tone: 'info' }
  return { label: '计划稳健', tone: 'down' }
}

function monthFrom(now: Date, months: number): string {
  return fmtMonth(new Date(now.getFullYear(), now.getMonth() + months, 1))
}

function planMethod(goal: GoalView): string {
  return goal.mode === 'STREAM' ? '按退休支出反推' : '直接设定 FIRE Number'
}

export default async function GoalsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />
  const state = await loadEngineState(ctx)
  const savings = await loadSavingsOverview(ctx)
  const sustainable = Math.max(0, savings.sustainableMonthlySavings)
  const goals = await loadGoals(ctx, state, {
    sustainableMonthlySavings: savings.recordedMonths > 0 ? sustainable : undefined,
  })
  const now = new Date()
  const goalViews = goals.map((goal) => {
    const data: ProjectionDatum[] = goal.projection.points
      .filter((_, index) => index % Math.max(1, Math.ceil(goal.projection.points.length / 120)) === 0 || index === goal.projection.points.length - 1)
      .map((point) => {
        const date = new Date(now)
        date.setMonth(date.getMonth() + point.month)
        return {
          label: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
          base: Math.round(point.p10),
          band: Math.round(point.p90 - point.p10),
          p50: Math.round(point.p50),
          target: Math.round(goal.targetAmount * Math.pow(1 + goal.inflationRate, point.month / 12)),
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

  return (
    <div className="page-shell goals-page">
      <header className="goal-page-header">
        <div>
          <div className="eyebrow">Financial independence</div>
          <h1>FIRE · 财务自由计划</h1>
          <p>从真实可投资资产出发，同时验证积累达标与退休后不断供</p>
        </div>
        <Tag tone="info">{goals.length} 个方案 · 更新于 {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</Tag>
      </header>

      {primary ? (
        <section className="goal-hero">
          <div className="goal-hero-copy">
            <Tag tone="info">主方案 · {planMethod(primary.goal)}</Tag>
            <h2>{primary.goal.name}</h2>
            <div className="goal-probability">
              <span>完成度 · 当前资产 / FIRE Number</span>
              <strong>{fmtPct(Math.min(primary.goal.projection.fundedRatio, 9.99))}</strong>
            </div>
            <div className="goal-context">
              <span>FIRE Number <strong>{fmtCNY(primary.goal.targetAmount)}</strong></span>
              <span>当前资产 <strong>{fmtCNY(primary.goal.current)}</strong></span>
              <span>
                退休全周期不断供概率{' '}
                <strong className={primary.goal.projection.retirementSuccessProb < 0.7 ? 'text-amber' : undefined}>
                  {fmtPct(primary.goal.projection.retirementSuccessProb)}
                </strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="#scenario-lab" className="inline-flex min-h-11 items-center rounded-lg border border-accent bg-accent px-4 py-2 text-[14px] font-medium text-bg">优化 FIRE 路径</a>
              <GoalEditDialog goalId={primary.goal.id} initial={{
                name: primary.goal.name,
                mode: primary.goal.mode,
                targetAmount: primary.goal.targetAmount,
                targetDate: primary.goal.targetDate.slice(0, 10),
                annualSpend: primary.goal.annualSpend,
                spendYears: primary.goal.spendYears,
                retirementIncome: primary.goal.retirementIncome,
                withdrawalRate: primary.goal.withdrawalRate,
                inflationRate: primary.goal.inflationRate,
                metric: primary.goal.metric,
                monthlyContribution: primary.goal.monthlyContribution,
                expectedReturn: primary.goal.expectedReturn,
                volatility: primary.goal.volatility,
                note: primary.goal.note ?? '',
              }} />
            </div>
          </div>
          <div
            className="goal-chart-column"
            role="img"
            aria-label={`截至退休日期的资产预测：中位数 ${fmtCNY(primary.goal.projection.projectedMedian)}，通胀调整后的 FIRE Number ${fmtCNY(primary.goal.projection.fireNumberAtRetirement)}`}
          >
            <ProjectionChart data={primary.data} target={primary.goal.projection.fireNumberAtRetirement} targetLabel="通胀调整 FIRE Number" dynamicTarget />
            <div className="goal-chart-legend"><span>资产中位路径 P50</span><span>保守—乐观区间 P10–P90</span><span>通胀调整后的 FIRE Number</span></div>
          </div>
        </section>
      ) : (
        <section className="goal-empty-hero">
          <div><div className="eyebrow">Your FIRE number</div><h2>先算出你的财务自由数字。</h2><p>可以直接设定 3000 万，也可以用年度退休支出和安全提取率反推。系统会用真实资产与投入节奏验证计划。</p></div>
          <a href="#new-goal">建立 FIRE 计划 →</a>
        </section>
      )}

      {primary && (
        <section className="fire-dashboard" aria-labelledby="fire-dashboard-title">
          <div className="goal-section-head">
            <div><div className="eyebrow">FIRE dashboard</div><h2 id="fire-dashboard-title">一眼看清自由进度与执行缺口</h2></div>
            <span>路径与目标均为名义口径；目标线已按通胀逐年上调</span>
          </div>
          <div className="fire-metric-grid">
            <div><span>退休日积累达标概率</span><strong>{fmtPct(primary.goal.projection.accumulationSuccessProb)}</strong><small>到 {fmtDate(primary.goal.targetDate)} 达到 {fmtCNY(primary.goal.projection.fireNumberAtRetirement)}</small></div>
            <div><span>预计 FIRE 日期</span><strong>{primary.goal.projection.estimatedFireMonths != null ? monthFrom(now, primary.goal.projection.estimatedFireMonths) : '—'}</strong><small>{firePaceNote(primary.goal.projection.estimatedFireMonths, primary.goal.monthsLeft)}</small></div>
            <div><span>每月所需投入</span><strong>{fmtCNY(primary.goal.projection.requiredMonthly)}</strong><small>{primary.goal.projection.requiredMonthly <= sustainable ? '当前可持续储蓄可以覆盖' : `比近月可持续储蓄高 ${fmtCNY(primary.goal.projection.requiredMonthly - sustainable)}`}</small></div>
            <div><span>Coast FIRE 门槛</span><strong>{fmtCNY(primary.goal.projection.coastFireNumber)}</strong><small>{primary.goal.current >= primary.goal.projection.coastFireNumber ? '已经达到：不再投入也有望按时达标' : `距离门槛 ${fmtCNY(primary.goal.projection.coastFireNumber - primary.goal.current)}`}</small></div>
            {(() => {
              const alt = primary.goal.sustainableProjection
              return (
                <div>
                  <span>按可持续投入</span>
                  <strong>{alt ? `不断供概率 ${fmtPct(alt.retirementSuccessProb)} · 预计 ${alt.estimatedFireMonths != null ? monthFrom(now, alt.estimatedFireMonths) : '—'}` : '—'}</strong>
                  <small>{alt ? `投入 ${fmtCNY(sustainable)}/月（近月可持续）的情形` : '记录首个月度收支后，即可校准此情形'}</small>
                </div>
              )
            })()}
            <div><span>年度退休支出</span><strong>{fmtCNY(primary.goal.annualSpend ?? 0)}</strong><small>其中组合承担 {fmtCNY(primary.goal.projection.annualPortfolioSpendToday)} / 年</small></div>
            <div><span>关键假设</span><strong>{fmtPct(primary.goal.withdrawalRate)} 提取率</strong><small>{primary.goal.spendYears} 年退休期 · {fmtPct(primary.goal.inflationRate)} 通胀</small></div>
          </div>
          <p className="fire-method-note">FIRE Number =（年度退休支出 − 年度稳定退休收入）÷ 安全提取率。计划成功概率进一步模拟退休期逐月支取和收益顺序风险，不等同于收益保证。</p>
        </section>
      )}

      <section className="savings-rhythm">
        <div className="goal-section-head">
          <div><div className="eyebrow">Savings rhythm</div><h2>储蓄率决定 FIRE 速度</h2></div>
          <span>收入按月记录 · 消费可按周或按月补录</span>
        </div>
        <div className="savings-layout">
          <div className="savings-trend">
            <div className="savings-metrics">
              <div><span>{Number(currentMonth.slice(5))} 月储蓄率</span><strong>{fmtPct(savings.current.savingsRate)}</strong></div>
              <div><span>本月净储蓄</span><strong>{fmtCNY(savings.current.netSavings)}</strong></div>
              <div><span>近月可持续投入</span><strong>{fmtCNY(sustainable)}</strong></div>
            </div>
            <SavingsRateChart data={savingsChart} />
            <div className="savings-goal-impact">
              <div><Tag tone="info">对 FIRE 的影响</Tag><span>{savings.recordedMonths > 0 ? `近三个月可持续净储蓄约 ${fmtCNY(sustainable)} / 月` : '记录首个月度收支后，即可校准 FIRE 投入'}</span></div>
              {primary && sustainable > 0 && <a href="#scenario-lab">纳入计划 →</a>}
            </div>
          </div>
          <div className="savings-entry-surface">
            <SavingsCheckIn month={currentMonth} income={savings.current.income} spending={savings.current.spending} savedAmount={savings.current.savedAmount} />
          </div>
        </div>
      </section>

      {primary && (() => {
        const finalPoint = primary.goal.projection.points.at(-1)
        if (!finalPoint) return null
        return (
          <div id="scenario-lab" className="scroll-mt-6">
            <GoalScenarioLab
              goalId={primary.goal.id}
              fireNumberToday={primary.goal.targetAmount}
              monthsLeft={primary.goal.monthsLeft}
              monthlyContribution={primary.goal.monthlyContribution}
              sustainableMonthlySavings={sustainable}
              expectedReturn={primary.goal.expectedReturn}
              inflationRate={primary.goal.inflationRate}
              projectedMedian={primary.goal.projection.projectedMedian}
              projectedP10={finalPoint.p10}
              projectedP90={finalPoint.p90}
              accumulationSuccessProbability={primary.goal.projection.accumulationSuccessProb}
            />
          </div>
        )
      })()}

      <section>
        <div className="goal-section-head">
          <div><div className="eyebrow">FIRE scenarios</div><h2>全部 FIRE 方案</h2></div>
          <a href="#new-goal">新建方案</a>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">备选方案与主方案共用同一资产池，用于互斥比较，不会叠加计算。</p>
        {goalViews.length === 0 ? <Empty action={{ href: '#new-goal', label: '新建方案' }}>尚未建立 FIRE 计划</Empty> : (
          <div className="goal-portfolio-list">
            {goalViews.map(({ goal }) => {
              const status = fireStatus(goal.projection.retirementSuccessProb)
              return (
                <details key={goal.id}>
                  <summary>
                    <div><strong>{goal.name}</strong><span>{fmtDate(goal.targetDate)}退休 · {planMethod(goal)}</span></div>
                    <div><span>FIRE Number</span><strong>{fmtCNY(goal.targetAmount)}</strong></div>
                    <div><span>不断供概率</span><strong>{fmtPct(goal.projection.retirementSuccessProb)}</strong></div>
                    <Tag tone={status.tone}>{status.label}</Tag>
                  </summary>
                  <div className="goal-row-editor">
                    <GoalForm mode="edit" goalId={goal.id} initiallyOpen initial={{
                      name: goal.name,
                      mode: goal.mode,
                      targetAmount: goal.targetAmount,
                      targetDate: goal.targetDate.slice(0, 10),
                      annualSpend: goal.annualSpend,
                      spendYears: goal.spendYears,
                      retirementIncome: goal.retirementIncome,
                      withdrawalRate: goal.withdrawalRate,
                      inflationRate: goal.inflationRate,
                      metric: goal.metric,
                      monthlyContribution: goal.monthlyContribution,
                      expectedReturn: goal.expectedReturn,
                      volatility: goal.volatility,
                      note: goal.note ?? '',
                    }} />
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </section>

      <details id="new-goal" className="new-goal-section">
        <summary><span><span className="eyebrow">New FIRE plan</span><strong>新建 FIRE 方案</strong></span><span aria-hidden="true">＋</span></summary>
        <div className="mt-6"><GoalForm mode="create" /></div>
      </details>
    </div>
  )
}
