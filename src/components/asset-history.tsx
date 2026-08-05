'use client'

import { useMemo, useState, type FormEvent } from 'react'
import type { AssetPerformancePoint } from '@/lib/engine/asset-performance'
import {
  performanceBetween,
  performancePresetRange,
  type PerformanceCurvePoint,
  type PerformancePreset,
} from '@/lib/engine/period-performance'
import { cx, fmtCNY, fmtMoney, fmtQty } from '@/lib/format'
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

function assetValuationStatusText(point: Pick<PerformanceCurvePoint, 'valuationStatus'>): string {
  if (point.valuationStatus === 'SETTLED') return '已结算'
  if (point.valuationStatus === 'PARTIAL') return '部分估值'
  if (point.valuationStatus === 'CLOSED') return '休市'
  if (point.valuationStatus === 'NO_UPDATE') return '无新估值'
  if (point.valuationStatus === 'FLOW_ONLY') return '仅资金流'
  if (point.valuationStatus === 'LIVE') return '实时估算'
  return '历史口径'
}

function assetValuationStatusTitle(point: PerformanceCurvePoint): string {
  const gap = point.valuationGaps?.[0]
  if (gap?.reason === 'MARKET_CLOSED') return `休市，沿用 ${gap.valuationDate ?? '最近估值'}`
  if (gap) return gap.valuationDate ? `暂沿用 ${gap.valuationDate}` : '缺少官方估值'
  return assetValuationStatusText(point)
}

export function AssetHistory({
  assetName,
  currency,
  series,
  longTerm = false,
}: {
  assetName: string
  currency: string
  series: AssetPerformancePoint[]
  longTerm?: boolean
}) {
  const earliestDate = series[0]?.date ?? ''
  const latestDate = series.at(-1)?.date ?? ''
  const initialCustomRange = performancePresetRange('LAST_30_DAYS', new Date(), earliestDate)
  const [preset, setPreset] = useState<PerformancePreset>('THIS_MONTH')
  const [customOpen, setCustomOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(initialCustomRange.startDate)
  const [draftEnd, setDraftEnd] = useState(latestDate || initialCustomRange.endDate)
  const [customRange, setCustomRange] = useState<{ startDate: string; endDate: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = customRange
    ? { label: '自定义', ...customRange }
    : performancePresetRange(preset, new Date(), earliestDate)
  const performance = useMemo(
    () => performanceBetween(series, range.startDate, range.endDate, range.label),
    [range.endDate, range.label, range.startDate, series],
  )
  const snapshotByDate = useMemo(() => new Map(series.map((point) => [point.date, point])), [series])
  const recentRows = performance.curve
    .slice(1)
    .slice(-20)
    .reverse()
    .map((point) => ({ ...point, snapshot: snapshotByDate.get(point.date) }))

  function selectPreset(next: PerformancePreset) {
    setPreset(next)
    setCustomRange(null)
    setCustomOpen(false)
    setError(null)
  }

  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draftStart || !draftEnd) {
      setError('请选择开始日期和结束日期。')
      return
    }
    if (draftStart > draftEnd) {
      setError('开始日期不能晚于结束日期，请调整后重试。')
      return
    }
    const next = performanceBetween(series, draftStart, draftEnd, '自定义')
    if (!next.endDate) {
      setError('该日期范围内没有资产快照，请选择有记录的日期。')
      return
    }
    setCustomRange({ startDate: draftStart, endDate: draftEnd })
    setError(null)
  }

  const amount = performance.amount
  const pct = performance.pct
  const hasHistory = performance.endDate != null
  const endPoint = performance.curve.at(-1)
  const unsettledRows = performance.curve.filter((point) => point.valuationStatus === 'PARTIAL' || point.valuationStatus === 'NO_UPDATE')
  const hasReturnObservations = performance.curve.some((point) => point.dailyPct != null)

  return (
    <section className="portfolio-history asset-history" aria-labelledby="asset-history-title">
      <header className="portfolio-history-header">
        <div>
          <div className="eyebrow">ASSET PERFORMANCE</div>
          <h2 id="asset-history-title">资产历史收益</h2>
          <p>
            按流水回放 {assetName} 的每日持仓，以历史净值或价格计算收益。
            {longTerm && ' 仅作该长期资产独立观察，不计入组合持仓和组合收益。'}
          </p>
        </div>
        {hasHistory && (
          <div className="portfolio-history-period num" aria-live="polite">
            {performance.startDate} — {performance.endDate}
          </div>
        )}
      </header>

      <div className="history-range-controls" role="group" aria-label={`${assetName}收益查询周期`}>
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
              max={latestDate}
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
              max={latestDate}
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
          <div className="history-metrics" aria-label={`${assetName}${performance.label}收益摘要`}>
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
              <span>期间净资金流</span>
              <strong className="num">{performance.netFlow == null ? '—' : fmtCNY(performance.netFlow, { sign: true })}</strong>
            </div>
            <div>
              <span>期初市值</span>
              <strong className="num">{performance.baseNetWorth == null ? '—' : fmtCNY(performance.baseNetWorth)}</strong>
            </div>
            <div>
              <span>期末市值</span>
              <strong className="num">{performance.endNetWorth == null ? '—' : fmtCNY(performance.endNetWorth)}</strong>
            </div>
            <div>
              <span>期末估值状态</span>
              <strong>{endPoint ? assetValuationStatusText(endPoint) : '—'}</strong>
            </div>
          </div>

          {unsettledRows.length > 0 && (
            <p className="history-valuation-warning" role="status">
              当前区间有 {unsettledRows.length} 个日期尚无新估值；收益会在官方价格或净值补齐后归入其实际估值日。
            </p>
          )}

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
            {hasReturnObservations ? (
              <div
                role="img"
                aria-label={`${assetName} 从 ${performance.startDate} 至 ${performance.endDate}，累计收益率 ${pct == null ? '无法计算' : signedPct(pct)}，收益金额 ${amount == null ? '无法计算' : fmtCNY(amount, { sign: true })}`}
              >
                <PortfolioReturnChart data={performance.curve} />
              </div>
            ) : (
              <div className="history-chart-empty">该区间没有新的有效估值，收益记为“—”。</div>
            )}
          </div>

          {recentRows.length > 0 && (
            <details className="history-details asset-history-details">
              <summary>查看最近 {recentRows.length} 个资产快照</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>估值状态</th>
                      <th>当日收益率</th>
                      <th>当日收益金额</th>
                      <th>当日持仓</th>
                      <th>当日净值/价格</th>
                      <th>当日市值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((point) => (
                      <tr key={point.date}>
                        <td className="num">{point.date}</td>
                        <td>
                          <span
                            className={`valuation-status valuation-status-${(point.valuationStatus ?? 'LEGACY').toLowerCase()}`}
                            title={assetValuationStatusTitle(point)}
                          >
                            {assetValuationStatusText(point)}
                          </span>
                          {point.valuationStatus === 'CLOSED' && point.latestValuationDate && (
                            <small>沿用至 {point.latestValuationDate}</small>
                          )}
                        </td>
                        <td className="num">{point.dailyPct == null ? '—' : signedPct(point.dailyPct)}</td>
                        <td className={cx('num', point.dailyAmount == null ? 'text-ink-faint' : point.dailyAmount >= 0 ? 'text-up' : 'text-down')}>
                          {point.dailyAmount == null ? '—' : fmtCNY(point.dailyAmount, { sign: true })}
                        </td>
                        <td className="num">{point.snapshot ? fmtQty(point.snapshot.quantity) : '—'}</td>
                        <td className="num">{point.snapshot?.nav == null ? '—' : fmtMoney(point.snapshot.nav, currency)}</td>
                        <td className="num">{point.snapshot ? fmtCNY(point.snapshot.netWorth) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <p className="history-method-note">
            收益按资产自身的交易日或官方净值日期归属，并扣除买卖、转入转出等资金流；休市、无新估值和仅资金流日期保留持仓记录，但收益显示为“—”，不作为 0% 收益参与统计。基金与 QDII 使用官方净值日期，美股使用交易所交易日。
          </p>
        </>
      ) : (
        <div className="history-empty">该资产历史数据不足；录入流水并取得历史净值或价格后即可计算。</div>
      )}
    </section>
  )
}
