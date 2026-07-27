'use client'

// 手动估值表单：为指定资产写入 VALUATION 流水
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { createTransaction } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'
import { fmtCNY } from '@/lib/format'

export function ValuationForm({
  assets,
}: {
  assets: { id: string; name: string; accountId: string; current: number | null }[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [assetId, setAssetId] = useState(assets[0]?.id ?? '')
  const selected = assets.find((a) => a.id === assetId)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    if (!selected) return
    setPending(true)
    setMsg(null)
    const res = await createTransaction({
      accountId: selected.accountId,
      assetId: selected.id,
      type: 'VALUATION',
      quantity: null,
      price: null,
      amount: Number(fd.get('amount')),
      fee: 0,
      occurredAt: new Date(String(fd.get('occurredAt'))),
      note: (fd.get('note') as string) || '手动估值更新',
    })
    setPending(false)
    if (res.ok) {
      setMsg({ ok: true, text: '估值已写入流水' })
      form.reset()
      router.refresh()
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  if (assets.length === 0) return null
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="资产">
        <select name="assetId" className={inputCls} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.current != null ? `（当前 ${fmtCNY(a.current)}）` : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="最新估值总额（¥）">
        <input name="amount" type="number" min="0" step="any" required className={inputCls} placeholder="3450000" />
      </Field>
      <Field label="估值日期">
        <input name="occurredAt" type="date" required defaultValue={today} className={inputCls} />
      </Field>
      <Field label="备注">
        <input name="note" className={inputCls} placeholder="季度估值" />
      </Field>
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending || !selected?.accountId} className={btnCls}>
        {pending ? '写入中…' : '提交估值'}
      </button>
      {!selected?.accountId && <p className="text-[11px] text-ink-faint">该资产尚无持仓记录，先在流水页录入一笔买入。</p>}
    </form>
  )
}
