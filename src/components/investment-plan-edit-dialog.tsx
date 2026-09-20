'use client'

// 计划编辑弹窗：原生 <dialog> 模态（Esc 关闭、焦点圈禁、关闭后焦点归还）。
// ADR-028：只影响未来计划节点，历史流水与已核对证据不变。
import { useEffect, useRef, useState, useMemo, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { updateInvestmentPlan } from '@/lib/actions'
import { btnCls, btnGhostCls, Field, FormMsg, inputCls } from './fields'

export interface EditPlanInitial {
  id: string
  name: string
  amount: number
  cadence: 'WEEKDAY' | 'WEEKLY' | 'MONTHLY'
  scheduleDay: number | null
  startDate: string
  endDate: string | null
  accountId: string | null
  assetIds: string[]
  note: string | null
}

export interface PlanAssetOption {
  id: string
  symbol: string
  name: string
  cls: string
  currency: string
}

export interface PlanAccountOption {
  id: string
  name: string
  currency: string
}

export function InvestmentPlanEditDialog({
  initial,
  assets,
  accounts,
}: {
  initial: EditPlanInitial
  assets: PlanAssetOption[]
  accounts: PlanAccountOption[]
}) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [cadence, setCadence] = useState(initial.cadence)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(initial.assetIds)
  const [accountId, setAccountId] = useState(initial.accountId ?? '')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const selectedCurrency = useMemo(
    () => assets.find((asset) => selectedAssetIds.includes(asset.id))?.currency ?? null,
    [assets, selectedAssetIds],
  )
  const compatibleAccounts = selectedCurrency ? accounts.filter((account) => account.currency === selectedCurrency) : accounts

  function toggleAsset(asset: PlanAssetOption, checked: boolean) {
    setMsg(null)
    if (checked && selectedCurrency && asset.currency !== selectedCurrency) {
      setMsg({ ok: false, text: `同一计划只能选择 ${selectedCurrency} 资产` })
      return
    }
    setSelectedAssetIds((current) => checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    const startDate = String(fd.get('startDate'))
    const endDate = String(fd.get('endDate') ?? '')
    if (selectedAssetIds.length === 0) {
      setMsg({ ok: false, text: '至少选择一只执行资产' })
      return
    }
    setPending(true)
    setMsg(null)
    const result = await updateInvestmentPlan({
      id: initial.id,
      name: String(fd.get('name')),
      amount: Number(fd.get('amount') ?? 0),
      cadence,
      scheduleDay: cadence === 'WEEKDAY' ? null : Number(fd.get('scheduleDay')),
      startDate: `${startDate}T12:00:00+08:00`,
      endDate: endDate ? `${endDate}T12:00:00+08:00` : null,
      accountId: accountId || null,
      assetIds: selectedAssetIds,
      note: String(fd.get('note') ?? '') || null,
    })
    setPending(false)
    if (result.ok) {
      dialogRef.current?.close()
      navigateAfterWrite({ message: '计划已更新；历史节点与流水不变' })
    } else {
      setMsg({ ok: false, text: result.error })
    }
  }

  return (
    <>
      <button type="button" className="investment-plan-row-edit" onClick={() => setOpen(true)} title="编辑计划" aria-label={`编辑计划 ${initial.name}`}>编辑</button>
      <dialog
        ref={dialogRef}
        aria-labelledby="plan-edit-dialog-title"
        className="plan-edit-dialog"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          const dialog = dialogRef.current
          if (!dialog) return
          const rect = dialog.getBoundingClientRect()
          const inBox = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
          if (!inBox) dialog.close()
        }}
      >
        {open && (
          <div>
            <div className="flex items-center justify-between gap-4">
              <h2 id="plan-edit-dialog-title" className="text-[19px] font-medium text-ink">编辑定投计划</h2>
              <button
                type="button"
                aria-label="关闭编辑窗口"
                onClick={() => dialogRef.current?.close()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-[18px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
              >
                ×
              </button>
            </div>
            <p className="mt-1 text-[12px] text-ink-faint" title="编辑只改计划参数；已发生的流水与未买证据保持不变，新节奏自保存起生效">只改计划参数，历史流水与已核对证据不变。</p>

            <form onSubmit={onSubmit} className="investment-plan-form">
              <Field label="计划名称">
                <input name="name" required maxLength={60} defaultValue={initial.name} className={inputCls} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={`每期金额${selectedCurrency ? `（${selectedCurrency}）` : ''}`}>
                  <input name="amount" type="number" min="0.01" step="0.01" required defaultValue={initial.amount} className={inputCls} />
                </Field>
                <Field label="执行节奏">
                  <select value={cadence} onChange={(event) => setCadence(event.target.value as typeof cadence)} className={inputCls}>
                    <option value="WEEKDAY">每个工作日</option>
                    <option value="WEEKLY">每周</option>
                    <option value="MONTHLY">每月</option>
                  </select>
                </Field>
              </div>

              {cadence !== 'WEEKDAY' && (
                <Field label={cadence === 'WEEKLY' ? '每周执行日' : '每月执行日'}>
                  {cadence === 'WEEKLY' ? (
                    <select name="scheduleDay" defaultValue={String(initial.scheduleDay ?? 1)} className={inputCls}>
                      {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((label, index) => (
                        <option key={label} value={index}>{label}</option>
                      ))}
                    </select>
                  ) : (
                    <input name="scheduleDay" type="number" min="1" max="31" defaultValue={initial.scheduleDay ?? 1} className={inputCls} />
                  )}
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="开始日期">
                  <input name="startDate" type="date" required defaultValue={initial.startDate} className={inputCls} />
                </Field>
                <Field label="结束日期（可选）">
                  <input name="endDate" type="date" defaultValue={initial.endDate ?? ''} className={inputCls} />
                </Field>
              </div>

              <fieldset className="investment-plan-assets">
                <legend>执行资产</legend>
                <div>
                  {assets.map((asset) => {
                    const selected = selectedAssetIds.includes(asset.id)
                    const incompatible = Boolean(selectedCurrency && asset.currency !== selectedCurrency)
                    return (
                      <label key={asset.id} className={incompatible ? 'is-disabled' : undefined}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={incompatible}
                          onChange={(event) => toggleAsset(asset, event.target.checked)}
                        />
                        <span><b>{asset.symbol}</b>{asset.name}</span>
                        <em>{asset.currency}</em>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              <Field label="限定账户（可选）">
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={inputCls}>
                  <option value="">所有同币种账户</option>
                  {compatibleAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
                  ))}
                </select>
              </Field>

              <Field label="计划说明（可选）">
                <input name="note" maxLength={300} defaultValue={initial.note ?? ''} className={inputCls} />
              </Field>

              <FormMsg msg={msg} />
              <div className="flex items-center gap-2">
                <button type="submit" disabled={pending} className={btnCls}>{pending ? '保存中…' : '保存变更'}</button>
                <button type="button" className={btnGhostCls} onClick={() => dialogRef.current?.close()}>取消</button>
              </div>
            </form>
          </div>
        )}
      </dialog>
    </>
  )
}
