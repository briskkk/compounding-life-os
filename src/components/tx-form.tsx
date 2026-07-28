'use client'

// 手工录入流水
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { createTransaction } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'
import { AssetPicker } from './asset-picker'
import { TX_TYPE_LABEL } from '@/lib/labels'
import type { TxType } from '@/lib/engine/types'

const NEEDS_QTY: TxType[] = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT', 'VEST']
const NEEDS_PRICE: TxType[] = ['BUY', 'SELL']

export function TxForm({
  accounts,
  assets,
}: {
  accounts: { id: string; name: string }[]
  assets: { id: string; symbol: string; name: string; cls: string }[]
}) {
  const router = useRouter()
  const [type, setType] = useState<TxType>('BUY')
  const [settle, setSettle] = useState(true)
  const [assetId, setAssetId] = useState(assets[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const num = (k: string) => {
      const v = fd.get(k)
      if (v == null || String(v).trim() === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    let quantity = num('quantity')
    let price = num('price')
    let amount = num('amount')
    if ((type === 'BUY' || type === 'SELL') && amount == null && quantity != null && price != null) {
      amount = quantity * price
    }
    setPending(true)
    setMsg(null)
    const res = await createTransaction({
      accountId: String(fd.get('accountId')),
      assetId: String(fd.get('assetId')),
      type,
      quantity,
      price,
      amount: amount ?? 0,
      fee: num('fee') ?? 0,
      occurredAt: new Date(String(fd.get('occurredAt'))),
      note: (fd.get('note') as string) || null,
      settleCash: settle && (type === 'BUY' || type === 'SELL'),
    })
    setPending(false)
    if (res.ok) {
      setMsg({ ok: true, text: res.warning ?? '已写入账本，快照已重建' })
      form.reset()
      setType('BUY')
      router.refresh()
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="日期">
          <input name="occurredAt" type="date" required defaultValue={today} className={inputCls} />
        </Field>
        <Field label="类型">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as TxType)}>
            {Object.entries(TX_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="账户">
        <select name="accountId" required className={inputCls}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {/* 资产选择器不使用 <label> 包裹（label 的激活行为会把第二次点击派发到浮层按钮，导致下拉闪开闪关） */}
      <div>
        <span className="mb-1 block text-[11px] text-ink-faint">资产</span>
        <AssetPicker assets={assets} value={assetId} onChange={setAssetId} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {NEEDS_QTY.includes(type) && (
          <Field label="数量">
            <input name="quantity" type="number" min="0" step="any" required className={inputCls} />
          </Field>
        )}
        {NEEDS_PRICE.includes(type) && (
          <Field label="单价">
            <input name="price" type="number" min="0" step="any" required className={inputCls} />
          </Field>
        )}
        <Field label={type === 'VALUATION' ? '估值总额' : '金额（买卖可留空）'} className={NEEDS_QTY.includes(type) ? '' : 'col-span-2'}>
          <input name="amount" type="number" min="0" step="any" className={inputCls} required={!NEEDS_PRICE.includes(type)} />
        </Field>
        <Field label="费用">
          <input name="fee" type="number" min="0" step="any" defaultValue={0} className={inputCls} />
        </Field>
      </div>
      <Field label="备注">
        <input name="note" className={inputCls} placeholder="可选" />
      </Field>
      {(type === 'BUY' || type === 'SELL') && (
        <label className="flex items-center gap-2 text-xs text-ink-dim">
          <input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} className="accent-[#c8a24a]" />
          现金联动结算（{type === 'BUY' ? '买入自动扣减同账户现金' : '卖出自动回笼同账户现金'}）
        </label>
      )}
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '写入中…' : '写入账本'}
      </button>
    </form>
  )
}
