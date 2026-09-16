'use client'

// 负债登记表单 + 放款/还款/余额调整表单
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState, type FormEvent } from 'react'
import { addLiabilityEntry, createLiability } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'
import { LIABILITY_ENTRY_TYPE_LABEL, LIABILITY_TYPE_LABEL } from '@/lib/labels'

export function LiabilityForm() {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setPending(true)
    setMsg(null)
    const rateRaw = String(fd.get('rate') ?? '').trim()
    const res = await createLiability({
      name: String(fd.get('name')),
      type: String(fd.get('type')),
      rate: rateRaw === '' ? null : Number(rateRaw) / 100,
      note: null,
    })
    setPending(false)
    if (res.ok) {
      form.reset()
      navigateAfterWrite(res.warning
        ? { message: res.warning, tone: 'warn' }
        : { message: '负债已登记，记得补一条「放款」条目' })
    } else setMsg({ ok: false, text: res.error })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="负债名称">
        <input name="name" required className={inputCls} placeholder="滨江房贷" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="类型">
          <select name="type" className={inputCls}>
            {Object.entries(LIABILITY_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="年利率（%，可选）">
          <input name="rate" type="number" min="0" step="any" className={inputCls} placeholder="4.2" />
        </Field>
      </div>
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '登记中…' : '登记负债'}
      </button>
    </form>
  )
}

export function LiabilityEntryForm({ liabilities }: { liabilities: { id: string; name: string }[] }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setPending(true)
    setMsg(null)
    const res = await addLiabilityEntry({
      liabilityId: String(fd.get('liabilityId')),
      type: String(fd.get('type')),
      amount: Number(fd.get('amount')),
      occurredAt: new Date(String(fd.get('occurredAt'))),
      note: (fd.get('note') as string) || null,
    })
    setPending(false)
    if (res.ok) {
      form.reset()
      navigateAfterWrite(res.warning
        ? { message: res.warning, tone: 'warn' }
        : { message: '已入账，净资产已重算' })
    } else setMsg({ ok: false, text: res.error })
  }

  if (liabilities.length === 0) return <p className="text-[13px] text-ink-faint">先登记一笔负债。</p>

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="负债">
        <select name="liabilityId" required className={inputCls}>
          {liabilities.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="类型">
          <select name="type" className={inputCls}>
            {Object.entries(LIABILITY_ENTRY_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="金额（¥）">
          <input name="amount" type="number" min="0" step="any" required className={inputCls} />
        </Field>
        <Field label="日期">
          <input name="occurredAt" type="date" required defaultValue={today} className={inputCls} />
        </Field>
        <Field label="备注">
          <input name="note" className={inputCls} placeholder="可选" />
        </Field>
      </div>
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '入账中…' : '入账'}
      </button>
    </form>
  )
}
