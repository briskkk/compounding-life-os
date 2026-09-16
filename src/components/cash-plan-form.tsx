'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createCashPlan, deleteCashPlan } from '@/lib/actions'
import { btnCls, btnGhostCls, Field, FormMsg, inputCls } from './fields'

function localInputDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function CashPlanForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter()
  const [direction, setDirection] = useState('OUTFLOW')
  const [recurrence, setRecurrence] = useState('NONE')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fd = new FormData(form)
    const dueDate = String(fd.get('dueDate'))
    const endDate = String(fd.get('endDate') ?? '')
    setPending(true)
    setMsg(null)
    const result = await createCashPlan({
      title: String(fd.get('title')),
      direction,
      amountCny: Number(fd.get('amountCny') ?? 0),
      dueDate: `${dueDate}T12:00:00+08:00`,
      recurrence,
      endDate: endDate ? `${endDate}T12:00:00+08:00` : null,
      accountId: String(fd.get('accountId') ?? '') || null,
      note: String(fd.get('note') ?? '') || null,
    })
    setPending(false)
    if (result.ok) {
      setMsg({ ok: true, text: '计划事项已加入日历' })
      form.reset()
      setDirection('OUTFLOW')
      setRecurrence('NONE')
      router.refresh()
    } else {
      setMsg({ ok: false, text: result.error })
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="事项">
        <input name="title" required maxLength={60} className={inputCls} placeholder="例如：保险缴费 / 奖金到账" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="类型">
          <select value={direction} onChange={(event) => setDirection(event.target.value)} className={inputCls}>
            <option value="INFLOW">计划流入</option>
            <option value="OUTFLOW">计划流出</option>
            <option value="MILESTONE">仅提醒</option>
          </select>
        </Field>
        <Field label="金额（人民币）">
          <input name="amountCny" type="number" min="0" step="0.01" required={direction !== 'MILESTONE'} disabled={direction === 'MILESTONE'} className={inputCls} placeholder="0.00" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="首次日期">
          <input name="dueDate" type="date" required defaultValue={localInputDate()} className={inputCls} />
        </Field>
        <Field label="重复">
          <select value={recurrence} onChange={(event) => setRecurrence(event.target.value)} className={inputCls}>
            <option value="NONE">不重复</option>
            <option value="MONTHLY">每月</option>
            <option value="YEARLY">每年</option>
          </select>
        </Field>
      </div>
      {recurrence !== 'NONE' && (
        <Field label="结束日期（可选）">
          <input name="endDate" type="date" className={inputCls} />
        </Field>
      )}
      <Field label="关联账户（可选）">
        <select name="accountId" className={inputCls}>
          <option value="">不指定账户</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </Field>
      <Field label="备注（可选）">
        <input name="note" maxLength={200} className={inputCls} placeholder="用途、确认条件等" />
      </Field>
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>{pending ? '添加中…' : '加入资金日历'}</button>
    </form>
  )
}

export function DeleteCashPlanButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tone?: 'ok' | 'warn' | 'error' } | null>(null)

  async function remove() {
    if (!window.confirm('移除该计划事项？仅影响计划层，不会改动账本流水。')) return
    setPending(true)
    setMsg(null)
    const result = await deleteCashPlan(id)
    setPending(false)
    if (result.ok) {
      router.refresh()
      return
    }
    // 失败必须可见，此前只有成功分支，用户会以为已经移除
    setMsg({ ok: false, tone: 'error', text: result.error })
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={remove} disabled={pending} className={`${btnGhostCls} min-h-8 px-2.5 py-1 text-[12px]`}>{pending ? '移除中…' : '移除'}</button>
      <FormMsg msg={msg} />
    </span>
  )
}
