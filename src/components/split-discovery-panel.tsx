'use client'

import { useState, useTransition } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { checkSplitAnnouncements, confirmDiscoveredSplit } from '@/lib/actions'
import type { splitCandidates } from '@/lib/services/split-discovery'

type Props = { scan: Awaited<ReturnType<typeof splitCandidates>>; readOnly: boolean }
export function SplitDiscoveryPanel({ scan, readOnly }: Props) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState('')
  const navigateAfterWrite = useNavigateAfterWrite()
  const inputClass = 'rounded border border-line bg-panel px-3 py-2 text-ink'
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-ink-dim">检查境内 ETF / 基金的拆分线索。核对官方除权日与券商新增份额后，ETF 可自动生成调整流水并刷新完整历史行情。登记日和除权日分别保存；尚未接入券商账户自动核对。</p>
    <div className="flex items-center gap-4"><button disabled={pending || readOnly} className="rounded border border-line px-4 py-2 text-accent disabled:opacity-40" onClick={() => start(async () => { const result = await checkSplitAnnouncements(); if (result.ok) { navigateAfterWrite({ message: result.warning ?? '拆分检查完成' }) } else { setMessage(result.error) } })}>检查拆分公告</button><span className="text-xs text-ink-faint">{scan.checkedAt ? `最近检查 ${new Date(scan.checkedAt).toLocaleString('zh-CN')}` : '尚未检查'}</span></div>
    {scan.errors.length > 0 && <details className="text-sm text-ink-dim"><summary>{scan.errors.length} 个标的检查失败，结果不完整</summary>{scan.errors.map(e => <p key={e}>{e}</p>)}</details>}
    {scan.unsupported.length > 0 && <p className="text-xs text-ink-faint">暂不支持自动发现：{scan.unsupported.join('、')}</p>}
    {!scan.candidates.length && <p className="text-sm text-ink-dim">本次结果没有待核对的持仓拆分事件。</p>}
    {scan.candidates.map(c => <form key={`${c.accountId}-${c.assetId}-${c.recordDate}`} className="space-y-3 border-t border-line pt-4" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget)
      start(async () => { const result = await confirmDiscoveredSplit({ accountId: c.accountId, assetId: c.assetId, recordDate: c.recordDate, effectiveDate: String(form.get('effectiveDate')), receivedQuantity: Number(form.get('receivedQuantity')), sourceReference: String(form.get('sourceReference')) }); if (result.ok) { navigateAfterWrite({ message: result.warning ?? '已核对入账，持仓与历史已更新' }) } else { setMessage(result.error) } })
    }}>
      <p className="text-ink">{c.accountName} · {c.symbol} {c.assetName}</p>
      <p className="text-sm text-ink-dim">登记／折算日 {c.recordDate} · 1 份变 {c.ratio} 份 · 预计 {c.before.toLocaleString()} → {c.after.toLocaleString()} 份 · <a className="text-accent" href={c.sourceReference} target="_blank" rel="noreferrer">查看线索</a></p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">官方除权日<input name="effectiveDate" aria-label="官方除权日" type="date" required className={inputClass} /></label>
        <label className="flex flex-col gap-2 text-sm">券商新增份额<input name="receivedQuantity" aria-label="券商新增份额" type="number" step="any" min="0" required className={inputClass} /></label>
        <label className="flex min-w-72 flex-1 flex-col gap-2 text-sm">官方公告链接<input name="sourceReference" aria-label="官方公告链接" type="url" required className={inputClass} /></label>
        <button disabled={pending || readOnly || c.ratio <= 1 || c.assetClass !== 'ETF'} className="rounded bg-accent px-4 py-2 text-black disabled:opacity-40">核对并入账</button>
      </div>
      {c.ratio <= 1 && <p className="text-sm text-ink-dim">缩股涉及减少份额及尾差，请使用人工公司行动。</p>}
      {c.assetClass !== 'ETF' && <p className="text-sm text-ink-dim">场外基金请使用上方的人工公司行动流程。</p>}
    </form>)}
    {message && <p role="status" className="text-sm text-accent">{message}</p>}
  </div>
}
