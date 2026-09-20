'use client'

import { useNavigateAfterWrite } from '@/lib/write-navigation'
import { useMemo, useState, type FormEvent } from 'react'
import { upsertSavingsEntry } from '@/lib/actions'
import { Field, FormMsg, btnCls, inputCls } from './fields'

interface SavingsCheckInProps {
  month: string
  income: number
  spending: number
  savedAmount: number
}

const amount = (value: number) => `¥${Math.abs(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`

export function SavingsCheckIn({ month, income: initialIncome, spending: initialSpending, savedAmount: initialSaved }: SavingsCheckInProps) {
  const navigateAfterWrite = useNavigateAfterWrite()
  const [periodType, setPeriodType] = useState<'MONTH' | 'WEEK'>('MONTH')
  const [period, setPeriod] = useState(month)
  const [income, setIncome] = useState(initialIncome)
  const [spending, setSpending] = useState(initialSpending)
  const [savedAmount, setSavedAmount] = useState(initialSaved)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const netSavings = income - spending
  const savingsRate = income > 0 ? netSavings / income : null
  const unallocated = netSavings - savedAmount

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  function changePeriodType(next: 'MONTH' | 'WEEK') {
    setPeriodType(next)
    setMsg(null)
    if (next === 'WEEK') {
      setPeriod(today)
      setIncome(0)
      setSpending(0)
      setSavedAmount(0)
    } else {
      setPeriod(month)
      setIncome(initialIncome)
      setSpending(initialSpending)
      setSavedAmount(initialSaved)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMsg(null)
    const periodStart = periodType === 'MONTH' ? new Date(`${period}-01T00:00:00.000Z`) : new Date(`${period}T00:00:00.000Z`)
    const result = await upsertSavingsEntry({
      periodType,
      periodStart,
      income,
      spending,
      savedAmount,
      note: null,
    })
    setPending(false)
    if (result.ok) {
      navigateAfterWrite({ message: periodType === 'MONTH' ? '月度收支已保存' : '本周记录已保存并自动汇总' })
    } else {
      setMsg({ ok: false, text: result.error })
    }
  }

  return (
    <form onSubmit={onSubmit} className="savings-entry-form">
      <div>
        <h3 className="mt-2 text-[22px] font-medium tracking-[-0.03em] text-ink">记录本月收支</h3>
        <p className="mt-2 text-[14px] leading-7 text-ink-faint">净储蓄由收入减消费自动计算；已转入储蓄或投资单独记录资金去向。</p>
      </div>

      <div className="savings-entry-fields">
        <Field label="记录方式">
          <select value={periodType} onChange={(event) => changePeriodType(event.target.value as 'MONTH' | 'WEEK')} className={inputCls}>
            <option value="MONTH">月度汇总</option>
            <option value="WEEK">逐周补录</option>
          </select>
        </Field>
        <Field label={periodType === 'MONTH' ? '月份' : '周起始日'}>
          <input
            type={periodType === 'MONTH' ? 'month' : 'date'}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <Field label="收入">
          <input type="number" min="0" step="any" value={income} onChange={(event) => setIncome(Number(event.target.value))} className={inputCls} />
        </Field>
        <Field label="消费">
          <input type="number" min="0" step="any" value={spending} onChange={(event) => setSpending(Number(event.target.value))} className={inputCls} />
        </Field>
        <Field label="已转入储蓄或投资" className="md:col-span-2">
          <input type="number" min="0" step="any" value={savedAmount} onChange={(event) => setSavedAmount(Number(event.target.value))} className={inputCls} />
        </Field>
      </div>

      <div className="savings-derived" aria-live="polite">
        <div><span>自动计算净储蓄</span><strong>{netSavings < 0 ? `-${amount(netSavings)}` : amount(netSavings)}</strong></div>
        <div><span>本期储蓄率</span><strong>{savingsRate == null ? '—' : `${(savingsRate * 100).toFixed(1)}%`}</strong></div>
        <div><span>{unallocated >= 0 ? '尚未分配' : '需要核对'}</span><strong>{amount(unallocated)}</strong></div>
      </div>

      <FormMsg msg={msg} />
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? '保存中…' : periodType === 'MONTH' ? '保存本月记录' : '保存本周记录'}
      </button>
    </form>
  )
}
