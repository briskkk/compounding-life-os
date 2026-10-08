'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/format'
import { displayReviewMonth, reviewMonthOf, shiftReviewMonth } from '@/lib/review-workspace'

export function GroupReviewMonthControl({ scope, month, currentMonth }: { scope: string; month: string; currentMonth: string }) {
  const router = useRouter()
  const nextMonth = shiftReviewMonth(month, 1)
  const historical = month < currentMonth
  const href = (value: string) => `/review/groups?${new URLSearchParams({ scope, period: 'THIS_MONTH', month: value }).toString()}`

  return (
    <div className={cx('review-month-control', historical && 'has-current')} role="group" aria-label="分类复盘月份">
      <Link className="review-month-step" href={href(shiftReviewMonth(month, -1))} aria-label="查看上一个月" prefetch={false}><span aria-hidden="true">‹</span></Link>
      <label className="review-month-value" htmlFor="group-review-month">
        <span aria-hidden="true">{displayReviewMonth(month)}</span>
        <input
          id="group-review-month"
          type="month"
          aria-label="选择复盘月份"
          value={month}
          max={currentMonth}
          onChange={(event) => {
            const value = reviewMonthOf(event.target.value)
            if (value && value <= currentMonth) router.push(href(value))
          }}
        />
      </label>
      {nextMonth <= currentMonth
        ? <Link className="review-month-step" href={href(nextMonth)} aria-label="查看下一个月" prefetch={false}><span aria-hidden="true">›</span></Link>
        : <button className="review-month-step" type="button" aria-label="已经是当前月" disabled><span aria-hidden="true">›</span></button>}
      {historical && <Link className="review-month-current" href={href(currentMonth)} aria-label="回到本月" prefetch={false}>当前月</Link>}
    </div>
  )
}
