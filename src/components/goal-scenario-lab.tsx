'use client'

// FIRE 情景实验室：候选方案一律交回服务端用同一投影引擎重算，
// 客户端不再自造近似概率模型（预览值必须等于应用后的引擎值）。
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useEffect, useRef, useState } from 'react'
import { applyGoalScenario, previewGoalScenario } from '@/lib/actions'
import { FormMsg, btnCls, btnGhostCls } from './fields'
import { useConfirm } from '@/components/confirm-dialog'

interface GoalScenarioLabProps {
  goalId: string
  monthlyContribution: number
  sustainableMonthlySavings: number
  accumulationSuccessProbability: number
  projectedMedian: number
  fireNumberAtRetirement: number
  /** 服务端装配好的引擎基准输入（含 seed 与组合权重） */
  projectionInput: {
    current: number
    fireNumberToday: number
    monthsToRetirement: number
    withdrawalRate: number
    inflationRate: number
    retirementYears: number
    annualReturn: number
    volatility: number
    seed: number
    portfolioWeights?: Partial<Record<string, number>>
  }
}

const money = (value: number) => `¥${Math.max(0, Math.round(value)).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`

export function GoalScenarioLab(props: GoalScenarioLabProps) {
  const confirm = useConfirm()
  const navigateAfterWrite = useNavigateAfterWrite()
  const suggested = Math.max(props.monthlyContribution, Math.round(props.sustainableMonthlySavings / 500) * 500)
  const [monthly, setMonthly] = useState(suggested)
  const [delayMonths, setDelayMonths] = useState(0)
  const [pending, setPending] = useState(false)
  const [computing, setComputing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tone?: 'ok' | 'warn' | 'error' } | null>(null)
  // 初值即服务端引擎结果，避免首屏出现“客户端算出的另一个数”
  const [preview, setPreview] = useState({
    accumulationSuccessProb: props.accumulationSuccessProbability,
    projectedMedian: props.projectedMedian,
    fireNumberAtRetirement: props.fireNumberAtRetirement,
  })
  const base = props.projectionInput
  const requestId = useRef(0)

  useEffect(() => {
    const id = requestId.current + 1
    requestId.current = id
    setComputing(true)
    const timer = setTimeout(async () => {
      const res = await previewGoalScenario({
        monthlyContribution: monthly,
        delayMonths,
        base,
      })
      if (requestId.current !== id) return
      setComputing(false)
      if (res.ok && res.data) {
        setPreview({
          accumulationSuccessProb: res.data.accumulationSuccessProb,
          projectedMedian: res.data.projectedMedian,
          fireNumberAtRetirement: res.data.fireNumberAtRetirement,
        })
      } else if (!res.ok) {
        setMsg({ ok: false, tone: 'error', text: res.error })
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [monthly, delayMonths, base])

  const maxMonthly = Math.max(15000, Math.ceil(Math.max(props.monthlyContribution, props.sustainableMonthlySavings) * 1.6 / 500) * 500)
  const gap = Math.max(0, preview.fireNumberAtRetirement - preview.projectedMedian)
  const changed = monthly !== props.monthlyContribution || delayMonths !== 0

  async function apply() {
    // 应用会改写主方案的月投入与退休日期，必须先确认
    const confirmed = await confirm({
      title: '应用此方案？',
      description: '这是一次真实写入：主方案的月投入会被改写。',
      impacts: [
        `每月投入：${money(props.monthlyContribution)} → ${money(monthly)}`,
        delayMonths > 0 ? `退休日期延后 ${delayMonths} 个月` : '退休日期不变',
        '主方案与 FIRE 预测按新假设重算；试算滑块归零',
      ],
      confirmLabel: '应用方案',
    })
    if (!confirmed) return
    setPending(true)
    setMsg(null)
    const response = await applyGoalScenario(props.goalId, {
      monthlyContribution: monthly,
      delayMonths,
      targetReduction: 0,
    })
    setPending(false)
    if (response.ok) {
      setDelayMonths(0)
      navigateAfterWrite(response.warning
        ? { message: `方案已应用；${response.warning}`, tone: 'warn' }
        : { message: '方案已应用，FIRE 路径已重新计算' })
    } else {
      setMsg({ ok: false, tone: 'error', text: response.error })
    }
  }

  return (
    <section className="goal-scenario">
      <div className="goal-section-head">
        <div>
          <div className="eyebrow">Scenario lab</div>
          <h2>调整投入与退休时间</h2>
        </div>
        <span>当前月投入 {money(props.monthlyContribution)}</span>
      </div>

      <div className="goal-scenario-body">
        <div className="goal-scenario-copy">
          <span className="goal-status">推荐动作</span>
          <h3>让 FIRE 投入与真实储蓄能力一致</h3>
          <p>优先使用近三个月可持续净储蓄。这里的预览与服务端引擎同源，应用后会得到相同口径的完整蒙特卡洛结果。</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnGhostCls}
              disabled={props.sustainableMonthlySavings <= 0}
              title={props.sustainableMonthlySavings <= 0 ? '尚无月度收支记录，无法校准可持续投入' : undefined}
              onClick={() => setMonthly(Math.max(0, Math.round(props.sustainableMonthlySavings / 500) * 500))}
            >
              {props.sustainableMonthlySavings > 0 ? `采用储蓄能力 ${money(props.sustainableMonthlySavings)}` : '尚无可校准的储蓄能力'}
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
            <div className="goal-scenario-assumption">
              <span>当前积累达标概率</span>
              <strong>{(props.accumulationSuccessProbability * 100).toFixed(1)}%</strong>
            </div>
          </div>

          <div className="goal-scenario-results" aria-live="polite">
            <div><span>新积累达标概率</span><strong>{(preview.accumulationSuccessProb * 100).toFixed(1)}%</strong></div>
            <div><span>预计退休资产</span><strong>{money(preview.projectedMedian)}</strong></div>
            <div><span>退休时资金缺口</span><strong>{money(gap)}</strong></div>
          </div>
          <p className="mt-3 text-[12px] text-ink-faint">
            {computing
              ? '引擎重算中…'
              : `按 ${(props.projectionInput.annualReturn * 100).toFixed(1)}% 年化 · ${(props.projectionInput.volatility * 100).toFixed(1)}% 波动率 · 1500 次路径模拟`}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <FormMsg msg={msg} />
            <button type="button" onClick={apply} disabled={pending || !changed} className={btnCls}>
              {pending ? '应用中…' : changed ? '应用此方案' : '方案未变化'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
