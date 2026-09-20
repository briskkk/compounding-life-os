'use client'

import { useState, type FormEvent } from 'react'
import { recordInvestmentPlanNoBuyWindow } from '@/lib/actions'
import { fmtMoney } from '@/lib/format'
import { btnCls, inputCls } from './fields'

export interface NoBuyWindowDay {
  date: string
  pending: string[]
  recorded: string[]
}

interface NodeEntry {
  planName: string
  date: string
}

function planNameOf(plans: { id: string; name: string }[], id: string): string | null {
  return plans.find((plan) => plan.id === id)?.name ?? null
}

/** 区间未买：与逐日「本日未买」同一语义，只写可撤销的计划层证据，不生成流水。 */
export function InvestmentPlanNoBuyWindow({
  days,
  plans,
  onDone,
}: {
  days: NoBuyWindowDay[]
  plans: { id: string; name: string; amount: number; currency: string }[]
  onDone: (summary: string, count: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(days[0]?.date ?? '')
  const [to, setTo] = useState(days[days.length - 1]?.date ?? '')
  const [selectedPlans, setSelectedPlans] = useState<string[]>(plans.map((plan) => plan.id))
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const inWindow = (date: string) => from !== '' && to !== '' && date >= from && date <= to
  const activePlanIds = selectedPlans.length > 0 ? selectedPlans : plans.map((plan) => plan.id)
  const scope = new Set(activePlanIds)
  const willMark: NodeEntry[] = days.flatMap((day) => (
    inWindow(day.date)
      ? day.pending.flatMap((id) => {
        const name = planNameOf(plans, id)
        return name && scope.has(id) ? [{ planName: name, date: day.date }] : []
      })
      : []
  ))
  const skipped = days.flatMap((day) => (
    inWindow(day.date) ? day.recorded.filter((id) => scope.has(id)).length : 0
  )).reduce((sum, count) => sum + count, 0)
  const affectedDays = new Set(willMark.map((item) => item.date)).size
  const estimated = plans
    .filter((plan) => scope.has(plan.id))
    .reduce((totals, plan) => {
      const count = willMark.filter((item) => item.planName === plan.name).length
      return count > 0 ? totals.concat(`${planNameOf(plans, plan.id)} ${count} 期 · ${fmtMoney(plan.amount * count, plan.currency)}`) : totals
    }, [] as string[])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    const result = await recordInvestmentPlanNoBuyWindow({
      from,
      to,
      planIds: activePlanIds,
      confirmedNoBuy: true,
    })
    setPending(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    const count = result.data?.count ?? 0
    const skippedCount = result.data?.skipped ?? 0
    const summary = `${count} 个节点已核对未买入${skippedCount > 0 ? `，${skippedCount} 个已有买入或已核对被跳过` : ''}。`
    setConfirmed(false)
    onDone(summary, count)
  }

  if (days.length === 0) return null

  return (
    <details className="investment-plan-window" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>区间未买</span>
        <em>{days.length} 个待核对日 · 一次确认连续几天没有执行</em>
      </summary>
      <form onSubmit={submit}>
        <div className="investment-plan-window-fields">
          <label>
            <span>起始日期</span>
            <input type="date" className={inputCls} value={from} min={days[0].date} max={days[days.length - 1].date} onChange={(event) => { setFrom(event.target.value); setMessage(null) }} required />
          </label>
          <label>
            <span>结束日期</span>
            <input type="date" className={inputCls} value={to} min={days[0].date} max={days[days.length - 1].date} onChange={(event) => { setTo(event.target.value); setMessage(null) }} required />
          </label>
          <fieldset className="investment-plan-window-plans">
            <legend>适用计划</legend>
            {plans.map((plan) => (
              <label key={plan.id}>
                <input
                  type="checkbox"
                  checked={selectedPlans.includes(plan.id)}
                  onChange={(event) => {
                    setSelectedPlans((current) => event.target.checked ? current.concat(plan.id) : current.filter((id) => id !== plan.id))
                    setMessage(null)
                  }}
                />
                <span>{plan.name}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="investment-plan-window-preview">
          <p>
            将标记 <b className="num">{willMark.length}</b> 个节点为已核对未买入
            {affectedDays > 0 && <>，覆盖 <b className="num">{affectedDays}</b> 个计划日</>}
            {skipped > 0 && <>；其中 <b className="num">{skipped}</b> 个节点账本已有买入或已核对，会被跳过</>}
          </p>
          {estimated.length > 0 && <p className="investment-plan-window-amount">相当于未投入：{estimated.join('；')}</p>}
          {willMark.length === 0 && <p className="investment-plan-window-amount">该区间没有可标记的节点，请调整日期或计划范围。</p>}
        </div>
        <div className="investment-plan-window-submit">
          <label>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>我确认这些计划日在平台与账本中都没有对应申购；可逐日撤销</span>
          </label>
          <button type="submit" className={btnCls} disabled={pending || willMark.length === 0 || !confirmed}>
            {pending ? '核对中…' : `确认 ${willMark.length} 个节点未买入`}
          </button>
        </div>
        {message && <p role="alert" className="investment-plan-batch-error">{message}</p>}
      </form>
    </details>
  )
}
