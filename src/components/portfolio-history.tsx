'use client'

import { useMemo, useState, type FormEvent } from 'react'
import {
  performanceBetween,
  performancePresetRange,
  type PerformancePoint,
  type PerformancePreset,
} from '@/lib/engine/period-performance'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { cx, fmtCNY } from '@/lib/format'
import { btnCls, inputCls } from './fields'
import { PortfolioReturnChart } from './charts'

const PRESETS: { value: PerformancePreset; label: string }[] = [
  { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' },
  { value: 'THIS_YEAR', label: '今年' },
  { value: 'LAST_7_DAYS', label: '近 7 日' },
  { value: 'LAST_30_DAYS', label: '近 30 日' },
  { value: 'LAST_YEAR', label: '近一年' },
  { value: 'ALL', label: '全部' },
]

function signedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

export function PortfolioHistory({
  series,
  liveValue,
  currentContributions,
}: {
  series: PerformancePoint[]
  liveValue: number
  currentContributions: number
}) {
  const todayKey = dateKeyAt(new Date())
  const liveSeries = useMemo(() => {
    const next = [...series]
    const livePoint = { date: todayKey, netWorth: liveValue, contributions: currentContributions }
    const todayIndex = next.findIndex((point) => point.date === todayKey)
    if (todayIndex >= 0) next[todayIndex] = livePoint
    else next.push(livePoint)
    return next.sort((a, b) => a.date.localeCompare(b.date))
  }, [currentContributions, liveValue, series, todayKey])

  const earliestDate = liveSeries[0]?.date ?? todayKey
  const initialCustomRange = performancePresetRange('LAST_30_DAYS', new Date(), earliestDate)
  const [preset, setPreset] = useState<PerformancePreset>('THIS_MONTH')
  const [customOpen, setCustomOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(initialCustomRange.startDate)
  const [draftEnd, setDraftEnd] = useState(initialCustomRange.endDate)
  const [customRange, setCustomRange] = useState<{ startDate: string; endDate: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = customRange
    ? { label: '自定义', ...customRange }
    : performancePresetRange(preset, new Date(), earliestDate)
  const performance = useMemo(
    () => performanceBetween(liveSeries, range.startDate, range.endDate, range.label),
    [liveSeries, range.endDate, range.label, range.startDate],
  )

  function selectPreset(next: PerformancePreset) {
    setPreset(next)
    setCustomRange(null)
    setCustomOpen(false)
    setError(null)
  }

  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draftStart > draftEnd) {
      setError('开始日期不能晚于结束日期，请调整后重试。')
      return
    }
    const next = performanceBetween(liveSeries, draftStart, draftEnd, '自定义')
    if (next.endDate == null) {
      setError('该日期范围内没有历史快照，请选择有记录的日期。')
      return
    }
    setCustomRange({ startDate: draftStart, endDate: draftEnd })
    setError(null)
  }

  const amount = performance.amount
  const pct = performance.pct
  const hasHistory = performance.endDate != null
  // 首点是期初计算基准，没有“当日”收益；明细只展示其后的真实日变化。
  const recentRows = performance.curve.slice(1).slice(-20).reverse()

  return (
    <section className="portfolio-history" aria-labelledby="portfolio-history-title">
      <header className="portfolio-history-header">
        <div>
          <div className="eyebrow">HISTORICAL PERFORMANCE</div>
          <h2 id="portfolio-history-title">组合历史收益</h2>
          <p>仅统计可投资组合，华为股票、房产与负债不参与历史收益计算。</p>
        </div>
        {hasHistory && (
          <div className="portfolio-history-period num" aria-live="polite">
            {performance.startDate} — {performance.endDate}
          </div>
        )}
      </header>

      <div className="history-range-controls" role="group" aria-label="收益查询周期">
        {PRESETS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={!customRange && preset === item.value}
            className="history-range-button"
            onClick={() => selectPreset(item.value)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={customOpen}
          aria-pressed={customRange != null}
          className="history-range-button"
          onClick={() => {
            setCustomOpen((open) => !open)
            setError(null)
          }}
        >
          自定义
        </button>
      </div>

      {customOpen && (
        <form className="history-date-form" onSubmit={applyCustomRange} noValidate>
          <label>
            <span>开始日期</span>
            <input
              type="date"
              required
              min={earliestDate}
              max={todayKey}
              value={draftStart}
              className={inputCls}
              onChange={(event) => setDraftStart(event.target.value)}
            />
          </label>
          <label>
            <span>结束日期</span>
            <input
              type="date"
              required
              min={earliestDate}
              max={todayKey}
              value={draftEnd}
              className={inputCls}
              onChange={(event) => setDraftEnd(event.target.value)}
            />
          </label>
          <button type="submit" className={btnCls}>查询</button>
          {error && <p className="history-date-error" role="alert">{error}</p>}
        </form>
      )}

      {hasHistory ? (
        <>
          <div className="history-metrics" aria-label={`${performance.label}收益摘要`}>
            <div>
              <span>收益金额</span>
              <strong className={cx('num', amount == null ? 'text-ink-faint' : amount >= 0 ? 'text-up' : 'text-down')}>
                {amount == null ? '—' : fmtCNY(amount, { sign: true })}
              </strong>
            </div>
            <div>
              <span>时间加权收益率</span>
              <strong className={cx('num', pct == null ? 'text-ink-faint' : pct >= 0 ? 'text-up' : 'text-down')}>
                {pct == null ? '—' : signedPct(pct)}
              </strong>
            </div>
            <div>
              <span>同期净投入</span>
              <strong className="num">{performance.netFlow == null ? '—' : fmtCNY(performance.netFlow, { sign: true })}</strong>
            </div>
            <div>
              <span>期初可投资资产</span>
              <strong className="num">{performance.baseNetWorth == null ? '—' : fmtCNY(performance.baseNetWorth)}</strong>
            </div>
            <div>
              <span>期末可投资资产</span>
              <strong className="num">{performance.endNetWorth == null ? '—' : fmtCNY(performance.endNetWorth)}</strong>
            </div>
          </div>

          <div className="history-chart-surface">
            <div className="history-chart-legend">
              <span className="history-legend-item">
                <i className="history-legend-rate" aria-hidden="true" />
                累计时间加权收益率（左轴）
              </span>
              <span className="history-legend-item">
                <i className="history-legend-amount" aria-hidden="true" />
                累计收益金额（右轴）
              </span>
            </div>
            {performance.curve.length > 1 ? (
              <div
                role="img"
                aria-label={`${performance.startDate} 至 ${performance.endDate}，累计时间加权收益率 ${pct == null ? '无法计算' : signedPct(pct)}，累计收益金额 ${amount == null ? '无法计算' : fmtCNY(amount, { sign: true })}`}
              >
                <PortfolioReturnChart data={performance.curve} />
              </div>
            ) : (
              <div className="history-chart-empty">该区间只有一个快照，收益为 0。</div>
            )}
          </div>

          {recentRows.length > 0 && (
            <details className="history-details">
              <summary>查看最近 {recentRows.length} 个快照明细</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>日期</th><th>当日收益率</th><th>当日收益金额</th><th>可投资资产</th></tr>
                  </thead>
                  <tbody>
                    {recentRows.map((point) => (
                      <tr key={point.date}>
                        <td className="num">{point.date}</td>
                        <td className="num">{point.dailyPct == null ? '—' : signedPct(point.dailyPct)}</td>
                        <td className={cx('num', point.dailyAmount == null ? 'text-ink-faint' : point.dailyAmount >= 0 ? 'text-up' : 'text-down')}>
                          {point.dailyAmount == null ? '—' : fmtCNY(point.dailyAmount, { sign: true })}
                        </td>
                        <td className="num">{fmtCNY(point.netWorth)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <p className="history-method-note">
            明细按相邻快照计算当日收益，并扣除当天存入与取出；曲线收益率再将每日结果链式计算，避免大额出入金扭曲表现。期初基准为 {performance.basisDate ?? '—'} 收盘快照。
          </p>
        </>
      ) : (
        <div className="history-empty">历史快照不足，录入流水并生成至少两个日期的资产快照后即可计算。</div>
      )}
    </section>
  )
}
