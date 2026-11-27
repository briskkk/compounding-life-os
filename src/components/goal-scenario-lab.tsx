'use client'

// 临时试算始终交回服务端同一投影引擎；只有点击保存并确认后才改写主目标。
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useEffect, useState } from 'react'
import { applyGoalScenario, previewGoalScenario } from '@/lib/actions'
import { FormMsg, btnCls, btnGhostCls } from './fields'
import { useConfirm } from '@/components/confirm-dialog'

interface GoalScenarioLabProps {
  goalId: string
  monthlyContribution: number
  sustainableMonthlySavings: number
  savingsEvidenceMonths: number
  projectedMedian: number
  fireNumberAtRetirement: number
  requiredMonthly: number
  estimatedFireMonths: number | null
  /** 只读成员仍可试算预览，但不能保存到主目标 */
  canWrite?: boolean
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

interface ScenarioPreview {
  projectedMedian: number
  fireNumberAtRetirement: number
  requiredMonthly: number
  estimatedFireMonths: number | null
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
  const canWrite = props.canWrite !== false
  const [monthly, setMonthly] = useState(props.monthlyContribution)
  const [delayMonths, setDelayMonths] = useState(0)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tone?: 'ok' | 'warn' | 'error' } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; attempt: number; data: ScenarioPreview | null; error: string | null } | null>(null)
  const changed = monthly !== props.monthlyContribution || delayMonths !== 0
  const requestKey = JSON.stringify({ monthlyContribution: monthly, delayMonths, base: props.projectionInput })
  const currentResult = result?.key === requestKey && result.attempt === attempt ? result : null
  const computing = changed && currentResult == null
  // 未调整时直接使用同源的服务端结果；请求失败或尚未返回时不冒用上一次的试算。
  const preview: ScenarioPreview | null = changed ? currentResult?.data ?? null : props
  const error = changed ? currentResult?.error : null

  useEffect(() => {
    if (!changed) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const response = await previewGoalScenario(JSON.parse(requestKey))
        if (!cancelled) setResult({
          key: requestKey,
          attempt,
          data: response.ok ? response.data ?? null : null,
          error: response.ok ? response.data ? null : '试算未返回结果，请重新试算' : response.error,
        })
      } catch {
        if (!cancelled) setResult({ key: requestKey, attempt, data: null, error: '试算暂时无法完成，请重新试算' })
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [requestKey, changed, attempt])

  const maxMonthly = Math.max(15000, Math.ceil(Math.max(props.monthlyContribution, props.sustainableMonthlySavings, props.requiredMonthly) * 1.6 / 500) * 500)
  const gap = preview ? Math.max(0, preview.fireNumberAtRetirement - preview.projectedMedian) : null

  async function apply() {
    if (!preview || computing || !changed || pending) return
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
        <div className="goal-scenario-controls">
          <label>
            <span>每月投入 <strong>{money(monthly)}</strong></span>
            <input type="range" min="0" max={maxMonthly} step="500" value={monthly} disabled={pending} onChange={(event) => {
              setMonthly(Number(event.target.value))
              setMsg(null)
            }} />
          </label>
          <label>
            <span>目标日期 <strong>{delayMonths > 0 ? `延后 ${delayMonths} 个月` : '不变'}</strong></span>
            <input type="range" min="0" max="36" step="6" value={delayMonths} disabled={pending} onChange={(event) => {
              setDelayMonths(Number(event.target.value))
              setMsg(null)
            }} />
          </label>
        </div>

        <div className="goal-scenario-results" aria-live="polite" aria-busy={computing}>
          <div><span>预计达成</span><strong>{preview ? monthAfter(preview.estimatedFireMonths) : '—'}</strong></div>
          <div><span>目标日预计资产</span><strong>{preview ? money(preview.projectedMedian) : '—'}</strong></div>
          <div><span>目标日资金缺口</span><strong>{gap == null ? '—' : money(gap)}</strong></div>
        </div>
        <p className="goal-scenario-status" role="status">
          {computing ? '引擎重算中…' : preview ? `按此期限需投入 ${money(preview.requiredMonthly)} / 月` : '当前试算未完成'}
        </p>
        <FormMsg msg={error ? { ok: false, text: error } : msg} />
        <div className="goal-scenario-actions">
          <button
            type="button"
            className={btnGhostCls}
            disabled={!hasSavingsEvidence || !canWrite || pending}
            title={hasSavingsEvidence ? (canWrite ? undefined : '只读成员不能把储蓄参考写入试算') : `目前只有 ${props.savingsEvidenceMonths} 个月有效收支记录，至少需要 3 个月`}
            onClick={() => {
              setMonthly(Math.max(0, Math.round(props.sustainableMonthlySavings / 500) * 500))
              setMsg(null)
            }}
          >
            {hasSavingsEvidence ? `采用储蓄参考 ${money(props.sustainableMonthlySavings)}` : '储蓄能力证据不足'}
          </button>
          {error && <button type="button" className={btnGhostCls} onClick={() => setAttempt((value) => value + 1)}>重新试算</button>}
          {canWrite ? (
            <button type="button" onClick={apply} disabled={pending || !changed || !preview || computing} className={btnCls}>
              {pending ? '保存中…' : changed ? '保存到主目标' : '试算未变化'}
            </button>
          ) : (
            <span className="text-[12px] text-ink-faint">只读成员可以试算预览；保存需家庭所有者权限。</span>
          )}
        </div>
      </div>
    </section>
  )
}
