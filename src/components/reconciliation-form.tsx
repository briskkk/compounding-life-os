'use client'

import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useState, useTransition } from 'react'
import { recordAccountReconciliation } from '@/lib/actions'
import { fmtCNY } from '@/lib/format'

interface ReconciliationAccount {
  id: string
  name: string
  ledgerValueCny: number
}

export function ReconciliationForm({ accounts }: { accounts: ReconciliationAccount[] }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form className="reconciliation-form" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      startTransition(async () => {
        setError(null)
        setResult(null)
        const response = await recordAccountReconciliation({
          accountId: String(form.get('accountId') ?? ''),
          observedValueCny: Number(form.get('observedValueCny')),
          sourceName: String(form.get('sourceName') ?? ''),
          asOfDate: String(form.get('asOfDate') ?? ''),
          note: String(form.get('note') ?? '').trim() || null,
        })
        if (!response.ok) setError(response.error)
        else {
          const difference = response.data?.differenceCny ?? 0
          const text = Math.abs(difference) < 0.01 ? '核对一致，凭证已写入审计链' : `已记录差额 ¥${difference.toFixed(2)}，请核对缺失流水`
          setResult(text)
          // 一次性提示带实质结论，导航后仍可见（P0-11）
          navigateAfterWrite({ message: `${text}；账本余额未被改写` })
        }
      })
    }}>
      <label><span>账户</span><select name="accountId" required defaultValue=""><option value="" disabled>选择待核对账户</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · 账本 {fmtCNY(account.ledgerValueCny)}</option>)}</select></label>
      <label><span>外部账单余额（人民币）</span><input name="observedValueCny" type="number" min="0" step="0.01" required placeholder="0.00" /></label>
      <label><span>核对日期（当前）</span><input name="asOfDate" type="date" required min={today} max={today} defaultValue={today} /></label>
      <label><span>凭证来源</span><input name="sourceName" required maxLength={80} placeholder="例如：券商月结单" /></label>
      <label className="is-wide"><span>备注（可选）</span><input name="note" maxLength={300} placeholder="差异说明或文件定位信息" /></label>
      <button type="submit" disabled={pending || accounts.length === 0}>{pending ? '核对中…' : '写入核对凭证'}</button>
      {(error || result) && <p className={error ? 'is-error' : 'is-success'}>{error ?? result}</p>}
    </form>
  )
}
