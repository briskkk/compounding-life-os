'use client'

// 看盘客户端：30s 轮询分时数据与报价，合成当日组合收益曲线 + 实时估值表
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildPortfolioCurve, type CurveHolding } from '@/lib/engine/intraday'
import { dailyQuoteValuation, summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import { sortHoldings, type HoldingSort } from '@/lib/engine/holding-sort'
import { dateKeyAt, isCurrentPortfolioDay, seriesTradingDate, summarizeValuationDate } from '@/lib/engine/watch-market'
import type { IntradaySeries } from '@/lib/market/intraday'
import { Panel, ScopeLabel } from './ui'
import { IntradayChart } from './charts'
import { cx, fmtCNY, fmtDateTime, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import type { PriceSource } from '@/lib/engine/types'
import { MarketSourceTag, PositionSourceTag, ValuationLegend } from './valuation-source'
import { HoldingSortSelect } from './holding-sort-select'
import { PortfolioHistory } from './portfolio-history'
import type { PerformancePoint } from '@/lib/engine/period-performance'
import type { LoadedBenchmark } from '@/lib/engine/benchmark'
import type { DataSettlementState } from '@/lib/engine/data-settlement'
import { DataSettlementRail } from './data-settlement-rail'
import { TableScroll } from './table-scroll'
import { portfolioDayKey } from '@/lib/engine/portfolio-day'

export interface WatchHolding {
  assetId: string
  symbol: string
  name: string
  cls: string
  currency: string
  qty: number
  rateToCny: number
  prevClose: number | null
  price: number | null
  tradingDate: string | null
  source: string | null
  fallbackValueCny: number
  priceSource: PriceSource
  /** 基金模型估值的置信度（%）；低置信时来源列弱化标注。 */
  confidencePct?: number | null
}

export interface StaticRow {
  assetId: string | null
  symbol: string
  name: string
  valueCny: number
  note: string
  priceSource: PriceSource
  sourceLabel?: string
}

interface QuoteLite {
  symbol: string
  price: number
  prevClose: number
  changePct: number
  source: string
  asOf: string
  tradingDate?: string
  rawPrice?: number
  rawPrevClose?: number
  confidencePct?: number
}

const POLL_MS = 30_000
const INTRADAY_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

export function WatchClient({
  holdings,
  staticValueCny,
  staticInvestableValueCny,
  staticRows,
  provider,
  historySeries,
  currentContributions,
  initialSort,
  defaultRange,
  benchmarks,
  settlement,
}: {
  holdings: WatchHolding[]
  staticValueCny: number
  staticInvestableValueCny: number
  staticRows: StaticRow[]
  provider: string
  historySeries: PerformancePoint[]
  currentContributions: number
  initialSort: HoldingSort
  defaultRange?: string | null
  benchmarks: LoadedBenchmark[]
  settlement: DataSettlementState
}) {
  const [seriesMap, setSeriesMap] = useState<Map<string, IntradaySeries>>(new Map())
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map())
  const [asOf, setAsOf] = useState<string | null>(null)
  const [sort, setSort] = useState<HoldingSort>(initialSort)
  const now = new Date()
  const todayKey = dateKeyAt(now)

  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings])
  const localMarketSymbols = useMemo(() => holdings
    .filter((holding) => holding.cls !== 'FUND' && holding.currency === 'CNY')
    .map((holding) => holding.symbol), [holdings])
  const overseasSymbols = useMemo(() => holdings
    .filter((holding) => holding.cls !== 'FUND' && holding.currency !== 'CNY')
    .map((holding) => holding.symbol), [holdings])
  const fundSymbols = useMemo(() => holdings.filter((holding) => holding.cls === 'FUND').map((holding) => holding.symbol), [holdings])

  useEffect(() => {
    if (symbols.length === 0) return
    let alive = true
    let inFlight = false
    const controller = new AbortController()
    const load = async () => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      const primaryMarketSymbols = localMarketSymbols.length > 0 ? localMarketSymbols : overseasSymbols
      const secondaryMarketSymbols = localMarketSymbols.length > 0 ? overseasSymbols : []
      const fetchSeries = (requestedSymbols: string[]) => fetch(`/api/intraday?symbols=${requestedSymbols.join(',')}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => response.json() as Promise<{ asOf: string; series: Record<string, IntradaySeries> }>)
      const mergeSeries = (data: { asOf: string; series: Record<string, IntradaySeries> }) => {
        if (!alive) return
        setSeriesMap((previous) => new Map([...previous, ...Object.entries(data.series)]))
        setAsOf(data.asOf)
      }
      const pricesRequest = fetch(`/api/prices?symbols=${symbols.join(',')}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => response.json() as Promise<{ quotes: QuoteLite[] }>)
      const marketRequest = primaryMarketSymbols.length > 0
        ? fetchSeries(primaryMarketSymbols)
        : Promise.resolve(null)

      try {
        const [pricesResult, marketResult] = await Promise.allSettled([pricesRequest, marketRequest])
        if (!alive) return
        if (pricesResult.status === 'fulfilled') {
          setQuotes(new Map(pricesResult.value.quotes.map((quote) => [quote.symbol, quote])))
          setAsOf(pricesResult.value.quotes[0]?.asOf ?? null)
        }
        if (marketResult.status === 'fulfilled' && marketResult.value) {
          mergeSeries(marketResult.value)
        }

        // 海外行情与基金估值放到第二阶段并行补全，任一慢源都不再阻塞首条境内收益曲线。
        await Promise.allSettled([
          secondaryMarketSymbols.length > 0 ? fetchSeries(secondaryMarketSymbols).then(mergeSeries) : Promise.resolve(),
          fundSymbols.length > 0 ? fetchSeries(fundSymbols).then(mergeSeries) : Promise.resolve(),
        ])
      } finally {
        inFlight = false
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load()
    }
    void load()
    const t = setInterval(load, POLL_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      alive = false
      controller.abort()
      clearInterval(t)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fundSymbols, localMarketSymbols, overseasSymbols, symbols])

  // 实时估值表行：保留各交易所交易日，组合顶部另按北京时间当前看盘日筛选。
  const rows = useMemo(() => holdings.map((holding) => {
    const series = seriesMap.get(holding.symbol)
    const quote = quotes.get(holding.symbol)
    // 现价与昨收只取报价（原币），并统一乘一次汇率。
    // 不再回退到分时序列的昨收/首点/服务端旧值：那些回退会让「今日涨跌」代表不同的
    // 资产集合（P1-26），此处与总览、收益日历共用 dailyQuoteValuation 的同一判定。
    // 首屏回退到服务端注入的报价（同样来自 state.quotes），因此与总览的初始值完全一致；
    // 但**不回退到分时序列**的昨收/首点——那正是两条路径算出两套「今日涨跌」的原因（P1-26）。
    const price = quote?.rawPrice ?? holding.price
    const prevClose = quote?.rawPrevClose ?? holding.prevClose
    const tradingDate = quote?.tradingDate ?? holding.tradingDate
    const { currentValueCny, previousValueCny } = dailyQuoteValuation({
      quantity: holding.qty,
      quote: price == null ? null : { price, prevClose, tradingDate },
      fallbackValueCny: holding.fallbackValueCny,
      // 海外持仓按各自市场的「今天」判定（与总览/账户同源）
      todayKey: portfolioDayKey({ symbol: holding.symbol, currency: holding.currency, cls: holding.cls }, now),
      rateToCny: holding.rateToCny,
    })
    return {
      ...holding,
      price,
      prevClose,
      changePct: price != null && prevClose ? price / prevClose - 1 : null,
      valueCny: currentValueCny,
      dayPnlCny: previousValueCny == null ? null : currentValueCny - previousValueCny,
      tradingDate,
      currentPortfolioDay: isCurrentPortfolioDay(tradingDate, todayKey),
      source: quote?.source ?? series?.source ?? holding.source ?? null,
      confidencePct: quote?.confidencePct ?? holding.confidencePct ?? null,
    }
  }), [holdings, quotes, seriesMap, todayKey])
  // 今日盈亏的计入范围：只有「数据日 = 该市场当日」且有报价的标的才计入
  const includedRows = rows.filter((row) => row.currentPortfolioDay && row.dayPnlCny != null).length
  const excludedRows = rows.length - includedRows

  const { chartData, totalValue, totalPnl, dayPct, marketStatus } = useMemo(() => {
    const curveHoldings: CurveHolding[] = rows.map((holding) => ({
      symbol: holding.symbol,
      qty: holding.qty,
      rateToCny: holding.rateToCny,
      prevClose: holding.prevClose,
    }))
    const currentPrice = new Map(rows.map((row) => [row.symbol, row.price]))
    const holdingBySymbol = new Map(rows.map((row) => [row.symbol, row]))
    const activeSeries = [...seriesMap].filter(([symbol, series]) => {
      const holding = holdingBySymbol.get(symbol)
      return holding != null && seriesTradingDate(series, holding.currency, holding.cls) === todayKey
    })
    const activeSymbols = new Set(activeSeries.map(([symbol]) => symbol))
    const curveSeries = new Map(
      activeSeries.map(([symbol, series]) => {
        const points = series.points.map((point) => ({ ...point }))
        const current = currentPrice.get(symbol)
        // 报价轮询可能比分时端点更新；用同一价格替换末点，使曲线末点与顶部/表格完全同口径。
        if (current != null && points.length > 0) points[points.length - 1].price = current
        return [symbol, points] as const
      }),
    )
    const quoteOnlyRows = rows.filter((row) => !activeSymbols.has(row.symbol))
    const constantValueCny = staticValueCny + quoteOnlyRows.reduce((sum, row) => sum + row.valueCny, 0)
    const constantPnlCny = quoteOnlyRows.reduce(
      (sum, row) => sum + (row.currentPortfolioDay ? (row.dayPnlCny ?? 0) : 0),
      0,
    )
    const curve = buildPortfolioCurve(curveHoldings, curveSeries, constantValueCny, constantPnlCny)
    const nextChartData = curve.map((point) => ({
      time: INTRADAY_TIME_FORMATTER.format(new Date(point.t)),
      pnl: point.pnl,
      value: point.value,
    }))
    const lastPoint = curve.at(-1)
    const rowSummary = summarizeDailyPortfolio(
      rows.map((row) => ({
        currentValueCny: row.valueCny,
        previousValueCny: !row.currentPortfolioDay || row.dayPnlCny == null
          ? null
          : row.valueCny - row.dayPnlCny,
      })),
      staticValueCny,
    )
    const nextTotalValue = lastPoint?.value ?? rowSummary.valueCny
    const nextTotalPnl = lastPoint?.pnl ?? rowSummary.pnlCny
    const baseline = nextTotalValue - nextTotalPnl
    const latestActivePoint = activeSeries.reduce(
      (latest, [, series]) => Math.max(latest, series.points.at(-1)?.t ?? 0),
      0,
    )
    const currentLag = latestActivePoint > 0 ? Date.now() - latestActivePoint : Number.POSITIVE_INFINITY
    return {
      chartData: nextChartData,
      totalValue: nextTotalValue,
      totalPnl: nextTotalPnl,
      dayPct: baseline > 0 ? nextTotalPnl / baseline : null,
      marketStatus: latestActivePoint === 0 ? '休市' : currentLag <= 10 * 60_000 ? '交易中' : '已收市',
    }
  }, [rows, seriesMap, staticValueCny, todayKey])

  const liveInvestableValue = useMemo(
    () => rows.reduce((sum, row) => sum + row.valueCny, 0) + staticInvestableValueCny,
    [rows, staticInvestableValueCny],
  )
  const liveValuation = useMemo(
    () => summarizeValuationDate(rows.map((row) => ({ tradingDate: row.tradingDate, valueCny: row.valueCny }))),
    [rows],
  )
  const livePerformancePoint = useMemo(() => liveValuation == null ? null : ({
    date: liveValuation.date,
    netWorth: liveInvestableValue,
    contributions: currentContributions,
    valuationStatus: liveValuation.date === todayKey
      ? 'LIVE' as const
      : liveValuation.coverage >= 0.999999
        ? 'SETTLED' as const
        : 'PARTIAL' as const,
    valuationCoverage: liveValuation.coverage,
    latestValuationDate: liveValuation.date,
    valuationGaps: [],
  }), [currentContributions, liveInvestableValue, liveValuation, todayKey])
  const liveDayReturn = useMemo(() => livePerformancePoint?.date === todayKey
    ? { date: todayKey, amount: totalPnl, pct: dayPct }
    : null, [dayPct, livePerformancePoint?.date, todayKey, totalPnl])

  const displayRows = useMemo(() => sortHoldings([
    ...rows.map((row) => ({ ...row, kind: 'market' as const, name: row.name, valueCny: row.valueCny })),
    ...staticRows.map((row) => ({ ...row, kind: 'static' as const, dayPnlCny: null })),
  ], sort), [rows, sort, staticRows])

  return (
    <div className="page-shell">
      <section className="hero-grid watch-hero">
        <div>
          <div className="eyebrow">今日涨跌（元）</div>
          <h1
            className={cx('num hero-number mt-4', totalPnl >= 0 ? 'text-up' : 'text-down')}
            data-testid="watch-today-pnl"
            data-amount={totalPnl.toFixed(2)}
          >
            {fmtCNY(totalPnl, { sign: true })}
          </h1>
          <div className={cx('num mt-4 text-[18px]', totalPnl >= 0 ? 'text-up' : 'text-down')}>
            {dayPct != null ? fmtPct(dayPct, { sign: true }) : '—'}
          </div>
          <p className="mt-6 text-[15px] text-ink-faint">{asOf ? `数据更新于 ${fmtDateTime(asOf)}` : '分钟级行情加载中…'}</p>
          <p className="mt-2 text-[13px] text-ink-faint">{marketStatus} · 今日口径 {todayKey}</p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-ink-faint">
            <span><ScopeLabel scope="PORTFOLIO_ASSETS_LIVE" /> <strong className="num ml-1 font-normal text-ink">{fmtCNY(totalValue)}</strong></span>
            <span>覆盖 <strong className="num ml-1 font-normal text-ink">{rows.length}</strong> 个标的</span>
            <span title="只有数据日为当天的标的才计入今日盈亏；未计入不等于零盈亏">
              今日盈亏已计入 <strong className="num ml-1 font-normal text-ink">{includedRows}</strong> 只 · 未计入 <strong className="num ml-1 font-normal text-ink">{excludedRows}</strong> 只
            </span>
            <span>{provider} · 30 秒刷新</span>
          </div>
        </div>
        <div className="chart-surface">
        {chartData.length > 1 ? (
          <IntradayChart data={chartData} />
        ) : (
          <div className="flex h-[260px] items-center justify-center text-xs text-ink-faint">
            {rows.length === 0 ? '暂无行情类持仓' : marketStatus === '休市' ? '休市 · 今日暂无分时行情' : '分时数据加载中…'}
          </div>
        )}
        </div>
      </section>

      <DataSettlementRail state={settlement} />

      <PortfolioHistory
        series={historySeries}
        livePoint={livePerformancePoint}
        liveDayReturn={liveDayReturn}
        benchmarks={benchmarks}
        initialPreset={defaultRange ?? undefined}
      />

      {/* 实时估值表 */}
      <Panel
        title="实时估值"
        en="LIVE VALUATION"
        bodyClassName="p-0"
      >
        <div className="border-b border-line px-4 py-2.5">
          <ValuationLegend />
        </div>
        <TableScroll label="看盘持仓实时估值表">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
              <th className="px-4 py-2.5 font-normal" aria-sort="other">
                <div className="flex items-center gap-2">
                  <span>资产</span>
                  <HoldingSortSelect value={sort} ariaLabel="看盘资产排序" navigate onChange={setSort} />
                </div>
              </th>
              <th className="px-2 py-2.5 text-right font-normal">数量</th>
              <th className="px-2 py-2.5 text-right font-normal">现价</th>
              <th className="px-2 py-2.5 text-right font-normal">涨跌幅</th>
              <th className="px-2 py-2.5 text-right font-normal">市值（¥）</th>
              <th className="px-2 py-2.5 text-right font-normal">当日盈亏（¥）</th>
              <th className="px-4 py-2.5 text-right font-normal">来源</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {displayRows.map((r) => r.kind === 'market' ? (
              <tr key={r.assetId} className="transition-colors hover:bg-panel2/50">
                <td className="px-4 py-2.5">
                  <Link href={`/positions/${r.assetId}`} className="text-ink transition-colors hover:text-accent">{r.name}</Link>
                  <div className="num text-[12px] text-ink-faint">{r.symbol}</div>
                </td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtQty(r.qty)}</td>
                <td className="num px-2 py-2.5 text-right text-ink">{r.price != null ? fmtMoney(r.price, r.currency) : '—'}</td>
                <td className={cx('num px-2 py-2.5 text-right', r.changePct == null ? 'text-ink-faint' : r.changePct >= 0 ? 'text-up' : 'text-down')}>
                  {r.changePct != null ? fmtPct(r.changePct, { sign: true }) : '—'}
                </td>
                <td className="num px-2 py-2.5 text-right text-ink">{fmtCNY(r.valueCny)}</td>
                <td className={cx('num px-2 py-2.5 text-right', r.dayPnlCny == null ? 'text-ink-faint' : r.dayPnlCny >= 0 ? 'text-up' : 'text-down')}>
                  {r.dayPnlCny != null ? fmtCNY(r.dayPnlCny, { sign: true }) : '—'}
                  {/* 数据日不是今天时必须说清楚：此时该行不计入今日盈亏（旧条件是
                      dayPnlCny != null && !currentPortfolioDay，互斥因而永远不显示） */}
                  {!r.currentPortfolioDay && (r.tradingDate || r.price == null) && (
                    <div className="mt-0.5 text-[12px] font-normal text-ink-faint">
                      {r.price == null
                        ? '无行情 · 不计入今日盈亏'
                        : `${r.cls === 'FUND' ? '净值日' : '行情日'} ${r.tradingDate} · 非当日不计入${r.changePct != null ? `（该日涨跌 ${fmtPct(r.changePct, { sign: true })}）` : ''}`}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.source ? (
                    <MarketSourceTag source={r.source} showProvider confidencePct={r.confidencePct} />
                  ) : (
                    <PositionSourceTag priceSource={r.priceSource} />
                  )}
                </td>
              </tr>
            ) : (
              <tr key={r.assetId ?? r.symbol} className="opacity-60 transition-colors hover:bg-panel2/50">
                <td className="px-4 py-2.5">
                  {r.assetId ? (
                    <Link href={`/positions/${r.assetId}`} className="text-ink-dim transition-colors hover:text-accent">{r.name}</Link>
                  ) : <span className="text-ink-dim">{r.name}</span>}
                  <div className="num text-[12px] text-ink-faint">{r.symbol}</div>
                </td>
                <td className="px-2 py-2.5" colSpan={3}>
                  <span className="text-[12px] text-ink-faint">{r.note}</span>
                </td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtCNY(r.valueCny)}</td>
                <td className="num px-2 py-2.5 text-right text-ink-faint">—</td>
                <td className="px-4 py-2.5 text-right">
                  {r.sourceLabel
                    ? <span className="text-[12px] text-ink-faint">{r.sourceLabel}</span>
                    : <PositionSourceTag priceSource={r.priceSource} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      </Panel>

      <p className="text-[13px] leading-relaxed text-ink-faint">
        当日曲线会同时纳入真实行情、基金盘中估值和静态资产；无可用分时线时按常量计入，每项实际口径见上表“来源”列。报价可能延迟，模拟数据不代表真实市场成交，盘中估值以官方净值为准。
      </p>
    </div>
  )
}
