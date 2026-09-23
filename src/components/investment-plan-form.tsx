'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { createInvestmentPlan, createInvestmentPlanBatch, endInvestmentPlan } from '@/lib/actions'
import { btnCls, btnGhostCls, Field, FormMsg, inputCls } from './fields'
import { useConfirm } from '@/components/confirm-dialog'

export interface InvestmentPlanAssetOption {
  id: string
  symbol: string
  name: string
  cls: string
  currency: string
}

export interface InvestmentPlanAccountOption {
  id: string
  name: string
  currency: string
}

function localInputDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function InvestmentPlanForm({
  assets,
  accounts,
}: {
  assets: InvestmentPlanAssetOption[]
  accounts: InvestmentPlanAccountOption[]
}) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [mode, setMode] = useState<'BATCH' | 'STRATEGY'>('BATCH')
  const [cadence, setCadence] = useState<'WEEKDAY' | 'WEEKLY' | 'MONTHLY'>('WEEKDAY')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [defaultAmount, setDefaultAmount] = useState('')
  const [assetAmounts, setAssetAmounts] = useState<Record<string, string>>({})
  const [accountId, setAccountId] = useState('')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const selectedCurrency = useMemo(
    () => assets.find((asset) => selectedAssetIds.includes(asset.id))?.currency ?? null,
    [assets, selectedAssetIds],
  )
  const compatibleAccounts = selectedCurrency
    ? accounts.filter((account) => account.currency === selectedCurrency)
    : accounts

  function toggleAsset(asset: InvestmentPlanAssetOption, checked: boolean) {
    setMsg(null)
    if (checked && selectedCurrency && asset.currency !== selectedCurrency) {
      setMsg({ ok: false, text: `同一计划只能选择 ${selectedCurrency} 资产` })
      return
    }
    setSelectedAssetIds((current) => checked
      ? [...current, asset.id]
      : current.filter((id) => id !== asset.id))
    setAssetAmounts((current) => {
      if (checked) return current[asset.id] == null ? { ...current, [asset.id]: '' } : current
      const next = { ...current }
      delete next[asset.id]
      return next
    })
    if (!checked && selectedAssetIds.length === 1) setAccountId('')
  }

  function resetForm(form: HTMLFormElement) {
    form.reset()
    setMode('BATCH')
    setCadence('WEEKDAY')
    setSelectedAssetIds([])
    setDefaultAmount('')
    setAssetAmounts({})
    setAccountId('')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fd = new FormData(form)
    const startDate = String(fd.get('startDate'))
    const endDate = String(fd.get('endDate') ?? '')
    if (selectedAssetIds.length === 0) {
      setMsg({ ok: false, text: '至少选择一只执行资产' })
      return
    }
    setPending(true)
    setMsg(null)
    const shared = {
      cadence,
      scheduleDay: cadence === 'WEEKDAY' ? null : Number(fd.get('scheduleDay')),
      startDate: `${startDate}T12:00:00+08:00`,
      endDate: endDate ? `${endDate}T12:00:00+08:00` : null,
      accountId: accountId || null,
      note: String(fd.get('note') ?? '') || null,
    }
    if (mode === 'BATCH') {
      const result = await createInvestmentPlanBatch({
        ...shared,
        entries: selectedAssetIds.map((assetId) => ({
          assetId,
          amount: Number(assetAmounts[assetId] || defaultAmount || 0),
        })),
      })
      setPending(false)
      if (result.ok) {
        resetForm(form)
        navigateAfterWrite({ message: `已创建 ${result.data?.count ?? selectedAssetIds.length} 条独立定投计划` })
      } else {
        setMsg({ ok: false, text: result.error })
      }
      return
    }

    const result = await createInvestmentPlan({
      ...shared,
      name: String(fd.get('name')),
      amount: Number(defaultAmount || 0),
      assetIds: selectedAssetIds,
    })
    setPending(false)
    if (result.ok) {
      resetForm(form)
      navigateAfterWrite({ message: '定投计划已开始跟踪' })
    } else {
      setMsg({ ok: false, text: result.error })
    }
  }

  return (
    <form onSubmit={onSubmit} className="investment-plan-form">
      <div className="investment-plan-create-mode" role="group" aria-label="创建方式">
        <button type="button" aria-pressed={mode === 'BATCH'} onClick={() => setMode('BATCH')}>批量独立计划</button>
        <button type="button" aria-pressed={mode === 'STRATEGY'} onClick={() => setMode('STRATEGY')}>候选资产策略</button>
      </div>
      <p className="investment-plan-create-hint">
        {mode === 'BATCH'
          ? '多选资产会分别建立独立计划，名称默认使用资产名。'
          : '多只资产共用一条替代策略；快速录入仅支持单只基金。'}
      </p>

      {mode === 'STRATEGY' && (
        <Field label="计划名称">
          <input name="name" required maxLength={60} className={inputCls} placeholder="例如：纳指 100 长期定投" />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={`${mode === 'BATCH' ? '默认' : ''}每期金额${selectedCurrency ? `（${selectedCurrency}）` : ''}`}>
          <input value={defaultAmount} onChange={(event) => setDefaultAmount(event.target.value)} type="number" min="0.01" step="0.01" required className={inputCls} placeholder="100.00" />
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
            <select name="scheduleDay" defaultValue="1" className={inputCls}>
              {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((label, index) => (
                <option key={label} value={index}>{label}</option>
              ))}
            </select>
          ) : (
            <input name="scheduleDay" type="number" min="1" max="31" defaultValue="1" className={inputCls} />
          )}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="开始日期">
          <input name="startDate" type="date" required defaultValue={localInputDate()} className={inputCls} />
        </Field>
        <Field label="结束日期（可选）">
          <input name="endDate" type="date" className={inputCls} />
        </Field>
      </div>

      <fieldset className="investment-plan-assets">
        <legend>执行资产</legend>
        <p>{mode === 'BATCH' ? '可多选同币种资产，每只资产会建立一条独立计划。' : '同一策略可包含多只同币种候选资产，实际买入会合并核对。'}</p>
        <div>
          {assets.map((asset) => {
            const selected = selectedAssetIds.includes(asset.id)
            const incompatible = Boolean(selectedCurrency && asset.currency !== selectedCurrency)
            return (
              <label key={asset.id} className={incompatible ? 'is-disabled' : undefined}>
                <input
                  type="checkbox"
                  name="assetIds"
                  value={asset.id}
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

      {mode === 'BATCH' && selectedAssetIds.length > 0 && (
        <div className="investment-plan-batch-selection" aria-label="已选资产金额">
          <p>已选 {selectedAssetIds.length} 只；留空则使用默认金额。</p>
          {selectedAssetIds.map((assetId) => {
            const asset = assets.find((item) => item.id === assetId)!
            return (
              <label key={asset.id}>
                <span><b>{asset.symbol}</b>{asset.name}</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={assetAmounts[asset.id] ?? ''}
                  onChange={(event) => setAssetAmounts((current) => ({ ...current, [asset.id]: event.target.value }))}
                  className={inputCls}
                  placeholder={defaultAmount || '默认金额'}
                  aria-label={`${asset.name} 每期金额`}
                />
              </label>
            )
          })}
        </div>
      )}

      <Field label="限定账户（可选）">
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={inputCls}>
          <option value="">所有同币种账户</option>
          {compatibleAccounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
          ))}
        </select>
      </Field>

      <Field label="计划说明（可选）">
        <input name="note" maxLength={300} className={inputCls} placeholder="目标、执行边界或渠道说明" />
      </Field>

      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '保存中…' : mode === 'BATCH'
          ? selectedAssetIds.length > 0 ? `创建 ${selectedAssetIds.length} 条独立计划` : '创建独立计划'
          : '开始跟踪计划'}
      </button>
    </form>
  )
}

export function EndInvestmentPlanButton({ id, name }: { id: string; name: string }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const confirm = useConfirm()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function endPlan() {
    const ok = await confirm({
      title: `结束计划「${name}」？`,
      impacts: ['计划状态改为已结束，之后不再提示核对', '历史计划节点与已生成的真实流水全部保留', '不影响账本任何金额'],
      confirmLabel: '结束计划',
    })
    if (!ok) return
    setPending(true)
    setError('')
    try {
      const result = await endInvestmentPlan(id)
      if (result.ok) navigateAfterWrite({ message: '定投计划已结束，历史计划仍保留' })
      else setError(result.error)
    } catch {
      setError('结束计划未完成，请检查网络后重试。')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="investment-plan-end-control">
      <button type="button" onClick={endPlan} disabled={pending} className={`${btnGhostCls} min-h-11 px-3 py-2 text-[12px]`}>
        {pending ? '结束中…' : '结束计划'}
      </button>
      {error && <span role="alert" className="investment-plan-end-error">{error}</span>}
    </div>
  )
}
