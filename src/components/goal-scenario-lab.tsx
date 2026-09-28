'use client'

// 临时试算始终交回服务端同一投影引擎；只有点击保存并确认后才改写主目标。
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useEffect, useRef, useState } from 'react'
import { applyGoalScenario, previewGoalScenario } from '@/lib/actions'
import { FormMsg, btnCls, btnGhostCls } from './fields'
import { useConfirm } from '@/components/confirm-dialog'

interface GoalScenarioLabProps {
  goalId: string
  monthlyContribution: number
  sustainableMonthlySavings: number
  savingsEvidenceMonths: number
  accumulationSuccessProbability: number
  projectedMedian: number
  fireNumberAtRetirement: number
  requiredMonthly: number
  estimatedFireMonths: number | null
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

const money = (value: number) => `¥${Math.round(Math.max(0, value)).toLocaleString('zh-CN')}`

function monthAfter(months: number | null): string {
  if (months == null) return '100 年内未达标'
  const date = new Date()
  date.setMonth(date.getMonth() + months)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function GoalScenarioLab(props: GoalScenarioLabProps) {
  const confirm = useConfirm()
  const navigateAfterWrite = useNavigateAfterWrite()
  const hasSavingsEvidence = props.savingsEvidenceMonths >= 3
  const [monthly, setMonthly] = useState(props.monthlyContribution)
  const [delayMonths, setDelayMonths] = useState(0)
  const [pending, setPending] = useState(false)
  const [computing, setComputing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tone?: 'ok' | 'warn' | 'error' } | null>(null)
  const [preview, setPreview] = useState({
    accumulationSuccessProb: props.accumulationSuccessProbability,
    projectedMedian: props.projectedMedian,
    fireNumberAtRetirement: props.fireNumberAtRetirement,
    requiredMonthly: props.requiredMonthly,
    estimatedFireMonths: props.estimatedFireMonths,
  })
  const base = props.projectionInput
  const requestId = useRef(0)

  useEffect(() => {
    const id = requestId.current + 1
    requestId.current = id
    setComputing(true)
    const timer = setTimeout(async () => {
      const res = await previewGoalScenario({ monthlyContribution: monthly, delayMonths, base })
      if (requestId.current !== id) return
      setComputing(false)
      if (res.ok && res.data) setPreview(res.data)
      else if (!res.ok) setMsg({ ok: false, tone: 'error', text: res.error })
    }, 180)
    return () => clearTimeout(timer)
  }, [monthly, delayMonths, base])

  const maxMonthly = Math.max(15000, Math.ceil(Math.max(props.monthlyContribution, props.sustainableMonthlySavings, props.requiredMonthly) * 1.6 / 500) * 500)
  const gap = Math.max(0, preview.fireNumberAtRetirement - preview.projectedMedian)
  const changed = monthly !== props.monthlyContribution || delayMonths !== 0

  async function apply() {
    const confirmed = await confirm({
      title: '保存到主目标？',
      description: '临时试算本身不会写入；确认后才更新主目标。',
      impacts: [
        `每月投入：${money(props.monthlyContribution)} → ${money(monthly)}`,
        delayMonths > 0 ? `目标日期延后 ${delayMonths} 个月` : '目标日期不变',
        '账本流水、余额和实际投入不会改变',
      ],
      confirmLabel: '保存到主目标',
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
        ? { message: `主目标已更新；${response.warning}`, tone: 'warn' }
        : { message: '主目标已更新' })
    } else {
      setMsg({ ok: false, tone: 'error', text: response.error })
    }
  }

  return (
    <section className="goal-scenario" id="quick-calculator" aria-labelledby="quick-calculator-title">
      <div className="goal-section-head">
        <div><h2 id="quick-calculator-title">临时试算</h2></div>
        <span>调整不会自动保存</span>
      </div>
      <div className="goal-scenario-body">
        <div className="goal-scenario-copy">
          <span className="goal-status">当前目标</span>
          <h3>改变投入，看看时间怎么变</h3>
          <p>试算沿用当前目标与账本资本，只有确认保存后才更新计划。</p>
          <button
            type="button"
            className={btnGhostCls}
            disabled={!hasSavingsEvidence}
            title={hasSavingsEvidence ? undefined : `目前只有 ${props.savingsEvidenceMonths} 个月有效收支记录，至少需要 3 个月`}
            onClick={() => setMonthly(Math.max(0, Math.round(props.sustainableMonthlySavings / 500) * 500))}
          >
            {hasSavingsEvidence ? `采用储蓄参考 ${money(props.sustainableMonthlySavings)}` : '储蓄能力证据不足'}
          </button>
        </div>

        <div>
          <div className="goal-scenario-controls">
            <label>
              <span>每月投入 <strong>{money(monthly)}</strong></span>
              <input type="range" min="0" max={maxMonthly} step="500" value={monthly} onChange={(event) => setMonthly(Number(event.target.value))} />
            </label>
            <label>
              <span>目标日期 <strong>{delayMonths > 0 ? `延后 ${delayMonths} 个月` : '不变'}</strong></span>
              <input type="range" min="0" max="36" step="6" value={delayMonths} onChange={(event) => setDelayMonths(Number(event.target.value))} />
            </label>
          </div>

          <div className="goal-scenario-results" aria-live="polite">
            <div><span>预计达成</span><strong>{monthAfter(preview.estimatedFireMonths)}</strong></div>
            <div><span>目标日预计资产</span><strong>{money(preview.projectedMedian)}</strong></div>
            <div><span>目标日资金缺口</span><strong>{money(gap)}</strong></div>
          </div>
          <p className="mt-3 text-[12px] text-ink-faint">
            {computing ? '引擎重算中…' : `同一组合模型 · 当前反解所需投入 ${money(preview.requiredMonthly)} / 月`}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <FormMsg msg={msg} />
            <button type="button" onClick={apply} disabled={pending || !changed} className={btnCls}>
              {pending ? '保存中…' : changed ? '保存到主目标' : '试算未变化'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
