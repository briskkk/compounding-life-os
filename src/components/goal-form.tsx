'use client'

import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState, type FormEvent } from 'react'
import { createGoal, deleteGoal, updateGoal } from '@/lib/actions'
import { Field, FormMsg, btnCls, btnGhostCls, inputCls } from './fields'

export interface GoalInitial {
  name: string
  mode: 'LUMP_SUM' | 'STREAM'
  targetAmount: number
  targetDate: string
  annualSpend: number | null
  spendYears: number | null
  retirementIncome: number
  withdrawalRate: number
  inflationRate: number
  metric: 'NET_WORTH' | 'INVESTABLE'
  monthlyContribution: number
  expectedReturn: number
  volatility: number
  note: string
}

export function GoalForm({ mode, goalId, initial, initiallyOpen = false, canWrite = true, onDone }: { mode: 'create' | 'edit'; goalId?: string; initial?: GoalInitial; initiallyOpen?: boolean; canWrite?: boolean; onDone?: () => void }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [open, setOpen] = useState(mode === 'create' || initiallyOpen)
  const [goalMode, setGoalMode] = useState<'LUMP_SUM' | 'STREAM'>(initial?.mode ?? 'LUMP_SUM')
  const [metric, setMetric] = useState<'NET_WORTH' | 'INVESTABLE'>(initial?.metric ?? 'INVESTABLE')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload = {
      name: String(fd.get('name')),
      mode: goalMode,
      targetAmount: goalMode === 'LUMP_SUM' ? Number(fd.get('targetAmount')) : 0,
      targetDate: new Date(String(fd.get('targetDate'))),
      annualSpend: goalMode === 'STREAM' ? Number(fd.get('annualSpend')) : 0,
      spendYears: Number(fd.get('spendYears')),
      retirementIncome: Number(fd.get('retirementIncome') ?? 0),
      withdrawalRate: Number(fd.get('withdrawalRate') ?? 4) / 100,
      inflationRate: Number(fd.get('inflationRate') ?? 2.5) / 100,
      metric: goalMode === 'STREAM' ? 'NET_WORTH' as const : metric,
      monthlyContribution: Number(fd.get('monthlyContribution') ?? 0),
      expectedReturn: Number(fd.get('expectedReturn') ?? 7) / 100,
      volatility: Number(fd.get('volatility') ?? 15) / 100,
      note: (fd.get('note') as string) || null,
    }
    setPending(true)
    setMsg(null)
    const res = mode === 'create' ? await createGoal(payload) : await updateGoal(goalId!, payload)
    setPending(false)
    if (res.ok) {
      if (mode === 'edit') setOpen(false)
      onDone?.()
      navigateAfterWrite({ message: mode === 'create' ? '目标已保存' : '目标已更新并重算' })
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  async function onDelete() {
    if (!goalId) return
    setPending(true)
    const response = await deleteGoal(goalId)
    if (response.ok) navigateAfterWrite({ message: '目标已删除' })
    else {
      setPending(false)
      setMsg({ ok: false, text: response.error })
    }
  }

  // 只读成员不渲染目标表单：写入入口由页面级的 ReadOnlyNotice 统一说明，不做静默禁用。
  if (!canWrite) return null

  if (!open) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <button type="button" onClick={() => setOpen(true)} className={btnGhostCls}>编辑目标</button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="goal-form mt-3 space-y-4 border-t border-line pt-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="目标名称">
          <input name="name" required defaultValue={initial?.name} className={inputCls} placeholder="例如：2036 年目标" />
        </Field>
        <Field label="目标类型">
          <select className={inputCls} value={goalMode} onChange={(event) => setGoalMode(event.target.value as 'LUMP_SUM' | 'STREAM')}>
            <option value="LUMP_SUM">普通财富目标</option>
            <option value="STREAM">退休目标</option>
          </select>
        </Field>
        {goalMode === 'LUMP_SUM' ? (
          <Field label="目标金额（今日购买力，¥）">
            <input name="targetAmount" type="number" min="1" step="any" required defaultValue={initial?.targetAmount} className={inputCls} />
          </Field>
        ) : (
          <Field label="年度退休支出（今日购买力，¥）">
            <input name="annualSpend" type="number" min="1" step="any" required defaultValue={initial?.annualSpend ?? 600000} className={inputCls} />
          </Field>
        )}
        <Field label="目标日期">
          <input name="targetDate" type="date" required defaultValue={initial?.targetDate} className={inputCls} />
        </Field>
        <Field label="每月计划投入（¥）">
          <input name="monthlyContribution" type="number" min="0" step="any" defaultValue={initial?.monthlyContribution ?? 0} className={inputCls} />
        </Field>
      </div>

      <details className="goal-form-advanced">
        <summary>高级假设</summary>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {goalMode === 'LUMP_SUM' ? (
            <Field label="当前资本口径">
              <select value={metric} onChange={(event) => setMetric(event.target.value as 'NET_WORTH' | 'INVESTABLE')} className={inputCls}>
                <option value="INVESTABLE">可自由投资资产</option>
                <option value="NET_WORTH">家庭净资产</option>
              </select>
            </Field>
          ) : (
            <div className="goal-form-scope">
              <span>当前资本口径</span>
              <strong>家庭净资产</strong>
              <small>纳入员工持股、房产等长期资产，并扣除负债</small>
            </div>
          )}
          <Field label="长期通胀率（%）">
            <input name="inflationRate" type="number" min="0" max="15" step="0.1" required defaultValue={Number(((initial?.inflationRate ?? 0.025) * 100).toFixed(2))} className={inputCls} />
          </Field>
          {goalMode === 'STREAM' && (
            <>
              <Field label="年度稳定退休收入（¥）">
                <input name="retirementIncome" type="number" min="0" step="any" defaultValue={initial?.retirementIncome ?? 0} className={inputCls} />
              </Field>
              <Field label="退休规划年数">
                <input name="spendYears" type="number" min="10" max="70" step="1" required defaultValue={initial?.spendYears ?? 40} className={inputCls} />
              </Field>
              <Field label="安全提取率（%）">
                <input name="withdrawalRate" type="number" min="2" max="8" step="0.1" required defaultValue={Number(((initial?.withdrawalRate ?? 0.04) * 100).toFixed(2))} className={inputCls} />
              </Field>
            </>
          )}
          {goalMode !== 'STREAM' && <input type="hidden" name="retirementIncome" value={initial?.retirementIncome ?? 0} />}
          {goalMode !== 'STREAM' && <input type="hidden" name="spendYears" value={initial?.spendYears ?? 40} />}
          {goalMode !== 'STREAM' && <input type="hidden" name="withdrawalRate" value={Number(((initial?.withdrawalRate ?? 0.04) * 100).toFixed(2))} />}
          <div className="grid grid-cols-2 gap-3 md:col-span-2">
            <Field label={goalMode === 'STREAM' || metric === 'NET_WORTH' ? '综合资产年化假设（%）' : '兜底年化收益（%）'}>
              <input name="expectedReturn" type="number" step="any" defaultValue={Number(((initial?.expectedReturn ?? 0.07) * 100).toFixed(2))} className={inputCls} />
            </Field>
            <Field label={goalMode === 'STREAM' || metric === 'NET_WORTH' ? '综合资产波动假设（%）' : '兜底波动率（%）'}>
              <input name="volatility" type="number" min="1" step="any" defaultValue={Number(((initial?.volatility ?? 0.15) * 100).toFixed(2))} className={inputCls} />
            </Field>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-ink-faint" title={goalMode === 'STREAM' || metric === 'NET_WORTH' ? '家庭净资产包含员工持股、房产等长期资产并扣除负债；这些资产没有完整的可交易组合模型，因此投影统一采用这里填写的综合收益与波动假设。' : '存在可投资组合权重时，投影使用资产类别协方差模型；没有可用组合时才采用这里的兜底收益与波动假设。'}>
          {goalMode === 'STREAM' || metric === 'NET_WORTH' ? '含长期资产并扣负债；收益按综合假设测算。' : '收益模型优先跟随当前可投资组合；兜底假设只在组合模型不可用时生效。'}
        </p>
      </details>

      <Field label="备注">
        <input name="note" defaultValue={initial?.note} className={inputCls} placeholder="可选" />
      </Field>
      <FormMsg msg={msg} />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={btnCls}>{pending ? '保存中…' : mode === 'create' ? '保存为主目标' : '保存并重算'}</button>
        {mode === 'edit' && (
          <>
            <button type="button" onClick={() => setOpen(false)} className={btnGhostCls}>收起</button>
            <button type="button" onClick={onDelete} disabled={pending} className="ml-auto text-xs text-ink-faint hover:text-danger">删除目标</button>
          </>
        )}
      </div>
    </form>
  )
}
