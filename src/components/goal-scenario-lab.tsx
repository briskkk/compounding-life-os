'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { applyGoalScenario } from '@/lib/actions'
import { FormMsg, btnCls, btnGhostCls } from './fields'

interface GoalScenarioLabProps {
  goalId: string
  mode: 'LUMP_SUM' | 'STREAM'
  targetAmount: number
  monthsLeft: number
  monthlyContribution: number
  sustainableMonthlySavings: number
  expectedReturn: number
  projectedMedian: number
  projectedP10: number
  projectedP90: number
  successProbability: number
}

const money = (value: number) => `¥${Math.max(0, value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return sign * y
}

function normalCdf(value: number): number {
  return (1 + erf(value / Math.sqrt(2))) / 2
}

function annuity(monthlyRate: number, months: number): number {
  if (months <= 0) return 0
  if (Math.abs(monthlyRate) < 1e-9) return months
  return (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate
}

export function GoalScenarioLab(props: GoalScenarioLabProps) {
  const router = useRouter()
  const suggested = Math.max(props.monthlyContribution, Math.round(props.sustainableMonthlySavings / 500) * 500)
  const [monthly, setMonthly] = useState(suggested)
  const [delayMonths, setDelayMonths] = useState(0)
  const [targetReduction, setTargetReduction] = useState(0)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const result = useMemo(() => {
    if (props.mode === 'STREAM') {
      return {
        probability: props.successProbability,
        median: props.projectedMedian,
        target: props.targetAmount,
        gap: Math.max(0, props.targetAmount - props.projectedMedian),
      }
    }
    const monthlyRate = Math.pow(1 + props.expectedReturn, 1 / 12) - 1
    const growthDelay = Math.pow(1 + monthlyRate, delayMonths)
    const extraMonthly = monthly - props.monthlyContribution
    const median = props.projectedMedian * growthDelay
      + extraMonthly * annuity(monthlyRate, props.monthsLeft + delayMonths)
      + monthly * annuity(monthlyRate, delayMonths)
    const target = props.targetAmount * (1 - targetReduction)
    const baseSigma = Math.max(1, (props.projectedP90 - props.projectedP10) / (2 * 1.28155))
    const sigma = baseSigma * growthDelay
    const probability = Math.max(0.01, Math.min(0.99, 1 - normalCdf((target - median) / sigma)))
    return { probability, median, target, gap: Math.max(0, target - median) }
  }, [delayMonths, monthly, props, targetReduction])

  const maxMonthly = Math.max(15000, Math.ceil(Math.max(props.monthlyContribution, props.sustainableMonthlySavings) * 1.6 / 500) * 500)

  async function apply() {
    setPending(true)
    setMsg(null)
    const response = await applyGoalScenario(props.goalId, {
      monthlyContribution: monthly,
      delayMonths,
      targetReduction,
    })
    setPending(false)
    if (response.ok) {
      setMsg({ ok: true, text: '方案已应用，目标路径已重新计算' })
      router.refresh()
    } else {
      setMsg({ ok: false, text: response.error })
    }
  }

  return (
    <section className="goal-scenario">
      <div className="goal-section-head">
        <div>
          <div className="eyebrow">Scenario lab</div>
          <h2>调整方案，立即查看概率变化</h2>
        </div>
        <span>当前月投入 {money(props.monthlyContribution)}</span>
      </div>

      <div className="goal-scenario-body">
        <div className="goal-scenario-copy">
          <span className="goal-status">推荐动作</span>
          <h3>让目标投入与真实储蓄能力一致</h3>
          <p>优先使用近三个月可持续净储蓄，避免建立无法长期执行的目标计划。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhostCls} onClick={() => setMonthly(Math.max(0, Math.round(props.sustainableMonthlySavings / 500) * 500))}>
              采用储蓄能力 {money(props.sustainableMonthlySavings)}
            </button>
          </div>
        </div>

        <div>
          <div className="goal-scenario-controls">
            <label>
              <span>每月投入 <strong>{money(monthly)}</strong></span>
              <input type="range" min="0" max={maxMonthly} step="500" value={monthly} onChange={(event) => setMonthly(Number(event.target.value))} />
            </label>
            <label>
              <span>延后时间 <strong>{delayMonths} 个月</strong></span>
              <input type="range" min="0" max="36" step="6" value={delayMonths} onChange={(event) => setDelayMonths(Number(event.target.value))} />
            </label>
            {props.mode === 'LUMP_SUM' && (
              <label>
                <span>目标调整 <strong>{targetReduction === 0 ? '0%' : `-${Math.round(targetReduction * 100)}%`}</strong></span>
                <input type="range" min="0" max="0.2" step="0.05" value={targetReduction} onChange={(event) => setTargetReduction(Number(event.target.value))} />
              </label>
            )}
          </div>

          <div className="goal-scenario-results" aria-live="polite">
            <div><span>新达成概率</span><strong>{(result.probability * 100).toFixed(1)}%</strong></div>
            <div><span>预计到期金额</span><strong>{money(result.median)}</strong></div>
            <div><span>中位资金缺口</span><strong>{money(result.gap)}</strong></div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <FormMsg msg={msg} />
            <button type="button" onClick={apply} disabled={pending} className={btnCls}>
              {pending ? '应用中…' : '应用此方案'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
