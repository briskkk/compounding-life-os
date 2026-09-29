'use client'

import { useMemo, useState, type FormEvent } from 'react'
import {
  performanceBetween,
  performancePresetRange,
  upsertPerformancePoint,
  type PerformancePoint,
  type PerformancePreset,
} from '@/lib/engine/period-performance'
import { alignBenchmark, DEFAULT_BENCHMARK_SYMBOL, type LoadedBenchmark } from '@/lib/engine/benchmark'
import { RISK_FREE_ANNUAL, riskMetrics } from '@/lib/engine/risk'
import { dateKeyAt } from '@/lib/engine/watch-market'
import { cx, fmtCNY } from '@/lib/format'
import { btnCls, inputCls } from './fields'
import { PortfolioMoneyChart, PortfolioPctChart } from './charts'
import { ReturnsCalendar } from './returns-calendar'
import { HashOpenDetails } from './hash-open-details'
import type { LiveDayReturn } from '@/lib/engine/returns-calendar'
import { valuationStatusText } from './valuation-status-text'

const PRESETS: { value: PerformancePreset; label: string }[] = [
  { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' },
  { value: 'THIS_YEAR', label: '今年' },
  { value: 'LAST_7_DAYS', label: '近 7 日' },
  { value: 'LAST_30_DAYS', label: '近 30 日' },
  { value: 'LAST_YEAR', label: '近一年' },
  { value: 'ALL', label: '全部' },
]

const CHART_TABS = [
  { value: 'RETURN', label: '收益率曲线' },
  { value: 'AMOUNT', label: '累计收益曲线' },
  { value: 'WEALTH', label: '资产趋势' },
] as const

type ChartTab = (typeof CHART_TABS)[number]['value']

function signedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

export function PortfolioHistory({
  series,
  livePoint,
  liveDayReturn,
  benchmarks = [],
  initialPreset,
  scopeLabel,
}: {
  series: PerformancePoint[]
  livePoint: PerformancePoint | null
  liveDayReturn: LiveDayReturn | null
  benchmarks?: LoadedBenchmark[]
  initialPreset?: string
  scopeLabel?: string
}) {
  const todayKey = dateKeyAt(new Date())
  const liveSeries = useMemo(() => upsertPerformancePoint(series, livePoint), [livePoint, series])

  const earliestDate = liveSeries[0]?.date ?? todayKey
  const initialCustomRange = performancePresetRange('LAST_30_DAYS', new Date(), earliestDate)
  // 用户偏好：默认收益区间（设置页可配置；非法值回落到 THIS_MONTH）
  const initialPresetKey = PRESETS.some((p) => p.value === initialPreset) ? (initialPreset as PerformancePreset) : 'THIS_MONTH'
  const [preset, setPreset] = useState<PerformancePreset>(initialPresetKey)
  const [chartTab, setChartTab] = useState<ChartTab>('RETURN')
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
  const unsettledRows = performance.curve.filter((point) => point.valuationStatus === 'PARTIAL' || point.valuationStatus === 'NO_UPDATE')
  const endPoint = performance.curve.at(-1)
  const hasReturnObservations = performance.curve.some((point) => point.dailyPct != null)

  // 风险三指标与基准对齐：与所选区间同口径，随周期切换即时重算
  const risk = useMemo(() => riskMetrics(performance.curve), [performance])
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(DEFAULT_BENCHMARK_SYMBOL)
  const activeBenchmark = benchmarks.find((item) => item.symbol === benchmarkSymbol) ?? benchmarks[0] ?? null
  const benchCurve = useMemo(
    () => alignBenchmark(performance.curve.map((point) => point.date), activeBenchmark?.points ?? []),
    [activeBenchmark, performance],
  )
  const benchValidCount = benchCurve.filter((value) => value != null).length
  const mwrTotal = hasReturnObservations ? endPoint?.mwrPct ?? null : null
  const hasBenchmark = benchValidCount > 1
  const benchmarkTotal = hasBenchmark ? benchCurve[benchCurve.length - 1] : null
  const chartData = useMemo(
    () => performance.curve.map((point, index) => ({ ...point, benchPct: hasBenchmark ? benchCurve[index] : null })),
    [benchCurve, hasBenchmark, performance],
  )

  return (
    <section className="portfolio-history" aria-labelledby="portfolio-history-title">
      <header className="portfolio-history-header">
        <div>
          <h2 id="portfolio-history-title">{scopeLabel ? `${scopeLabel} · 历史收益` : '组合历史收益'}</h2>
          <p>仅统计可投资组合；分组收益按账本资金流重算。</p>
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

      {benchmarks.length > 0 && (
        <div className="history-range-controls" role="group" aria-label="基准指数">
          <span className="self-center text-[13px] text-ink-faint">对比基准</span>
          {benchmarks.map((item) => (
            <button
              key={item.symbol}
              type="button"
              aria-pressed={activeBenchmark?.symbol === item.symbol}
              className="history-range-button"
              onClick={() => setBenchmarkSymbol(item.symbol)}
            >
              {item.label}
            </button>
          ))}
        </div>
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
            <div>
              <span>期末估值状态</span>
              <strong>{endPoint ? valuationStatusText(endPoint) : '—'}</strong>
            </div>
            <div>
              {/* 整串标签一次渲染：JSX 插值会在「同期」与指数名之间插入注释节点，
                  读屏/DOM 文本匹配与 E2E 都更稳 */}
              <span>{`同期${activeBenchmark?.label ?? '基准'}`}</span>
              <strong className={cx('num', benchmarkTotal == null ? 'text-ink-faint' : benchmarkTotal >= 0 ? 'text-up' : 'text-down')}>
                {benchmarkTotal == null ? '—' : signedPct(benchmarkTotal)}
              </strong>
            </div>
            <div>
              <span>最大回撤</span>
              <strong className={cx('num', risk.maxDrawdown == null ? 'text-ink-faint' : 'text-down')}>
                {risk.maxDrawdown == null ? '—' : signedPct(risk.maxDrawdown)}
              </strong>
            </div>
            <div>
              <span>年化波动率</span>
              <strong className={cx('num', risk.volatility == null && 'text-ink-faint')}>
                {risk.volatility == null ? '—' : `${(risk.volatility * 100).toFixed(1)}%`}
              </strong>
            </div>
            <div>
              <span>夏普比率</span>
              <strong className={cx('num', risk.sharpe == null && 'text-ink-faint')}>
                {risk.sharpe == null ? '—' : risk.sharpe.toFixed(2)}
              </strong>
            </div>
          </div>

          {unsettledRows.length > 0 && (
            <p className="history-valuation-warning" role="status">
              当前区间有 {unsettledRows.length} 个估值日尚未完全结算；部分基金或 QDII 仍沿用旧净值，金额会在官方净值补齐后重算。
            </p>
          )}

          {hasReturnObservations ? (
            <HashOpenDetails
              id="history-chart"
              className="watch-history-details"
              summary={<><span>收益率曲线</span><small>{performance.startDate} — {performance.endDate} · 按需展开</small></>}
            >
              <div className="history-chart-surface">
                <div className="history-range-controls history-chart-tabs" role="group" aria-label="历史收益图表视图">
                  {CHART_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      aria-pressed={chartTab === tab.value}
                      className="history-range-button"
                      onClick={() => setChartTab(tab.value)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="history-chart-legend">
                  {chartTab === 'RETURN' && (
                    <>
                      <span className="history-legend-item">
                        <i className="history-legend-rate" aria-hidden="true" />
                        时间加权
                      </span>
                      <span className="history-legend-item">
                        <i className="history-legend-mwr" aria-hidden="true" />
                        资金加权
                      </span>
                      {hasBenchmark && activeBenchmark && (
                        <span className="history-legend-item">
                          <i className="history-legend-bench" aria-hidden="true" />
                          {activeBenchmark.label}基准
                        </span>
                      )}
                    </>
                  )}
                  {chartTab === 'AMOUNT' && (
                    <span className="history-legend-item">
                      <i className="history-legend-mwr" aria-hidden="true" />
                      累计收益金额
                    </span>
                  )}
                  {chartTab === 'WEALTH' && (
                    <span className="history-legend-item">
                      <i className="history-legend-rate" aria-hidden="true" />
                      可投资资产
                    </span>
                  )}
                </div>
                <div
                  role="img"
                  aria-label={
                    chartTab === 'RETURN'
                      ? `${performance.startDate} 至 ${performance.endDate}，累计时间加权收益率 ${pct == null ? '无法计算' : signedPct(pct)}，累计资金加权收益率 ${mwrTotal == null ? '无法计算' : signedPct(mwrTotal)}`
                      : chartTab === 'AMOUNT'
                        ? `${performance.startDate} 至 ${performance.endDate}，累计收益金额 ${amount == null ? '无法计算' : fmtCNY(amount, { sign: true })}`
                        : `${performance.startDate} 至 ${performance.endDate}，期末可投资资产 ${performance.endNetWorth == null ? '无法计算' : fmtCNY(performance.endNetWorth)}`
                  }
                >
                  {chartTab === 'RETURN' && (
                    <PortfolioPctChart data={chartData} benchmarkLabel={activeBenchmark?.label ?? '基准'} />
                  )}
                  {chartTab === 'AMOUNT' && (
                    <PortfolioMoneyChart data={chartData} dataKey="amount" name="累计收益金额" />
                  )}
                  {chartTab === 'WEALTH' && (
                    <PortfolioMoneyChart data={chartData} dataKey="netWorth" name="可投资资产" />
                  )}
                </div>
              </div>
            </HashOpenDetails>
          ) : (
            <p className="history-chart-empty">该区间没有新的有效估值，收益记为“—”。</p>
          )}

          <HashOpenDetails
            id="history-calendar"
            className="watch-history-details"
            summary={<><span>收益日历</span><small>日 / 月 / 年与当日明细 · 按需展开</small></>}
          >
            <ReturnsCalendar
              series={liveSeries}
              benchmark={activeBenchmark}
              todayKey={todayKey}
              liveDayReturn={liveDayReturn}
            />
          </HashOpenDetails>

          <p className="history-method-note">
            今天有实时报价时，收益日历与顶部“今日涨跌”共用实时昨收口径；历史日期按相邻有效估值快照计算收益，并扣除期间存入与取出。休市、无新估值和仅资金流日期保留余额记录，但收益显示为“—”，不进入波动率与夏普样本。部分估值为临时结果，待基金或 QDII 官方净值补齐后回填。期初基准为 {performance.basisDate ?? '—'} 估值快照。
            资金加权收益率按修正迪茨法（Modified Dietz）逐日链式计算，当日出入金按日中点（权重 0.5）计入分母，反映资金投入时点的影响；时间加权收益率则剔除出入金影响，衡量组合本身表现。
            最大回撤为区间内净值峰值到谷底的最大跌幅；波动率按日收益样本标准差 × √252 年化；夏普比率的无风险利率按 {`${(RISK_FREE_ANNUAL * 100).toFixed(0)}%`} 假设。
          </p>
        </>
      ) : (
        <div className="history-empty">历史快照不足，录入流水并生成至少两个日期的资产快照后即可计算。</div>
      )}
    </section>
  )
}
