'use client'

// 账户 / 资产登记表单
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createAccount, createAsset, updateAccountSettlement } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, CURRENCY_LABEL } from '@/lib/labels'

export function AccountForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setPending(true)
    setMsg(null)
    const res = await createAccount({
      name: String(fd.get('name')),
      type: String(fd.get('type')),
      currency: String(fd.get('currency')),
      institution: (fd.get('institution') as string) || null,
      note: null,
    })
    setPending(false)
    if (res.ok) {
      setMsg({ ok: true, text: '账户已创建' })
      form.reset()
      router.refresh()
    } else setMsg({ ok: false, text: res.error })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="账户名称">
        <input name="name" required className={inputCls} placeholder="中信证券" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="类型">
          <select name="type" className={inputCls}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="币种">
          <select name="currency" className={inputCls}>
            {Object.entries(CURRENCY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="机构">
        <input name="institution" className={inputCls} placeholder="可选" />
      </Field>
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '创建中…' : '创建账户'}
      </button>
    </form>
  )
}

export function SettlementAccountForm({
  accountId,
  currentId,
  accounts,
}: {
  accountId: string
  currentId: string | null
  accounts: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(currentId ?? '')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => setSelectedId(currentId ?? ''), [currentId])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setMsg(null)
    const res = await updateAccountSettlement(accountId, {
      settlementAccountId: selectedId || null,
    })
    setPending(false)
    if (res.ok) {
      const moved = res.data?.moved ?? 0
      setMsg({ ok: true, text: moved > 0 ? `已保存，并归集 ${moved} 条历史现金流水` : '资金账户已保存' })
      router.refresh()
    } else {
      setMsg({ ok: false, text: res.error })
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 border-t border-line pt-3">
      <label className="block text-[12px] text-ink-faint">资金结算账户</label>
      <div className="mt-1.5 flex gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={`${inputCls} min-w-0 flex-1`}
        >
          <option value="">不自动联动现金</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.id === accountId ? `${account.name}（本账户）` : account.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending || selectedId === (currentId ?? '')}
          className="shrink-0 rounded border border-line bg-panel2 px-3 text-[13px] text-ink-dim hover:text-ink disabled:opacity-40"
        >
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
      <FormMsg msg={msg} />
    </form>
  )
}

export function AssetForm() {
  const router = useRouter()
  const [cls, setCls] = useState('STOCK')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [symbol, setSymbol] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'found' | 'notfound'>('idle')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const lastLookupName = useRef('')

  // 代码识别：模式完整后防抖查询，自动填充名称/类别/币种
  useEffect(() => {
    const s = symbol.trim().toUpperCase()
    const complete = /^\d{6}$/.test(s) || /^HK\d{4,5}$/.test(s) || /^US[A-Z]{1,6}(\.[A-Z])?$/.test(s)
    if (!complete) {
      setLookupState('idle')
      return
    }
    setLookupState('loading')
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lookup?symbol=${encodeURIComponent(s)}`, { cache: 'no-store' })
        const json = (await res.json()) as { found: boolean; name?: string; cls?: string; currency?: string }
        if (json.found && json.name) {
          setLookupState('found')
          const autoName = json.name
          // 仅在名称为空或仍是上一次自动填充值时覆盖，保留手动修改
          setName((prev) => (prev === '' || prev === lastLookupName.current ? autoName : prev))
          lastLookupName.current = autoName
          if (json.cls) setCls(json.cls)
          if (json.currency) setCurrency(json.currency)
        } else {
          setLookupState('notfound')
        }
      } catch {
        setLookupState('notfound')
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [symbol])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setPending(true)
    setMsg(null)
    const res = await createAsset({
      symbol: String(fd.get('symbol')),
      name,
      cls,
      currency,
      manual: fd.get('manual') === 'on',
      note: null,
    })
    setPending(false)
    if (res.ok) {
      setMsg({ ok: true, text: '资产已登记' })
      form.reset()
      setName('')
      setSymbol('')
      setLookupState('idle')
      router.refresh()
    } else setMsg({ ok: false, text: res.error })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="代码">
          <input
            name="symbol"
            required
            className={inputCls}
            placeholder="600519 / 110022 / USAAPL"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
        </Field>
        <Field label="类别">
          <select className={inputCls} value={cls} onChange={(e) => setCls(e.target.value)}>
            {Object.entries(ASSET_CLASS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="名称">
        <input name="name" required className={inputCls} placeholder="输入代码后自动识别" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {lookupState === 'loading' && <p className="text-[13px] text-ink-faint">识别中…</p>}
      {lookupState === 'found' && <p className="text-[13px] text-down">✓ 已自动识别名称、类别与币种</p>}
      {lookupState === 'notfound' && <p className="text-[13px] text-amber">未识别，请手动填写名称</p>}
      <Field label="币种">
        <select name="currency" className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {Object.entries(CURRENCY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      {cls !== 'REAL_ESTATE' && cls !== 'CASH' && (
        <label className="flex items-center gap-2 text-xs text-ink-dim">
          <input name="manual" type="checkbox" className="accent-[#c8a24a]" />
          手动估值（不接入行情源）
        </label>
      )}
      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '登记中…' : '登记资产'}
      </button>
    </form>
  )
}
