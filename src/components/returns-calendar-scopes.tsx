'use client'

// 收益日历的月收益（年网格）与年收益（年列表）视图；合计数据由主组件统一计算后传入
import { useMemo } from 'react'
import type { PeriodTotal } from '@/lib/engine/returns-calendar'
import { cx, fmtSignedCnyCompact } from '@/lib/format'

/** 月收益：当年 12 格；已过去且无收益观察的月份显示「—」占位，未来月份保持空白。 */
export function ReturnsYearGrid({
  totals,
  year,
  observedMonths,
  currentMonth,
  onSelectMonth,
}: {
  totals: PeriodTotal[]
  year: number
  observedMonths: string[]
  currentMonth: string
  onSelectMonth: (monthKey: string) => void
}) {
  const observedSet = useMemo(() => new Set(observedMonths), [observedMonths])
  return (
    <div className="returns-cal-year-grid">
      {totals.map((item) => {
        const month = Number(item.key.slice(5, 7))
        const observed = observedSet.has(item.key)
        const elapsed = item.key <= currentMonth
        const cls = cx(
          'returns-cal-cell returns-cal-month-cell',
          observed && item.total !== 0 && (item.total > 0 ? 'returns-cal-up' : 'returns-cal-down'),
          !elapsed && 'returns-cal-empty',
        )
        if (!observed) {
          return (
            <div key={item.key} className={cls}>
              <span className="returns-cal-date">{month}月</span>
              {elapsed && <span className="returns-cal-amount returns-cal-month-placeholder">—</span>}
            </div>
          )
        }
        return (
          <button
            key={item.key}
            type="button"
            className={cls}
            aria-label={`查看 ${year}年${month}月 每日收益`}
            onClick={() => onSelectMonth(item.key)}
          >
            <span className="returns-cal-date">{month}月</span>
            <span className="returns-cal-amount">{fmtSignedCnyCompact(item.total)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 年收益：每年一行，全年合计着色。 */
export function ReturnsYearList({ totals }: { totals: PeriodTotal[] }) {
  return (
    <div className="returns-cal-year-list">
      {totals.map((item) => (
        <div
          key={item.key}
          className={cx(
            'returns-cal-year-row',
            item.hasAmount && item.total !== 0 && (item.total > 0 ? 'returns-cal-up' : 'returns-cal-down'),
          )}
        >
          <span className="returns-cal-year-label num">{item.key}年</span>
          <span className={cx('returns-cal-amount', !item.hasAmount && 'text-ink-faint')}>
            {item.hasAmount ? fmtSignedCnyCompact(item.total) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
