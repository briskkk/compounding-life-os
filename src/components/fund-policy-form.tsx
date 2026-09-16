'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { deleteFundTradePolicy, saveFundTradePolicy } from '@/lib/actions'
import { parseRedemptionFeeRules } from '@/lib/engine/fund-policy'
import { btnCls, Field, FormMsg, inputCls } from './fields'
import { useConfirm } from '@/components/confirm-dialog'

interface FundOption {
  id: string
  symbol: string
  name: string
}

interface PolicyOption {
  id: string
  assetId: string
  purchaseFeeRate: number
  redemptionFeeRules: string
  purchaseSuspendedFrom: string | null
  purchaseSuspendedUntil: string | null
  sourceName: string
  sourceReference: string | null
  note: string | null
}

function dateInput(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

function rulesText(value: string): string {
  return parseRedemptionFeeRules(value)
    .map((rule) => `${rule.maxHoldingDays}:${(rule.rate * 100).toFixed(2).replace(/\.00$/, '')}`)
    .join(', ')
}

function parseRules(value: string) {
  if (!value.trim()) return []
  return value.split(/[，,\n]+/).map((part) => {
    const [days, rate] = part.trim().split(/[:：]/).map((item) => item.trim())
    return { maxHoldingDays: Number(days), rate: Number(rate) / 100 }
  })
}

export function FundPolicyForm({ funds, policies }: { funds: FundOption[]; policies: PolicyOption[] }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const confirm = useConfirm()
  const [assetId, setAssetId] = useState(funds[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const selected = useMemo(() => policies.find((policy) => policy.assetId === assetId) ?? null, [assetId, policies])
  const formKey = `${assetId}:${selected?.id ?? 'new'}`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    setPending(true)
    setMsg(null)
    const res = await saveFundTradePolicy({
      assetId,
      purchaseFeeRate: Number(fd.get('purchaseFeeRate')) / 100,
      redemptionFeeRules: parseRules(String(fd.get('redemptionFeeRules') ?? '')),
      purchaseSuspendedFrom: fd.get('purchaseSuspendedFrom') ? new Date(`${fd.get('purchaseSuspendedFrom')}T12:00:00`) : null,
      purchaseSuspendedUntil: fd.get('purchaseSuspendedUntil') ? new Date(`${fd.get('purchaseSuspendedUntil')}T12:00:00`) : null,
      sourceName: String(fd.get('sourceName') ?? ''),
      sourceReference: String(fd.get('sourceReference') ?? '') || null,
      note: String(fd.get('note') ?? '') || null,
    })
    setPending(false)
    if (res.ok) {
      navigateAfterWrite({ message: '基金交易规则已保存并接入流水校验' })
      return
    }
    setMsg({ ok: false, text: res.error })
  }

  async function remove() {
    if (!selected) return
    const ok = await confirm({
      title: '删除这条基金交易规则？',
      impacts: ['规则从「持仓匹配」中移除', '已写入的历史流水不会改变'],
      confirmLabel: '删除规则',
      tone: 'danger',
    })
    if (!ok) return
    setPending(true)
    const res = await deleteFundTradePolicy(selected.id)
    setPending(false)
    if (res.ok) {
      navigateAfterWrite({ message: '规则已删除' })
      return
    }
    setMsg({ ok: false, text: res.error })
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div>
        <div className="eyebrow">RULE SUBJECT</div>
        <h3 className="mt-3 text-[22px] text-ink">选择要维护的基金</h3>
        <p className="mt-2 text-[13px] leading-6 text-ink-faint">只记录基金公司或销售平台披露的规则。费率作为录入参考，暂停申购窗口会在写入账本前硬性校验。</p>
        <select value={assetId} onChange={(event) => { setAssetId(event.target.value); setMsg(null) }} className={`${inputCls} mt-5`}>
          {funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name} · {fund.symbol}</option>)}
        </select>
        <div className="mt-4 border-l-2 border-accent/60 pl-4 text-[12px] leading-5 text-ink-faint">
          红利再投与现金分红不是普通买卖，请通过公司行动账本录入，系统会生成可冲正的分红、份额和现金结算腿。
        </div>
      </div>

      <form key={formKey} onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
        <Field label="申购费率（%）">
          <input name="purchaseFeeRate" type="number" min="0" max="20" step="0.001" defaultValue={(selected?.purchaseFeeRate ?? 0) * 100} className={inputCls} />
        </Field>
        <Field label="赎回费率阶梯">
          <input name="redemptionFeeRules" defaultValue={selected ? rulesText(selected.redemptionFeeRules) : ''} className={inputCls} placeholder="7:1.5, 30:0.5, 365:0" />
          <span className="mt-1 block text-[12px] text-ink-faint">格式：持有天数上限:费率%，逗号分隔；实际费用仍以成交单为准。</span>
        </Field>
        <Field label="暂停申购开始">
          <input name="purchaseSuspendedFrom" type="date" defaultValue={dateInput(selected?.purchaseSuspendedFrom ?? null)} className={inputCls} />
        </Field>
        <Field label="暂停申购结束">
          <input name="purchaseSuspendedUntil" type="date" defaultValue={dateInput(selected?.purchaseSuspendedUntil ?? null)} className={inputCls} />
        </Field>
        <Field label="规则来源">
          <input name="sourceName" required defaultValue={selected?.sourceName ?? ''} className={inputCls} placeholder="基金公司公告 / 销售平台费率页" />
        </Field>
        <Field label="来源链接或公告编号">
          <input name="sourceReference" defaultValue={selected?.sourceReference ?? ''} className={inputCls} placeholder="可选，用于之后复核" />
        </Field>
        <Field label="备注" className="lg:col-span-2">
          <input name="note" defaultValue={selected?.note ?? ''} className={inputCls} placeholder="例如：平台一折费率，公告日期" />
        </Field>
        <div className="flex min-h-12 items-center justify-between gap-4 lg:col-span-2">
          <FormMsg msg={msg} />
          <div className="flex shrink-0 gap-3">
            {selected && <button type="button" disabled={pending} onClick={remove} className="min-h-11 px-3 text-[13px] text-down">删除规则</button>}
            <button type="submit" disabled={pending} className={btnCls}>{pending ? '保存中…' : selected ? '更新规则' : '保存规则'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
