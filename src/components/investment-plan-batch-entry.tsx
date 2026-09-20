'use client'

import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { recordInvestmentPlanBuys } from '@/lib/actions'
import { InvestmentPlanNoBuyWindow, type NoBuyWindowDay } from './investment-plan-no-buy-window'
import { fmtMoney, cx } from '@/lib/format'
import { btnCls, btnGhostCls, inputCls } from './fields'

// 行内紧凑动作：不改共享按钮，仅供批量核对的工作台使用
const compactBtnCls =
  'inline-flex min-h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-line bg-transparent px-2.5 text-[12px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-40'

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

/** 区间未买需要知道每个计划日「该有的节点」与「账本已有买入的节点」，用于如实预告跳过数量。 */
export interface NoBuyWindowPlan {
  id: string
  name: string
  amount: number
  currency: string
  dates: string[]
}

interface PreparedRow extends QuickEntryRow {
  date: string
  key: string
}

interface RowValue {
  amount: string
  fee: string
  navDate: string
}

interface DayValue {
  selected: string[]
  confirmedActual: boolean
  confirmedNoBuy: boolean
}

function blankDay(): DayValue {
  return { selected: [], confirmedActual: false, confirmedNoBuy: false }
}

export function InvestmentPlanQuickEntry({ days, windowPlans = [] }: { days: QuickEntryDay[]; windowPlans?: NoBuyWindowPlan[] }) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const rows = useMemo<PreparedRow[]>(() => days.flatMap((day) => day.rows.map((row) => ({
    ...row,
    date: day.date,
    key: `${row.planId}|${day.date}`,
  }))), [days])
  const dates = useMemo(() => days.map((day) => day.date), [days])
  const [dayState, setDayState] = useState<Record<string, DayValue>>(
    () => Object.fromEntries(dates.map((date) => [date, blankDay()])),
  )
  const [values, setValues] = useState<Record<string, RowValue>>(() => Object.fromEntries(rows.map((row) => [row.key, {
    amount: String(row.amount),
    fee: '0',
    navDate: row.date,
  }])))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const stateFor = (date: string) => dayState[date] ?? blankDay()
  const isSelected = (row: PreparedRow) => stateFor(row.date).selected.includes(row.planId)
  const selectedRows = rows.filter(isSelected)
  const noBuyRows = rows.filter((row) => !isSelected(row) && stateFor(row.date).confirmedNoBuy)
  const totals = selectedRows.reduce((map, row) => {
    const amount = Number(values[row.key]?.amount ?? 0)
    map.set(row.currency, (map.get(row.currency) ?? 0) + (Number.isFinite(amount) ? amount : 0))
    return map
  }, new Map<string, number>())
  const totalText = [...totals].map(([currency, amount]) => fmtMoney(amount, currency)).join(' / ') || '—'
  const actualConfirmed = dates.every((date) => stateFor(date).confirmedActual)

  function patchDay(date: string, patch: Partial<DayValue>) {
    setDayState((current) => ({ ...current, [date]: { ...(current[date] ?? blankDay()), ...patch } }))
    setMessage(null)
  }

  function toggleRow(row: PreparedRow, checked: boolean) {
    const day = stateFor(row.date)
    patchDay(row.date, {
      selected: checked ? [...day.selected, row.planId] : day.selected.filter((id) => id !== row.planId),
      confirmedActual: false,
      confirmedNoBuy: false,
    })
  }

  function selectDay(date: string, checked: boolean) {
    const planIds = (days.find((item) => item.date === date)?.rows ?? []).map((row) => row.planId)
    patchDay(date, { selected: checked ? planIds : [], confirmedActual: false, confirmedNoBuy: checked ? false : stateFor(date).confirmedNoBuy })
  }

  /** 本日未买只覆盖未勾选的行；已勾选的实际申购保持勾选，避免把已确认买入又标成未买。 */
  function markDayNoBuy(date: string) {
    const selected = stateFor(date).selected
    patchDay(date, { confirmedNoBuy: true, confirmedActual: selected.length > 0 ? stateFor(date).confirmedActual : false })
  }

  function setField(key: string, field: keyof RowValue, value: string) {
    setValues((current) => ({ ...current, [key]: { ...current[key], [field]: value } }))
    const row = rows.find((item) => item.key === key)
    if (row) patchDay(row.date, { confirmedActual: false })
    else setMessage(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const buys = selectedRows.map((row) => ({
      planId: row.planId,
      date: row.date,
      navDate: values[row.key].navDate,
      amount: Number(values[row.key].amount),
      fee: Number(values[row.key].fee),
    }))
    const noBuy = noBuyRows.map((row) => ({ planId: row.planId, date: row.date }))
    if (buys.length + noBuy.length === 0) return
    // 按钮不做 disabled：拦截必须是可读的提示，不能是「点了没反应」
    if (buys.length > 0 && !actualConfirmed) {
      setMessage('请先确认：所选申购与平台记录一致')
      confirmRef.current?.focus()
      return
    }
    setPending(true)
    setMessage(null)
    const result = await recordInvestmentPlanBuys({ confirmedActual: true, confirmedNoBuy: true, buys, noBuy })
    setPending(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    const count = result.data?.count ?? buys.length
    const noBuyCount = result.data?.noBuyCount ?? noBuy.length
    const parts = [
      count > 0 ? `${count} 笔已录入，份额待确认` : '',
      noBuyCount > 0 ? `${noBuyCount} 只已核对未买` : '',
    ].filter(Boolean)
    const rest = rows.length - buys.length - noBuy.length
    setDayState(Object.fromEntries(dates.map((date) => [date, blankDay()])))
    navigateAfterWrite({
      message: rest > 0 ? `${parts.join('；')}。还剩 ${rest} 个待核对节点` : `${parts.join('；')}。`,
      tone: result.warning ? 'warn' : 'ok',
    })
  }

  if (days.length === 0) {
    return <p className="investment-plan-entry-empty">本月没有已到期且同日账本未录的计划节点。</p>
  }

  const windowDays: NoBuyWindowDay[] = days.map((day) => ({
    date: day.date,
    pending: day.rows.map((row) => row.planId),
    recorded: windowPlans.filter((plan) => plan.dates.includes(day.date) && !day.rows.some((row) => row.planId === plan.id)).map((plan) => plan.id),
  }))

  return (
    <>
    <form onSubmit={submit} className="investment-plan-batch">
      <div className="investment-plan-batch-bar">
        <div className="investment-plan-batch-total">
          <span>已勾选实际申购</span>
          <b className="num">{selectedRows.length} 笔 · {totalText}</b>
        </div>
        {noBuyRows.length > 0 && <span className="investment-plan-batch-nobuy">另确认 {noBuyRows.length} 只未买</span>}
        <div className="investment-plan-batch-actions">
          <label className={cx('investment-plan-batch-confirm', selectedRows.length > 0 && !actualConfirmed && 'is-attention')}>
            <input
              ref={confirmRef}
              type="checkbox"
              checked={actualConfirmed}
              disabled={selectedRows.length === 0}
              onChange={(event) => setDayState((current) => Object.fromEntries(dates.map((date) => [date, { ...(current[date] ?? blankDay()), confirmedActual: event.target.checked }])))}
            />
            <span>所选申购与平台记录一致</span>
          </label>
          <button type="button" className={btnGhostCls} onClick={() => { setDayState(Object.fromEntries(dates.map((date) => [date, blankDay()]))); setMessage(null) }}>清空勾选</button>
          <button type="submit" className={btnCls} disabled={pending}>
            {pending ? '核对中…'
              : selectedRows.length > 0 ? `一次提交 ${selectedRows.length} 笔 · ${totalText}`
                : noBuyRows.length > 0 ? `确认 ${noBuyRows.length} 只未买`
                  : '一次确认未买'}
          </button>
        </div>
      </div>
      {selectedRows.length > 0 && !actualConfirmed && (
        <p className="investment-plan-batch-hint">勾选实际申购后，请在上方确认这些记录与平台一致，再提交。</p>
      )}
      {message && <p role="alert" className="investment-plan-batch-error">{message}</p>}

      <div className="investment-plan-entry-days">
        {days.map((day, index) => {
          const dayState = stateFor(day.date)
          const planIds = day.rows.map((row) => row.planId)
          const allSelected = planIds.every((id) => dayState.selected.includes(id))
          return (
            <section key={`${day.date}-${day.currency}`} id={`quick-entry-${day.date}-${day.currency}`} className="investment-plan-entry-day">
              <header>
                <strong className="num">{day.date}</strong>
                <span>{day.rows.length} 个待核对节点</span>
                <b className="num">{fmtMoney(day.rows.reduce((sum, row) => sum + row.amount, 0), day.currency)}</b>
                <div className="investment-plan-entry-day-actions">
                  <button type="button" className={compactBtnCls} onClick={() => selectDay(day.date, !allSelected)}>
                    {allSelected ? '取消勾选' : '全选本日'}
                  </button>
                  <button type="button" className={compactBtnCls} onClick={() => markDayNoBuy(day.date)}>
                    本日未买
                  </button>
                  {dayState.confirmedNoBuy && <span className="investment-plan-entry-day-flag">未选的已标记未买</span>}
                </div>
              </header>
              <table className="investment-plan-entry-table">
                <thead>
                  <tr><th scope="col">已发生</th><th scope="col">基金 / 账户</th><th scope="col">实际申购金额</th><th scope="col">实际费用</th><th scope="col">成交净值日</th></tr>
                </thead>
                <tbody>
                  {day.rows.map((row) => {
                    const key = `${row.planId}|${day.date}`
                    const value = values[key]
                    const selected = dayState.selected.includes(row.planId)
                    return (
                      <tr key={row.planId} className={selected ? 'is-selected' : undefined}>
                        <td>
                          <label className="investment-plan-entry-check">
                            <input type="checkbox" checked={selected} onChange={(event) => toggleRow(rows.find((item) => item.key === key)!, event.target.checked)} />
                            <span className="sr-only">{row.assetName} 已实际申购</span>
                          </label>
                        </td>
                        <td><strong>{row.assetName}</strong><small>{row.accountName} · {row.symbol}</small></td>
                        <td><label><span className="sr-only">{row.assetName} 实际申购金额</span><input className={inputCls} type="number" min="0.01" step="0.01" value={value.amount} onChange={(event) => setField(key, 'amount', event.target.value)} required /></label></td>
                        <td><label><span className="sr-only">{row.assetName} 实际费用</span><input className={inputCls} type="number" min="0" step="0.01" value={value.fee} onChange={(event) => setField(key, 'fee', event.target.value)} required /></label></td>
                        <td><label><span className="sr-only">{row.assetName} 成交净值日</span><input className={inputCls} type="date" min={day.date} value={value.navDate} onChange={(event) => setField(key, 'navDate', event.target.value)} required /></label></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {index === days.length - 1 && <p className="investment-plan-entry-hint">净值日按平台订单填写。</p>}
            </section>
          )
        })}
      </div>
    </form>
    {windowPlans.length > 0 && (
      <InvestmentPlanNoBuyWindow
        days={windowDays}
        plans={windowPlans.map(({ id, name, amount, currency }) => ({ id, name, amount, currency }))}
        onDone={(summary) => {
          setDayState(Object.fromEntries(dates.map((date) => [date, blankDay()])))
          navigateAfterWrite({ message: summary, tone: 'ok' })
        }}
      />
    )}
  </>
  )
}
