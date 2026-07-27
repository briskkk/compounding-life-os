'use client'

// 目标创建 / 编辑表单（一次性目标 + 支出流目标）
import { useRouter } from 'next/navigation'
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
  metric: 'NET_WORTH' | 'INVESTABLE'
  monthlyContribution: number
  expectedReturn: number
  volatility: number
  note: string
}

export function GoalForm({ mode, goalId, initial }: { mode: 'create' | 'edit'; goalId?: string; initial?: GoalInitial }) {
  const router = useRouter()
  const [open, setOpen] = useState(mode === 'create')
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
      spendYears: goalMode === 'STREAM' ? Number(fd.get('spendYears')) : 0,
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
      setMsg({ ok: true, text: mode === 'create' ? '目标已创建' : '已保存，路径已重算' })
      if (mode === 'edit') setOpen(false)
      router.refresh()
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  async function onDelete() {
    if (!goalId) return
    setPending(true)
    await deleteGoal(goalId)
    router.refresh()
  }

  if (!open) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <button type="button" onClick={() => setOpen(true)} className={btnGhostCls}>
          调整假设 / 编辑目标
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="目标名称">
          <input name="name" required defaultValue={initial?.name} className={inputCls} placeholder="子女教育金" />
        </Field>
        <Field label="目标类型">
          <select className={inputCls} value={goalMode} onChange={(e) => setGoalMode(e.target.value as 'LUMP_SUM' | 'STREAM')}>
            <option value="LUMP_SUM">一次性目标</option>
            <option value="STREAM">支出流目标</option>
          </select>
        </Field>
        {goalMode === 'LUMP_SUM' ? (
          <Field label="目标金额（¥）">
            <input name="targetAmount" type="number" min="1" step="any" required defaultValue={initial?.targetAmount} className={inputCls} />
          </Field>
        ) : (
          <>
            <Field label="每年支出（¥）">
              <input name="annualSpend" type="number" min="1" step="any" required defaultValue={initial?.annualSpend ?? 300000} className={inputCls} />
            </Field>
            <Field label="支出年数">
              <input name="spendYears" type="number" min="1" max="50" step="1" required defaultValue={initial?.spendYears ?? 6} className={inputCls} />
            </Field>
          </>
        )}
        <Field label={goalMode === 'LUMP_SUM' ? '目标日期' : '开始支出日期'}>
          <input name="targetDate" type="date" required defaultValue={initial?.targetDate} className={inputCls} />
        </Field>
        <Field label="统计口径">
          <select name="metric" defaultValue={initial?.metric ?? 'INVESTABLE'} className={inputCls}>
            <option value="INVESTABLE">可自由投资口径</option>
            <option value="NET_WORTH">净资产口径</option>
          </select>
        </Field>
        <Field label="每月投入（¥）">
          <input name="monthlyContribution" type="number" min="0" step="any" defaultValue={initial?.monthlyContribution ?? 0} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="期望年化（%）">
            <input name="expectedReturn" type="number" step="any" defaultValue={(initial?.expectedReturn ?? 0.07) * 100} className={inputCls} />
          </Field>
          <Field label="波动率（%）">
            <input name="volatility" type="number" min="1" step="any" defaultValue={(initial?.volatility ?? 0.15) * 100} className={inputCls} />
          </Field>
        </div>
      </div>
      <Field label="备注">
        <input name="note" defaultValue={initial?.note} className={inputCls} placeholder="可选" />
      </Field>
      <FormMsg msg={msg} />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? '保存中…' : mode === 'create' ? '创建目标' : '保存并重算'}
        </button>
        {mode === 'edit' && (
          <>
            <button type="button" onClick={() => setOpen(false)} className={btnGhostCls}>
              收起
            </button>
            <button type="button" onClick={onDelete} disabled={pending} className="ml-auto text-xs text-ink-faint hover:text-up">
              删除目标
            </button>
          </>
        )}
      </div>
    </form>
  )
}
