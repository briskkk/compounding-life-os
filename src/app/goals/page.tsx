import { getSession } from '@/lib/session'
import { loadEngineState, loadGoals, loadSavingsOverview, type GoalView } from '@/lib/queries'
import { Empty, ReadOnlyNotice, SetupScreen, Tag } from '@/components/ui'
import { ProjectionChart, SavingsRateChart, type ProjectionDatum } from '@/components/charts'
import { GoalForm } from '@/components/goal-form'
import { GoalEditDialog } from '@/components/goal-edit-dialog'
import { GoalScenarioLab } from '@/components/goal-scenario-lab'
import { SavingsCheckIn } from '@/components/savings-check-in'
import { fmtCNY, fmtDate, fmtMonth, fmtPct } from '@/lib/format'
import { FIRE_SIMS_DEFAULT } from '@/lib/engine/projection'
import { HashOpenDetails } from '@/components/hash-open-details'
import { summarizeValuationDate } from '@/lib/engine/watch-market'

export const dynamic = 'force-dynamic'

function monthFrom(now: Date, months: number | null): string {
  if (months == null) return '100 年内未达标'
  const date = new Date(now)
  date.setMonth(date.getMonth() + months)
  return fmtMonth(date)
}

function goalKind(goal: GoalView): string {
  return goal.mode === 'STREAM' ? '退休目标' : '财富目标'
}

function scenarioDelta(value: number, target: number): string {
  const delta = value - target
  return delta >= 0 ? `超过 ${fmtCNY(delta)}` : `仍差 ${fmtCNY(-delta)}`
}

function initialFor(goal: GoalView) {
  return {
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
  }
}

export default async function GoalsPage() {
  const ctx = await getSession()
  if (!ctx) return <SetupScreen />

  const [state, savings] = await Promise.all([
    loadEngineState(ctx),
    loadSavingsOverview(ctx),
  ])
  const savingsEvidenceReady = savings.recordedMonths >= 3
  const sustainable = savingsEvidenceReady ? Math.max(0, savings.sustainableMonthlySavings) : 0
  const goals = await loadGoals(ctx, state, {
    sustainableMonthlySavings: savingsEvidenceReady ? sustainable : undefined,
  })
  const primary = goals[0] ?? null
  const now = new Date()
  const readOnly = ctx.role === 'VIEWER'
  const canWrite = !readOnly

  const valuationField = primary?.metric === 'NET_WORTH' ? 'value' : 'investable'
  const goalValuations = state.valued
    .filter((position) => Math.abs(position[valuationField]) > 0.005 && position.asset.cls !== 'CASH')
    .map((position) => ({
      tradingDate: state.quotes.get(position.asset.symbol)?.tradingDate ?? null,
      valueCny: position[valuationField],
    }))
  const valuation = summarizeValuationDate(goalValuations)
  const excluded = state.valued.filter((position) => Math.abs(position.value) > 0.005 && Math.abs(position.investable) <= 0.005)
  const excludedValue = excluded.reduce((sum, position) => sum + position.value, 0)
  const savingsEvidence = savings.recordedMonths < 3
    ? { label: '证据不足', tone: 'amber' as const, detail: `${savings.recordedMonths} 个月记录，至少需要 3 个月` }
    : savings.recordedMonths < 6
      ? { label: '初步参考', tone: 'info' as const, detail: `${savings.recordedMonths} 个月记录` }
      : { label: '证据较充分', tone: 'down' as const, detail: `${savings.recordedMonths} 个月记录` }

  let projectionData: ProjectionDatum[] = []
  if (primary) {
    projectionData = primary.projection.points
      .filter((_, index, points) => index % Math.max(1, Math.ceil(points.length / 120)) === 0 || index === points.length - 1)
      .map((point) => {
        const date = new Date(now)
        date.setMonth(date.getMonth() + point.month)
        return {
          label: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
          base: Math.round(point.p10),
          band: Math.round(point.p90 - point.p10),
          p50: Math.round(point.p50),
          target: Math.round(primary.targetAmount * Math.pow(1 + primary.inflationRate, point.month / 12)),
        }
      })
  }

  const finalPoint = primary?.projection.points.at(-1) ?? null
  const targetAtDate = primary?.projection.fireNumberAtRetirement ?? 0
  const principalAtDate = primary
    ? primary.current + primary.monthlyContribution * primary.monthsLeft
    : 0
  const growthAtDate = finalPoint ? finalPoint.p50 - principalAtDate : 0
  const savingsChart = savings.months.map((month) => ({
    month: month.month,
    label: `${Number(month.month.slice(5))}月`,
    rate: month.savingsRate,
  }))

  return (
    <div className="page-shell goals-page goal-simple-page">
      <header className="goal-page-header">
        <div>
          <h1>目标测算</h1>
          <p>从真实账本出发，回答什么时候达标、每月需要投入多少</p>
        </div>
        <Tag tone={primary ? 'info' : 'amber'}>{primary ? '1 个主目标' : '尚未保存目标'}</Tag>
      </header>

      {readOnly && <ReadOnlyNotice what="可以查看目标测算、情景假设与高级压力测试，但不能新建、修改或保存目标" />}

      {primary && finalPoint ? (
        <>
          <section className="goal-summary" aria-labelledby="goal-summary-title">
            <div className="goal-summary-head">
              <div>
                <Tag tone="info">主目标 · {goalKind(primary)}</Tag>
                <h2 id="goal-summary-title">{primary.name}</h2>
                <p>{fmtDate(primary.targetDate)} · 目标金额按今日购买力记录</p>
              </div>
              <GoalEditDialog goalId={primary.id} initial={initialFor(primary)} canWrite={canWrite} />
            </div>

            <div className="goal-answer-grid">
              <div><span>可用于目标的当前资产</span><strong>{fmtCNY(primary.current)}</strong><small>{primary.metric === 'INVESTABLE' ? '可自由投资口径，含在途资产' : primary.mode === 'STREAM' ? '家庭净资产，含长期资产并扣负债' : '家庭净资产口径'}</small></div>
              <div><span>目标金额</span><strong>{fmtCNY(primary.targetAmount)}</strong><small>目标日通胀调整后 {fmtCNY(targetAtDate)}</small></div>
              <div><span>按当前投入预计达成</span><strong>{monthFrom(now, primary.projection.estimatedFireMonths)}</strong><small>当前计划投入 {fmtCNY(primary.monthlyContribution)} / 月</small></div>
              <div><span>目标日所需月投入</span><strong>{fmtCNY(primary.projection.requiredMonthly)}</strong><small>{primary.projection.requiredMonthly <= primary.monthlyContribution ? '当前计划投入可以覆盖' : `还需增加 ${fmtCNY(primary.projection.requiredMonthly - primary.monthlyContribution)} / 月`}</small></div>
            </div>

            <div className="goal-summary-progress" role="progressbar" aria-label={`${primary.name} 当前完成度`} aria-valuenow={Math.min(100, Math.max(0, Math.round(primary.projection.fundedRatio * 100)))} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${Math.min(100, Math.max(0, primary.projection.fundedRatio * 100))}%` }} />
            </div>
            <p className="goal-summary-caption">当前资本相当于今日目标的 {fmtPct(primary.projection.fundedRatio)}；计划与账本流水保持分离。</p>
            {primary.capitalScopeAdjusted && <p className="goal-scope-warning">退休目标已改用家庭净资产；保存后可同步修正口径。</p>}
          </section>

          {/* 决策流：先给结论，再让用户就地调整投入看时间怎么变；试算不写库。 */}
          <GoalScenarioLab
            goalId={primary.id}
            monthlyContribution={primary.monthlyContribution}
            sustainableMonthlySavings={sustainable}
            savingsEvidenceMonths={savings.recordedMonths}
            projectedMedian={primary.projection.projectedMedian}
            fireNumberAtRetirement={primary.projection.fireNumberAtRetirement}
            accumulationSuccessProbability={primary.projection.accumulationSuccessProb}
            requiredMonthly={primary.projection.requiredMonthly}
            estimatedFireMonths={primary.projection.estimatedFireMonths}
            projectionInput={primary.projectionInput}
            canWrite={canWrite}
          />

          <section aria-labelledby="goal-scenario-title">
            <div className="goal-section-head">
              <div><h2 id="goal-scenario-title">目标日可能落在哪里</h2></div>
              <span>同一组合模型的 P10 / P50 / P90 结果</span>
            </div>
            <div className="goal-scenario-grid">
              {[
                { label: '保守区间', value: finalPoint.p10, suffix: 'P10' },
                { label: '基准中位', value: finalPoint.p50, suffix: 'P50' },
                { label: '乐观区间', value: finalPoint.p90, suffix: 'P90' },
              ].map((item) => (
                <div key={item.label}>
                  <span>{item.label} · {item.suffix}</span>
                  <strong>{fmtCNY(item.value)}</strong>
                  <small>{scenarioDelta(item.value, targetAtDate)}</small>
                </div>
              ))}
            </div>
            <p className="goal-model-note">三档共用同一组合模型，仅表示模拟分布，不承诺收益。</p>
          </section>

          <section className="goal-capital-bridge" aria-labelledby="goal-bridge-title">
            <div className="goal-section-head">
              <div><h2 id="goal-bridge-title">本金和复利各贡献多少</h2></div>
              <span>基准中位 · 目标日期</span>
            </div>
            <div className="goal-bridge-equation">
              <div><span>当前资本</span><strong>{fmtCNY(primary.current)}</strong></div>
              <b>+</b>
              <div><span>后续计划投入</span><strong>{fmtCNY(primary.monthlyContribution * primary.monthsLeft)}</strong></div>
              <b>+</b>
              <div><span>预计复利增值</span><strong className={growthAtDate >= 0 ? 'text-up' : 'text-down'}>{fmtCNY(growthAtDate)}</strong></div>
              <b>=</b>
              <div><span>目标日预计资产</span><strong>{fmtCNY(finalPoint.p50)}</strong></div>
            </div>
          </section>

          <section className="goal-evidence" aria-labelledby="goal-evidence-title">
            <div className="goal-section-head">
              <div><h2 id="goal-evidence-title">这次测算用了什么</h2></div>
              <span>事实、假设与模型分开显示</span>
            </div>
            <div className="goal-evidence-grid">
              <div><span>账本资本</span><strong>{primary.metric === 'INVESTABLE' ? '可自由投资资产' : '家庭净资产'}</strong><small>含在途 {fmtCNY(state.inTransit)}</small></div>
              <div><span>估值证据</span><strong>{valuation?.date ?? '无市场日期'}</strong><small>{valuation ? `${fmtPct(valuation.coverage)} 同日行情覆盖` : '现金或手动估值为主'}</small></div>
              <div><span>{primary.metric === 'INVESTABLE' ? '排除的长期资产' : '计入的长期资产'}</span><strong>{fmtCNY(excludedValue)}</strong><small>{excluded.length > 0 ? `${excluded.length} 项${primary.metric === 'INVESTABLE' ? '未进入可投资资本' : '已进入净资产口径'}` : '没有长期资产项'}</small></div>
              <div><span>储蓄能力</span><Tag tone={savingsEvidence.tone}>{savingsEvidence.label}</Tag><small>{savingsEvidence.detail}</small></div>
              <div><span>收益模型</span><strong>{primary.modelSource === 'PORTFOLIO' ? '当前组合类别模型' : primary.metric === 'NET_WORTH' ? '综合资产手工假设' : '手工兜底假设'}</strong><small>{fmtPct(primary.expectedReturn)} 年化 · {fmtPct(primary.volatility)} 波动</small></div>
              <div><span>家庭负债</span><strong>{fmtCNY(state.liabilitiesTotal)}</strong><small>{primary.metric === 'INVESTABLE' ? '单独披露，不抵消投资资本' : '已从净资产口径扣除'}</small></div>
            </div>
          </section>

          <details className="goal-advanced" id="retirement-stress">
            <summary>
              <span><strong>高级：退休压力测试与收支证据</strong><small>提取率、退休年数、不断供概率和完整投影</small></span>
              <b>展开</b>
            </summary>
            <div className="goal-advanced-body">
              {primary.mode === 'STREAM' ? (
                <section aria-labelledby="retirement-title">
                  <div className="goal-section-head">
                    <div><h2 id="retirement-title">退休压力测试</h2></div>
                    <Tag tone={primary.projection.retirementSuccessProb >= 0.9 ? 'down' : primary.projection.retirementSuccessProb >= 0.7 ? 'info' : 'amber'}>{fmtPct(primary.projection.retirementSuccessProb)} 不断供概率</Tag>
                  </div>
                  <div className="fire-metric-grid">
                    <div><span>年度退休支出</span><strong>{fmtCNY(primary.annualSpend ?? 0)}</strong><small>稳定收入 {fmtCNY(primary.retirementIncome)}</small></div>
                    <div><span>安全提取率</span><strong>{fmtPct(primary.withdrawalRate)}</strong><small>{primary.spendYears} 年退休期</small></div>
                    <div><span>退休日积累达标</span><strong>{fmtPct(primary.projection.accumulationSuccessProb)}</strong><small>{FIRE_SIMS_DEFAULT} 条蒙特卡洛路径</small></div>
                  </div>
                  <div className="goal-chart-column" role="img" aria-label={`目标日期资产中位数 ${fmtCNY(primary.projection.projectedMedian)}`}>
                    <ProjectionChart data={projectionData} target={targetAtDate} targetLabel="通胀调整目标" dynamicTarget />
                  </div>
                </section>
              ) : (
                <Empty>当前是普通财富目标；切换为退休目标后才计算退休期不断供概率。</Empty>
              )}

              <section className="savings-rhythm" aria-labelledby="savings-title">
                <div className="goal-section-head">
                  <div><h2 id="savings-title">收支证据</h2></div>
                  <Tag tone={savingsEvidence.tone}>{savingsEvidence.label}</Tag>
                </div>
                <div className="savings-layout">
                  <div className="savings-trend">
                    <div className="savings-metrics">
                      <div><span>本月储蓄率</span><strong>{fmtPct(savings.current.savingsRate)}</strong></div>
                      <div><span>本月净储蓄</span><strong>{fmtCNY(savings.current.netSavings)}</strong></div>
                      <div><span>三月均值</span><strong>{savingsEvidenceReady ? fmtCNY(sustainable) : '证据不足'}</strong></div>
                    </div>
                    <SavingsRateChart data={savingsChart} />
                  </div>
                  <div className="savings-entry-surface">
                    <SavingsCheckIn month={savings.current.month} income={savings.current.income} spending={savings.current.spending} savedAmount={savings.current.savedAmount} />
                  </div>
                </div>
              </section>

              {goals.length > 1 && (
                <section aria-labelledby="saved-goals-title">
                  <div className="goal-section-head"><div><h2 id="saved-goals-title">既有其他目标</h2></div><span>默认只使用最早到期的一项作为主目标</span></div>
                  <div className="goal-portfolio-list">
                    {goals.slice(1).map((goal) => (
                      <details key={goal.id}>
                        <summary>
                          <div><strong>{goal.name}</strong><span>{fmtDate(goal.targetDate)} · {goalKind(goal)}</span></div>
                          <div><span>目标金额</span><strong>{fmtCNY(goal.targetAmount)}</strong></div>
                          <div><span>预计达成</span><strong>{monthFrom(now, goal.projection.estimatedFireMonths)}</strong></div>
                        </summary>
                        <div className="goal-row-editor"><GoalForm mode="edit" goalId={goal.id} initial={initialFor(goal)} initiallyOpen canWrite={canWrite} /></div>
                      </details>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </details>
        </>
      ) : (
        <>
          <section className="goal-empty-hero">
            <div>
              <Tag tone="info">账本已就绪</Tag>
              <h2>{canWrite ? '先设一个真正需要回答的目标。' : '这个家庭还没有保存主目标。'}</h2>
              <p>{canWrite ? '保存后自动带入当前资本，计算达成时间与所需月投入。' : '目标由家庭 OWNER 建立；建立后这里会自动带入账本资本与三档测算。'}</p>
            </div>
            {canWrite && <a href="#new-goal">建立主目标 →</a>}
          </section>
          {canWrite && (
            <HashOpenDetails id="new-goal" className="new-goal-section" summary={<span><strong>建立主目标</strong><small>默认从普通财富目标开始</small></span>}>
              <div className="mt-6"><GoalForm mode="create" /></div>
            </HashOpenDetails>
          )}
        </>
      )}
    </div>
  )
}
