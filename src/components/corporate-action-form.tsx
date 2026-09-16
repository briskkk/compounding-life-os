'use client'

import { useMemo, useState, useTransition } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { createCorporateAction } from '@/lib/actions'
import { CORPORATE_ACTION_HELP, CORPORATE_ACTION_LABEL, type CorporateActionKind } from '@/lib/corporate-actions'
import { FormMsg, inputCls } from './fields'

type AccountOption = { id: string; name: string; currency: string }
type AssetOption = { id: string; symbol: string; name: string; cls: string; currency: string }

const labelCls = 'mb-1 block text-[13px] text-ink-faint'

const ratioTypes: CorporateActionKind[] = ['SPLIT', 'REVERSE_SPLIT', 'STOCK_DIVIDEND', 'SYMBOL_CHANGE', 'MERGER_EXCHANGE', 'SPINOFF']
const targetAssetTypes: CorporateActionKind[] = ['SYMBOL_CHANGE', 'MERGER_EXCHANGE', 'SPINOFF']

function todayInput(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function num(value: FormDataEntryValue | null): number | null {
  if (value == null || String(value).trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function CorporateActionForm({ accounts, assets }: { accounts: AccountOption[]; assets: AssetOption[] }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [type, setType] = useState<CorporateActionKind>('CASH_DISTRIBUTION')
  const [assetId, setAssetId] = useState(assets[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const selectedAsset = assets.find((asset) => asset.id === assetId)
  const eligibleAccounts = useMemo(
    () => accounts.filter((account) => !selectedAsset || account.currency === selectedAsset.currency),
    [accounts, selectedAsset],
  )
  const targetAssets = assets.filter((asset) => asset.id !== assetId && (!selectedAsset || asset.currency === selectedAsset.currency))
  const showRatio = ratioTypes.includes(type)
  const showTargetAsset = targetAssetTypes.includes(type)
  const showTargetAccount = type === 'CUSTODY_TRANSFER' || type === 'SYMBOL_CHANGE' || type === 'MERGER_EXCHANGE' || type === 'SPINOFF'
  const showTrade = type === 'RIGHTS_ISSUE' || type === 'FUND_REINVESTMENT'
  const showCash = type === 'CASH_DISTRIBUTION' || type === 'FUND_REINVESTMENT'

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        setMsg(null)
        startTransition(async () => {
          const effectiveDate = String(form.get('effectiveAt'))
          const result = await createCorporateAction({
            type,
            accountId: String(form.get('accountId') ?? ''),
            assetId,
            targetAccountId: String(form.get('targetAccountId') ?? '') || null,
            targetAssetId: String(form.get('targetAssetId') ?? '') || null,
            effectiveAt: new Date(`${effectiveDate}T12:00:00`),
            ratioNumerator: num(form.get('ratioNumerator')),
            ratioDenominator: num(form.get('ratioDenominator')),
            quantity: num(form.get('quantity')),
            price: num(form.get('price')),
            cashAmount: num(form.get('cashAmount')) ?? 0,
            fee: num(form.get('fee')) ?? 0,
            costAllocation: num(form.get('costAllocation')) == null ? null : num(form.get('costAllocation'))! / 100,
            sourceName: String(form.get('sourceName') ?? ''),
            sourceReference: String(form.get('sourceReference') ?? '') || null,
            note: String(form.get('note') ?? '') || null,
          })
          if (result.ok) {
            setMsg({ ok: true, text: `已记录${CORPORATE_ACTION_LABEL[type]}并重建历史持仓${result.warning ? `；${result.warning}` : ''}` })
            navigateAfterWrite({ message: '公司行动已登记并展开为可冲正流水' })
          } else {
            setMsg({ ok: false, text: result.error })
          }
        })
      }}
    >
      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-6 border-b border-line pb-6">
        <div>
          <label className={labelCls}>事件类型</label>
          <select value={type} onChange={(event) => setType(event.target.value as CorporateActionKind)} className={inputCls}>
            {Object.entries(CORPORATE_ACTION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="pt-7 text-[14px] leading-6 text-ink-dim">
          <strong className="font-medium text-ink">{CORPORATE_ACTION_LABEL[type]}</strong>
          <span className="ml-3">{CORPORATE_ACTION_HELP[type]}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label><span className={labelCls}>来源资产</span><select name="assetId" value={assetId} onChange={(event) => setAssetId(event.target.value)} className={inputCls} required>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label>
        <label><span className={labelCls}>来源账户</span><select name="accountId" className={inputCls} required><option value="">请选择</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label><span className={labelCls}>生效日</span><input name="effectiveAt" type="date" defaultValue={todayInput()} max={todayInput()} className={inputCls} required /></label>
      </div>

      {(showTargetAsset || showTargetAccount) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {showTargetAsset && <label><span className={labelCls}>目标资产</span><select name="targetAssetId" className={inputCls} required><option value="">请选择已登记的目标资产</option>{targetAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label>}
          {showTargetAccount && <label><span className={labelCls}>目标账户{type === 'CUSTODY_TRANSFER' ? '' : '（可选）'}</span><select name="targetAccountId" className={inputCls} required={type === 'CUSTODY_TRANSFER'}><option value="">{type === 'CUSTODY_TRANSFER' ? '请选择' : '沿用来源账户'}</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
        </div>
      )}

      {showRatio && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
          <label><span className={labelCls}>新份额</span><input name="ratioNumerator" type="number" min="0.000001" step="any" className={inputCls} placeholder="例如 8" required /></label>
          <span className="pb-3 text-ink-faint">:</span>
          <label><span className={labelCls}>原份额</span><input name="ratioDenominator" type="number" min="0.000001" step="any" className={inputCls} placeholder="例如 1" required /></label>
        </div>
      )}

      {showTrade && <div className="grid gap-4 lg:grid-cols-2"><label><span className={labelCls}>{type === 'RIGHTS_ISSUE' ? '新增数量' : '确认份额'}</span><input name="quantity" type="number" min="0.000001" step="any" className={inputCls} required /></label><label><span className={labelCls}>{type === 'RIGHTS_ISSUE' ? '配股价格' : '再投净值'}</span><input name="price" type="number" min="0.000001" step="any" className={inputCls} required /></label></div>}
      {showCash && <div className="grid gap-4 lg:grid-cols-2"><label><span className={labelCls}>分配毛额</span><input name="cashAmount" type="number" min="0.01" step="any" className={inputCls} required /></label><label><span className={labelCls}>税费 / 手续费</span><input name="fee" type="number" min="0" step="any" defaultValue="0" className={inputCls} /></label></div>}
      {type === 'RIGHTS_ISSUE' && <label className="block"><span className={labelCls}>交易费用</span><input name="fee" type="number" min="0" step="any" defaultValue="0" className={inputCls} /></label>}
      {type === 'SPINOFF' && <label className="block"><span className={labelCls}>分配给新资产的成本比例（%）</span><input name="costAllocation" type="number" min="0.01" max="100" step="any" className={inputCls} required /></label>}

      <div className="grid gap-4 lg:grid-cols-2">
        <label><span className={labelCls}>事件来源</span><input name="sourceName" className={inputCls} placeholder="券商月结单 / 基金公告 / 交易所公告" required /></label>
        <label><span className={labelCls}>公告链接或凭证编号</span><input name="sourceReference" className={inputCls} placeholder="可选，但建议填写" /></label>
      </div>
      <label className="block"><span className={labelCls}>备注</span><textarea name="note" rows={2} className={inputCls} placeholder="记录税费口径、零碎股处理或人工核对结论" /></label>

      <div className="flex items-center justify-between gap-6 border-t border-line pt-5">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-faint">保存后会生成关联流水并重建生效日起的快照；若录错，请冲正整个事件，不要单独修改生成的流水。</p>
        <button type="submit" disabled={pending || assets.length === 0} className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-accent px-5 text-[14px] font-medium text-bg disabled:opacity-50">{pending ? '处理中…' : '记录公司行动'}</button>
      </div>
      <FormMsg msg={msg} />
    </form>
  )
}
