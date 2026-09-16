'use client'

import { useState, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { recordInvestmentPlanBuys } from '@/lib/actions'
import { fmtMoney } from '@/lib/format'
import { btnCls, btnGhostCls, inputCls } from './fields'
import { HashOpenDetails } from './hash-open-details'

export interface QuickEntryRow {
  planId: string
  assetName: string
  symbol: string
  accountName: string
  amount: number
  currency: string
}

export interface QuickEntryDay {
  date: string
  currency: string
  rows: QuickEntryRow[]
}

function EntryDay({ day, initiallyOpen, onSuccess }: { day: QuickEntryDay; initiallyOpen: boolean; onSuccess: (message: string) => void }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [selected, setSelected] = useState<string[]>([])
  const [confirmedActual, setConfirmedActual] = useState(false)
  const [confirmedNoBuy, setConfirmedNoBuy] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [values, setValues] = useState<Record<string, { amount: string; fee: string; navDate: string }>>(
    Object.fromEntries(day.rows.map((row) => [row.planId, {
      amount: String(row.amount),
      fee: '0',
      navDate: day.date,
    }])),
  )
  const selectedRows = day.rows.filter((row) => selected.includes(row.planId))
  const unselectedRows = day.rows.filter((row) => !selected.includes(row.planId))
  const total = selectedRows.reduce((sum, row) => sum + Number(values[row.planId]?.amount ?? 0), 0)

  function setField(planId: string, field: 'amount' | 'fee' | 'navDate', value: string) {
    setValues((current) => ({
      ...current,
      [planId]: { ...current[planId], [field]: value },
    }))
    setMessage(null)
    setConfirmedActual(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const noBuyRows = confirmedNoBuy ? unselectedRows : []
    if (selectedRows.length + noBuyRows.length === 0 || (selectedRows.length > 0 && !confirmedActual)) return
    setPending(true)
    setMessage(null)
    const result = await recordInvestmentPlanBuys({
      confirmedActual,
      confirmedNoBuy,
      buys: selectedRows.map((row) => ({
        planId: row.planId,
        date: day.date,
        navDate: values[row.planId].navDate,
        amount: Number(values[row.planId].amount),
        fee: Number(values[row.planId].fee),
      })),
      noBuy: noBuyRows.map((row) => ({ planId: row.planId, date: day.date })),
    })
    setPending(false)
    if (result.ok) {
      const bought = result.data?.count ?? selectedRows.length
      const notBought = result.data?.noBuyCount ?? noBuyRows.length
      const summary = `${bought > 0 ? `${bought} 笔实际申购已录入，份额待确认` : ''}${bought > 0 && notBought > 0 ? '；' : ''}${notBought > 0 ? `${notBought} 只已核对未买入` : ''}`
      onSuccess(summary)
      setSelected([])
      setConfirmedActual(false)
      setConfirmedNoBuy(false)
      // 写入后走真实导航，列表与会话状态一定来自服务端最新结果（P0-11）
      navigateAfterWrite(result.warning
        ? { message: `${summary}；${result.warning}`, tone: 'warn' }
        : { message: summary, tone: 'ok' })
    } else {
      setMessage({ ok: false, text: result.error })
    }
  }

  return (
    <HashOpenDetails
      id={`quick-entry-${day.date}-${day.currency}`}
      className="investment-plan-entry-day"
      initiallyOpen={initiallyOpen}
      summary={<><strong>{day.date}</strong><span>{day.rows.length} 个待核对节点</span><b className="num">{fmtMoney(day.rows.reduce((sum, row) => sum + row.amount, 0), day.currency)}</b></>}
    >
      <form onSubmit={submit}>
        <div className="investment-plan-entry-toolbar">
          <p>勾选平台上已实际申购并扣款的基金；未勾选的可一键确认当天未买。计划金额和 0 元费用均为预填值，请按平台记录核对、修改。</p>
          <button type="button" className={btnGhostCls} onClick={() => { setSelected(day.rows.map((row) => row.planId)); setConfirmedActual(false); setConfirmedNoBuy(false) }}>勾选本日全部</button>
        </div>
        <div className="investment-plan-entry-table-wrap">
          <table className="investment-plan-entry-table">
            <thead><tr><th scope="col">已发生</th><th scope="col">基金 / 账户</th><th scope="col">实际申购金额</th><th scope="col">实际费用</th><th scope="col">成交净值日</th></tr></thead>
            <tbody>{day.rows.map((row) => {
              const value = values[row.planId]
              return (
                <tr key={row.planId}>
                  <td><label className="investment-plan-entry-check"><input type="checkbox" checked={selected.includes(row.planId)} onChange={(event) => { setSelected((current) => event.target.checked ? [...current, row.planId] : current.filter((id) => id !== row.planId)); setConfirmedActual(false); setConfirmedNoBuy(false) }} /><span className="sr-only">{row.assetName}已实际申购</span></label></td>
                  <td><strong>{row.assetName}</strong><small>{row.accountName} · {row.symbol}</small></td>
                  <td><label><span className="sr-only">{row.assetName}实际申购金额</span><input className={inputCls} type="number" min="0.01" step="0.01" value={value.amount} onChange={(event) => setField(row.planId, 'amount', event.target.value)} required /></label></td>
                  <td><label><span className="sr-only">{row.assetName}实际费用</span><input className={inputCls} type="number" min="0" step="0.01" value={value.fee} onChange={(event) => setField(row.planId, 'fee', event.target.value)} required /></label></td>
                  <td><label><span className="sr-only">{row.assetName}成交净值日</span><input className={inputCls} type="date" min={day.date} value={value.navDate} onChange={(event) => setField(row.planId, 'navDate', event.target.value)} required /></label></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
        <p className="investment-plan-entry-hint">成交净值日按平台订单填写；若是 15:00 后申购或休市顺延，不要沿用预填的申购日。份额未知时先记为待确认，不猜净值或份额。</p>
        <div className="investment-plan-entry-submit">
          <div className="investment-plan-entry-confirmations">
            {selectedRows.length > 0 && <label><input type="checkbox" checked={confirmedActual} onChange={(event) => setConfirmedActual(event.target.checked)} /><span>我已核对平台记录：所选申购均实际发生，金额、费用和成交净值日正确。</span></label>}
            {unselectedRows.length > 0 && <label><input type="checkbox" checked={confirmedNoBuy} onChange={(event) => setConfirmedNoBuy(event.target.checked)} /><span>我已核对平台记录：未勾选的 {unselectedRows.length} 只基金在 {day.date} 确实没有买入；只记录计划核对，不生成流水。</span></label>}
          </div>
          <button type="submit" className={btnCls} disabled={pending || (selectedRows.length === 0 && !confirmedNoBuy) || (selectedRows.length > 0 && !confirmedActual)}>{pending ? '核对中…' : `${selectedRows.length > 0 ? `录入 ${selectedRows.length} 笔 · ${fmtMoney(total, day.currency)}` : '不录入买入'}${confirmedNoBuy && unselectedRows.length > 0 ? `；确认 ${unselectedRows.length} 只未买` : ''}`}</button>
        </div>
        {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-down' : 'text-amber'}>{message.text}</p>}
      </form>
    </HashOpenDetails>
  )
}

export function InvestmentPlanQuickEntry({ days, foldBefore }: { days: QuickEntryDay[]; foldBefore?: string }) {
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const olderDays = foldBefore ? days.filter((day) => day.date < foldBefore) : []
  const recentDays = foldBefore ? days.filter((day) => day.date >= foldBefore) : days
  return (
    <div className="investment-plan-entry-days">
      {successMessage && <p role="status" className="investment-plan-entry-success text-down">{successMessage}</p>}
      {days.length === 0
        ? <p className="investment-plan-entry-empty">本月没有已到期且同日账本未录的计划节点。</p>
        : <>
          {olderDays.length > 0 && <HashOpenDetails
            id="quick-entry-history"
            className="investment-plan-entry-history"
            summary={<><strong>更早待核对</strong><span>{olderDays.length} 天 · 仍可补录或确认未买</span></>}
          >
            {olderDays.map((day) => <EntryDay key={`${day.date}-${day.currency}`} day={day} initiallyOpen={false} onSuccess={setSuccessMessage} />)}
          </HashOpenDetails>}
          {recentDays.map((day, index) => <EntryDay key={`${day.date}-${day.currency}`} day={day} initiallyOpen={index === recentDays.length - 1} onSuccess={setSuccessMessage} />)}
        </>}
    </div>
  )
}
