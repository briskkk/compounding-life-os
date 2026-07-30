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

function localDateInput(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

export function TxForm({
  accounts,
  assets,
  initialAccountId,
  initialAssetId,
  lockAccount = false,
}: {
  accounts: { id: string; name: string; currency: string; settlementAccountId: string | null; settlementAccountName: string | null }[]
  assets: { id: string; symbol: string; name: string; cls: string; currency: string }[]
  initialAccountId?: string
  initialAssetId?: string
  lockAccount?: boolean
}) {
  const router = useRouter()
  const requestedAsset = assets.find((asset) => asset.id === initialAssetId)
  const firstAccount = accounts.find((account) => account.id === initialAccountId)
    ?? accounts.find((account) => account.currency === requestedAsset?.currency)
    ?? accounts[0]
  const initialAsset = assets.find((asset) => asset.id === initialAssetId && asset.currency === firstAccount?.currency)
    ?? assets.find((asset) => asset.currency === firstAccount?.currency && asset.cls !== 'CASH')
    ?? assets.find((asset) => asset.currency === firstAccount?.currency)
  const defaultType: TxType = requestedAsset?.cls === 'CASH' ? 'DEPOSIT' : 'BUY'
  const [type, setType] = useState<TxType>(defaultType)
  const [accountId, setAccountId] = useState(firstAccount?.id ?? '')
  const [settle, setSettle] = useState(Boolean(firstAccount?.settlementAccountName))
  const [assetId, setAssetId] = useState(initialAsset?.id ?? '')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const today = localDateInput(new Date())
  const selectedAccount = accounts.find((account) => account.id === accountId)
  const selectedAsset = assets.find((asset) => asset.id === assetId)
  const compatibleAssets = assets.filter((asset) => asset.currency === selectedAccount?.currency)
  const routesCash = selectedAsset?.cls === 'CASH'
    && selectedAccount?.settlementAccountId
    && selectedAccount.settlementAccountId !== selectedAccount.id

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
      accountId,
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
      setType(defaultType)
      setSettle(Boolean(selectedAccount?.settlementAccountName))
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
            {Object.entries(TX_TYPE_LABEL).filter(([key]) => key !== 'REVERSAL').map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="账户">
        {lockAccount ? (
          <div className={`${inputCls} flex items-center justify-between`}>
            <span>{selectedAccount?.name ?? '—'}</span>
            <span className="text-[10px] text-ink-faint">当前账户</span>
          </div>
        ) : (
          <select
            name="accountId"
            required
            className={inputCls}
            value={accountId}
            onChange={(e) => {
              const nextId = e.target.value
              const nextAccount = accounts.find((account) => account.id === nextId)
              setAccountId(nextId)
              setSettle(Boolean(nextAccount?.settlementAccountName))
              if (selectedAsset?.currency !== nextAccount?.currency) {
                const nextAsset = assets.find((asset) => asset.currency === nextAccount?.currency && asset.cls !== 'CASH')
                  ?? assets.find((asset) => asset.currency === nextAccount?.currency)
                setAssetId(nextAsset?.id ?? '')
              }
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {/* 资产选择器不使用 <label> 包裹（label 的激活行为会把第二次点击派发到浮层按钮，导致下拉闪开闪关） */}
      <div>
        <span className="mb-1 block text-[11px] text-ink-faint">资产</span>
        <AssetPicker assets={compatibleAssets} value={assetId} onChange={setAssetId} />
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
          <input
            type="checkbox"
            checked={settle}
            disabled={!selectedAccount?.settlementAccountName}
            onChange={(e) => setSettle(e.target.checked)}
            className="accent-[#c8a24a] disabled:opacity-40"
          />
          {selectedAccount?.settlementAccountName
            ? `现金联动结算至 ${selectedAccount.settlementAccountName}`
            : '未配置资金账户，本次买卖不自动变动现金'}
        </label>
      )}
      {routesCash && (
        <p className="text-xs text-ink-dim">
          该现金流水将自动归入 {selectedAccount.settlementAccountName}，不在 {selectedAccount.name} 中重复形成现金持仓。
        </p>
      )}
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '写入中…' : '写入账本'}
      </button>
    </form>
  )
}
