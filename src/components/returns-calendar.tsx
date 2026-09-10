'use client'

// 收益日历：日收益（月历网格/柱状图）· 月收益（年网格）· 年收益（年列表）
// 未结算日虚线标记；点击有数据的日期弹出当日明细
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PerformanceCurvePoint, PerformancePoint } from '@/lib/engine/period-performance'
import type { LoadedBenchmark } from '@/lib/engine/benchmark'
import {
  allYearTotals,
  applyLiveDayReturn,
  benchmarkMonthReturn,
  benchmarkYearReturn,
  buildMonthGrid,
  monthDailyPoints,
  monthKeyOf,
  observedReturnMonths,
  shiftMonthKey,
  yearMonthTotals,
  type LiveDayReturn,
  type PeriodTotal,
} from '@/lib/engine/returns-calendar'
import { C } from '@/lib/colors'
import { cx, fmtCNY } from '@/lib/format'
import { valuationStatusTitle } from './valuation-status-text'
import { ReturnsYearGrid, ReturnsYearList } from './returns-calendar-scopes'
import { ReturnsDayDialog, type DayDetail } from './returns-day-dialog'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

type Scope = 'DAY' | 'MONTH' | 'YEAR'

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'DAY', label: '日收益' },
  { value: 'MONTH', label: '月收益' },
  { value: 'YEAR', label: '年收益' },
]

function signedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

/** 页脚合计：分桶结果求和；任何桶都没有收益观察时记 null */
function sumPeriodTotals(totals: PeriodTotal[]): { amount: number | null } {
  let amount = 0
  let hasAmount = false
  for (const item of totals) {
    if (item.hasAmount) {
      amount += item.total
      hasAmount = true
    }
  }
  return { amount: hasAmount ? amount : null }
}

/** 柱状图 Y 轴：紧凑万缩写，不带 + 号 */
function fmtBarAxis(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e4) return `${(value / 1e4).toFixed(0)}万`
  return `${Math.round(value)}`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 柱状图提示框：沿用 charts.tsx 的 DarkTooltip 样式，金额保留完整千分位与小数。 */
function CalBarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload as { date: string; amount: number }
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      <div className="num mb-1 text-ink-faint">{Number(item.date.slice(5, 7))}月{Number(item.date.slice(8, 10))}日</div>
      <div className="flex items-center gap-2 py-0.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: item.amount >= 0 ? C.up : C.down }} />
        <span className="text-ink-dim">当日收益</span>
        <span className="num ml-auto pl-3 text-ink">{fmtCNY(item.amount, { sign: true })}</span>
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function ReturnsCalendar({
  series,
  benchmark,
  todayKey,
  liveDayReturn,
}: {
  series: PerformancePoint[]
  benchmark: LoadedBenchmark | null
  todayKey: string
  liveDayReturn: LiveDayReturn | null
}) {
  const latestMonth = monthKeyOf(series.at(-1)?.date ?? todayKey)
  const earliestMonth = monthKeyOf(series[0]?.date ?? todayKey)
  const currentMonth = monthKeyOf(todayKey)
  const currentYear = Number(todayKey.slice(0, 4))

  // 收益观察口径：快照跨度可能远早于首个有效估值，月/年视图只认有观察的月份与年份
  const observedMonths = useMemo(() => observedReturnMonths(series), [series])
  const allYearTotalsList = useMemo(() => allYearTotals(series), [series])
  const firstObservedYear = Number(allYearTotalsList[0]?.key ?? currentYear)
  const lastObservedYear = Number(allYearTotalsList.at(-1)?.key ?? currentYear)

  const [scope, setScope] = useState<Scope>('DAY')
  const [monthKey, setMonthKey] = useState(latestMonth)
  const [mode, setMode] = useState<'AMOUNT' | 'PCT'>('AMOUNT')
  const [dayView, setDayView] = useState<'CAL' | 'BARS'>('CAL')
  const [year, setYear] = useState(lastObservedYear)
  const [detail, setDetail] = useState<DayDetail | null>(null)

  // ---- 日收益：当月逐日曲线 ----
  const weeks = useMemo(() => buildMonthGrid(monthKey), [monthKey])
  const daily = useMemo(
    () => applyLiveDayReturn(monthDailyPoints(series, monthKey), liveDayReturn),
    [liveDayReturn, monthKey, series],
  )
  const benchmarkReturn = useMemo(
    () => (benchmark ? benchmarkMonthReturn(benchmark.points, monthKey) : null),
    [benchmark, monthKey],
  )
  const bars = useMemo(
    () => [...daily.values()]
      .filter((point): point is PerformanceCurvePoint & { dailyAmount: number } => point.dailyAmount != null)
      .map((point) => ({ date: point.date, day: Number(point.date.slice(8, 10)), amount: point.dailyAmount })),
    [daily],
  )

  let monthTotal = 0
  let monthHasAmount = false
  for (const point of daily.values()) {
    if (point.dailyAmount != null) {
      monthTotal += point.dailyAmount
      monthHasAmount = true
    }
  }

  // ---- 月收益：当年分月合计（网格与页脚共享同一份分桶结果；年合计见上方 allYearTotalsList） ----
  const yearTotals = useMemo(() => yearMonthTotals(series, year), [series, year])
  const yearBenchmarkReturn = useMemo(
    () => (benchmark ? benchmarkYearReturn(benchmark.points, year) : null),
    [benchmark, year],
  )
  const yearTotal = useMemo(() => sumPeriodTotals(yearTotals), [yearTotals])
  const allTimeTotal = useMemo(() => sumPeriodTotals(allYearTotalsList), [allYearTotalsList])

  const canPrevMonth = monthKey > earliestMonth
  const canNextMonth = monthKey < currentMonth
  const canPrevYear = year > firstObservedYear
  const canNextYear = year < lastObservedYear
  const month = Number(monthKey.slice(5, 7))

  return (
    <div className="returns-cal" aria-label="收益日历">
      <div className="returns-cal-head">
        <div className="returns-cal-toggle" role="group" aria-label="收益粒度">
          {SCOPES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={scope === item.value}
              className="history-range-button"
              onClick={() => setScope(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {scope === 'DAY' && (
          <div className="returns-cal-tools">
            <div className="returns-cal-toggle" role="group" aria-label="日收益视图">
              <button
                type="button"
                aria-pressed={dayView === 'CAL'}
                className="history-range-button"
                onClick={() => setDayView('CAL')}
              >
                日历图
              </button>
              <button
                type="button"
                aria-pressed={dayView === 'BARS'}
                className="history-range-button"
                onClick={() => setDayView('BARS')}
              >
                柱状图
              </button>
            </div>
            <div className="returns-cal-toggle" role="group" aria-label="收益显示口径">
              <button
                type="button"
                aria-pressed={mode === 'AMOUNT'}
                className="history-range-button"
                onClick={() => setMode('AMOUNT')}
              >
                金额 ¥
              </button>
              <button
                type="button"
                aria-pressed={mode === 'PCT'}
                className="history-range-button"
                onClick={() => setMode('PCT')}
              >
                收益率 %
              </button>
            </div>
          </div>
        )}
      </div>

      {scope !== 'YEAR' && (
        <div className="returns-cal-subhead">
          {scope === 'DAY' ? (
            <div className="returns-cal-nav" role="group" aria-label="日历月份切换">
              <button
                type="button"
                aria-label="上一月"
                disabled={!canPrevMonth}
                onClick={() => setMonthKey((key) => shiftMonthKey(key, -1))}
              >
                ‹
              </button>
              <span className="returns-cal-month num" aria-live="polite">{Number(monthKey.slice(0, 4))}年{month}月</span>
              <button
                type="button"
                aria-label="下一月"
                disabled={!canNextMonth}
                onClick={() => setMonthKey((key) => shiftMonthKey(key, 1))}
              >
                ›
              </button>
            </div>
          ) : (
            <div className="returns-cal-nav" role="group" aria-label="年份切换">
              <button
                type="button"
                aria-label="上一年"
                disabled={!canPrevYear}
                onClick={() => setYear((value) => value - 1)}
              >
                ‹
              </button>
              <span className="returns-cal-month num" aria-live="polite">{year}年</span>
              <button
                type="button"
                aria-label="下一年"
                disabled={!canNextYear}
                onClick={() => setYear((value) => value + 1)}
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}

      {scope === 'DAY' && dayView === 'CAL' && (
        <>
          <div className="returns-cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="returns-cal-grid">
            {weeks.flat().map((day) => {
              if (!day.inMonth) {
                return (
                  <div key={day.date} className="returns-cal-cell returns-cal-spill" aria-hidden="true">
                    <span className="returns-cal-date num">{Number(day.date.slice(8, 10))}</span>
                  </div>
                )
              }
              const point = daily.get(day.date) ?? null
              const value = point == null ? null : mode === 'AMOUNT' ? point.dailyAmount : point.dailyPct
              const unsettled = point != null && (point.valuationStatus === 'PARTIAL' || point.valuationStatus === 'NO_UPDATE')
              const cls = cx(
                'returns-cal-cell',
                point == null && 'returns-cal-empty',
                value != null && value !== 0 && (value > 0 ? 'returns-cal-up' : 'returns-cal-down'),
                unsettled && 'returns-cal-unsettled',
                day.date === todayKey && 'returns-cal-today',
              )
              const dateLabel = <span className="returns-cal-date num">{Number(day.date.slice(8, 10))}</span>
              const amountLabel = value != null && (
                <span className="returns-cal-amount">
                  {mode === 'AMOUNT' ? fmtCNY(value, { sign: true }) : signedPct(value)}
                </span>
              )
              // 无快照的日期保持惰性；有数据的日期可点开当日明细
              if (point == null) {
                return <div key={day.date} className={cls}>{dateLabel}</div>
              }
              return (
                <button
                  key={day.date}
                  type="button"
                  className={cls}
                  data-testid={day.date === todayKey ? 'returns-calendar-today' : undefined}
                  data-amount={day.date === todayKey && point.dailyAmount != null ? point.dailyAmount.toFixed(2) : undefined}
                  title={unsettled ? valuationStatusTitle(point) : undefined}
                  onClick={() => setDetail({ date: day.date, point })}
                >
                  {dateLabel}
                  {amountLabel}
                </button>
              )
            })}
          </div>
        </>
      )}

      {scope === 'DAY' && dayView === 'BARS' && (
        <div
          className="returns-cal-bars"
          role="img"
          aria-label={`${Number(monthKey.slice(0, 4))}年${month}月每日收益柱状图，共 ${bars.length} 个收益观察日`}
        >
          {bars.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={bars} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: C.inkFaint, fontSize: 11 }}
                  minTickGap={18}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: C.inkFaint, fontSize: 11 }}
                  tickFormatter={fmtBarAxis}
                  width={44}
                />
                <Tooltip content={<CalBarTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }} />
                <ReferenceLine y={0} stroke={C.inkFaint} strokeDasharray="4 7" />
                <Bar dataKey="amount" isAnimationActive={false} maxBarSize={10} radius={[2, 2, 0, 0]}>
                  {bars.map((bar) => (
                    <Cell key={bar.date} fill={bar.amount >= 0 ? C.up : C.down} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="returns-cal-bars-empty">该月没有收益观察日。</p>
          )}
        </div>
      )}

      {scope === 'MONTH' && (
        <ReturnsYearGrid
          totals={yearTotals}
          year={year}
          observedMonths={observedMonths}
          currentMonth={currentMonth}
          onSelectMonth={(key) => {
            setMonthKey(key)
            setScope('DAY')
          }}
        />
      )}

      {scope === 'YEAR' && <ReturnsYearList totals={allYearTotalsList} />}

      <div className="returns-cal-foot">
        {scope === 'DAY' && (
          <span>
            当月收益合计
            <strong className={cx('num', !monthHasAmount ? 'text-ink-faint' : monthTotal >= 0 ? 'text-up' : 'text-down')}>
              {monthHasAmount ? fmtCNY(monthTotal, { sign: true }) : '—'}
            </strong>
          </span>
        )}
        {scope === 'DAY' && benchmark != null && benchmarkReturn != null && (
          <span>
            当月{benchmark.label}涨跌幅
            <strong className={cx('num', benchmarkReturn >= 0 ? 'text-up' : 'text-down')}>
              {signedPct(benchmarkReturn)}
            </strong>
          </span>
        )}
        {scope === 'MONTH' && (
          <span>
            当年收益合计
            <strong className={cx('num', yearTotal.amount == null ? 'text-ink-faint' : yearTotal.amount >= 0 ? 'text-up' : 'text-down')}>
              {yearTotal.amount == null ? '—' : fmtCNY(yearTotal.amount, { sign: true })}
            </strong>
          </span>
        )}
        {scope === 'MONTH' && benchmark != null && yearBenchmarkReturn != null && (
          <span>
            当年{benchmark.label}涨跌幅
            <strong className={cx('num', yearBenchmarkReturn >= 0 ? 'text-up' : 'text-down')}>
              {signedPct(yearBenchmarkReturn)}
            </strong>
          </span>
        )}
        {scope === 'YEAR' && (
          <span>
            累计收益合计
            <strong className={cx('num', allTimeTotal.amount == null ? 'text-ink-faint' : allTimeTotal.amount >= 0 ? 'text-up' : 'text-down')}>
              {allTimeTotal.amount == null ? '—' : fmtCNY(allTimeTotal.amount, { sign: true })}
            </strong>
          </span>
        )}
      </div>

      <ReturnsDayDialog detail={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
