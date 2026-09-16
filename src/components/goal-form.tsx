'use client'

// FIRE 计划创建 / 编辑表单（直接设 FIRE Number + 按退休支出反推）
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

export function GoalForm({ mode, goalId, initial, initiallyOpen = false, onDone }: { mode: 'create' | 'edit'; goalId?: string; initial?: GoalInitial; initiallyOpen?: boolean; onDone?: () => void }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [open, setOpen] = useState(mode === 'create' || initiallyOpen)
  const [goalMode, setGoalMode] = useState<'LUMP_SUM' | 'STREAM'>(initial?.mode ?? 'LUMP_SUM')
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
      metric: String(fd.get('metric')) as 'NET_WORTH' | 'INVESTABLE',
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
      navigateAfterWrite({ message: mode === 'create' ? 'FIRE 计划已创建' : '已保存，FIRE 路径已重算' })
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  async function onDelete() {
    if (!goalId) return
    setPending(true)
    await deleteGoal(goalId)
    navigateAfterWrite({ message: 'FIRE 计划已删除' })
  }

  if (!open) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <button type="button" onClick={() => setOpen(true)} className={btnGhostCls}>
          调整假设 / 编辑计划
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="计划名称">
          <input name="name" required defaultValue={initial?.name} className={inputCls} placeholder="我的 FIRE 计划" />
        </Field>
        <Field label="FIRE Number 计算方式">
          <select className={inputCls} value={goalMode} onChange={(e) => setGoalMode(e.target.value as 'LUMP_SUM' | 'STREAM')}>
            <option value="LUMP_SUM">直接设定目标金额</option>
            <option value="STREAM">按退休支出反推</option>
          </select>
        </Field>
        <p className="self-end text-[12px] leading-5 text-ink-faint md:col-span-2">
          4% 提取率约等于 25 倍年度净支出，是规划起点而非收益保证；退休周期越长，可用更低提取率做压力测试。
        </p>
        {goalMode === 'LUMP_SUM' ? (
          <Field label="FIRE Number（今日购买力，¥）">
            <input name="targetAmount" type="number" min="1" step="any" required defaultValue={initial?.targetAmount} className={inputCls} />
          </Field>
        ) : (
          <Field label="预计年度退休支出（今日购买力，¥）">
            <input name="annualSpend" type="number" min="1" step="any" required defaultValue={initial?.annualSpend ?? 600000} className={inputCls} />
          </Field>
        )}
        <Field label="预计退休日期">
          <input name="targetDate" type="date" required defaultValue={initial?.targetDate} className={inputCls} />
        </Field>
        <Field label="年度稳定退休收入（今日购买力，¥）">
          <input name="retirementIncome" type="number" min="0" step="any" defaultValue={initial?.retirementIncome ?? 0} className={inputCls} />
        </Field>
        <Field label="退休规划年数">
          <input name="spendYears" type="number" min="10" max="70" step="1" required defaultValue={initial?.spendYears ?? 40} className={inputCls} />
        </Field>
        <Field label="安全提取率（%）">
          <input name="withdrawalRate" type="number" min="2" max="8" step="0.1" required defaultValue={Number(((initial?.withdrawalRate ?? 0.04) * 100).toFixed(2))} className={inputCls} />
        </Field>
        <Field label="长期通胀率（%）">
          <input name="inflationRate" type="number" min="0" max="15" step="0.1" required defaultValue={Number(((initial?.inflationRate ?? 0.025) * 100).toFixed(2))} className={inputCls} />
        </Field>
        <Field label="统计口径">
          <select name="metric" defaultValue={initial?.metric ?? 'INVESTABLE'} className={inputCls}>
            <option value="INVESTABLE">可自由投资口径</option>
            <option value="NET_WORTH">净资产口径（含非流动资产）</option>
          </select>
        </Field>
        <Field label="每月投入（¥）">
          <input name="monthlyContribution" type="number" min="0" step="any" defaultValue={initial?.monthlyContribution ?? 0} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="期望年化（%）">
            <input name="expectedReturn" type="number" step="any" defaultValue={Number(((initial?.expectedReturn ?? 0.07) * 100).toFixed(2))} className={inputCls} />
          </Field>
          <Field label="波动率（%）">
            <input name="volatility" type="number" min="1" step="any" defaultValue={Number(((initial?.volatility ?? 0.15) * 100).toFixed(2))} className={inputCls} />
          </Field>
        </div>
      </div>
      <Field label="备注">
        <input name="note" defaultValue={initial?.note} className={inputCls} placeholder="可选" />
      </Field>
      <FormMsg msg={msg} />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? '保存中…' : mode === 'create' ? '创建 FIRE 计划' : '保存并重算'}
        </button>
        {mode === 'edit' && (
          <>
            <button type="button" onClick={() => setOpen(false)} className={btnGhostCls}>
              收起
            </button>
            <button type="button" onClick={onDelete} disabled={pending} className="ml-auto text-xs text-ink-faint hover:text-up">
              删除计划
            </button>
          </>
        )}
      </div>
    </form>
  )
}
