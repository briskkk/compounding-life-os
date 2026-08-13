'use client'

// 看盘客户端：30s 轮询分时数据与报价，合成当日组合收益曲线 + 实时估值表
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildPortfolioCurve, type CurveHolding } from '@/lib/engine/intraday'
import { summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import { sortHoldings, type HoldingSort } from '@/lib/engine/holding-sort'
import { dateKeyAt, isCurrentPortfolioDay, seriesPortfolioDate, seriesTradingDate } from '@/lib/engine/watch-market'
import type { IntradaySeries } from '@/lib/market/intraday'
import { Panel } from './ui'
import { IntradayChart } from './charts'
import { cx, fmtCNY, fmtDateTime, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import type { PriceSource } from '@/lib/engine/types'
import { MarketSourceTag, PositionSourceTag, ValuationLegend } from './valuation-source'
import { HoldingSortSelect } from './holding-sort-select'
import { PortfolioHistory } from './portfolio-history'
import type { PerformancePoint } from '@/lib/engine/period-performance'
import type { LoadedBenchmark } from '@/lib/engine/benchmark'

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
  assetId: string
  symbol: string
  name: string
  valueCny: number
  note: string
  priceSource: PriceSource
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
}) {
  const [seriesMap, setSeriesMap] = useState<Map<string, IntradaySeries>>(new Map())
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map())
  const [asOf, setAsOf] = useState<string | null>(null)
  const [sort, setSort] = useState<HoldingSort>(initialSort)
  const todayKey = dateKeyAt(new Date())

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
    const load = async () => {
      const primaryMarketSymbols = localMarketSymbols.length > 0 ? localMarketSymbols : overseasSymbols
      const secondaryMarketSymbols = localMarketSymbols.length > 0 ? overseasSymbols : []
      const fetchSeries = (requestedSymbols: string[]) => fetch(`/api/intraday?symbols=${requestedSymbols.join(',')}`, { cache: 'no-store' })
        .then((response) => response.json() as Promise<{ asOf: string; series: Record<string, IntradaySeries> }>)
      const mergeSeries = (data: { asOf: string; series: Record<string, IntradaySeries> }) => {
        if (!alive) return
        setSeriesMap((previous) => new Map([...previous, ...Object.entries(data.series)]))
        setAsOf(data.asOf)
      }
      const pricesRequest = fetch(`/api/prices?symbols=${symbols.join(',')}`, { cache: 'no-store' })
        .then((response) => response.json() as Promise<{ quotes: QuoteLite[] }>)
      const marketRequest = primaryMarketSymbols.length > 0
        ? fetchSeries(primaryMarketSymbols)
        : Promise.resolve(null)

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
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [fundSymbols, localMarketSymbols, overseasSymbols, symbols])

  // 实时估值表行：保留各交易所交易日，组合顶部另按北京时间当前看盘日筛选。
  const rows = useMemo(() => holdings.map((holding) => {
    const series = seriesMap.get(holding.symbol)
    const quote = quotes.get(holding.symbol)
    // /api/prices 的 price 为人民币展示口径；组合计算必须使用原币报价，再统一乘一次汇率。
    const quotePrice = quote?.rawPrice ?? (quote ? quote.price / holding.rateToCny : null)
    const quotePrevClose = quote?.rawPrevClose ?? (quote ? quote.prevClose / holding.rateToCny : null)
    const price = quotePrice ?? series?.points.at(-1)?.price ?? holding.price ?? null
    const prevClose = series?.prevClose ?? quotePrevClose ?? holding.prevClose ?? series?.points[0]?.price ?? null
    const changePct = price != null && prevClose ? price / prevClose - 1 : null
    const valueCny = price != null ? holding.qty * price * holding.rateToCny : holding.fallbackValueCny
    const dayPnlCny = price != null && prevClose != null ? holding.qty * (price - prevClose) * holding.rateToCny : null
    const tradingDate = quote?.tradingDate
      ?? seriesTradingDate(series, holding.currency, holding.cls)
      ?? holding.tradingDate
    const currentPortfolioDay = seriesPortfolioDate(series) === todayKey
      || isCurrentPortfolioDay(tradingDate, holding.currency, todayKey)
    return {
      ...holding,
      price,
      prevClose,
      changePct,
      valueCny,
      dayPnlCny,
      tradingDate,
      currentPortfolioDay,
      source: quote?.source ?? series?.source ?? holding.source ?? null,
      confidencePct: quote?.confidencePct ?? holding.confidencePct ?? null,
    }
  }), [holdings, quotes, seriesMap, todayKey])

  const { chartData, totalValue, totalPnl, dayPct, marketStatus } = useMemo(() => {
    const curveHoldings: CurveHolding[] = rows.map((holding) => ({
      symbol: holding.symbol,
      qty: holding.qty,
      rateToCny: holding.rateToCny,
      prevClose: holding.prevClose,
    }))
    const currentPrice = new Map(rows.map((row) => [row.symbol, row.price]))
    const activeSeries = [...seriesMap].filter(([, series]) => seriesPortfolioDate(series) === todayKey)
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

  const displayRows = useMemo(() => sortHoldings([
    ...rows.map((row) => ({ ...row, kind: 'market' as const, name: row.name, valueCny: row.valueCny })),
    ...staticRows.map((row) => ({ ...row, kind: 'static' as const, dayPnlCny: null })),
  ], sort), [rows, sort, staticRows])

  return (
    <div className="page-shell">
      <section className="hero-grid watch-hero">
        <div>
          <div className="eyebrow">今日涨跌（元）</div>
          <h1 className={cx('num hero-number mt-4', totalPnl >= 0 ? 'text-up' : 'text-down')}>
            {fmtCNY(totalPnl, { sign: true })}
          </h1>
          <div className={cx('num mt-4 text-[18px]', totalPnl >= 0 ? 'text-up' : 'text-down')}>
            {dayPct != null ? fmtPct(dayPct, { sign: true }) : '—'}
          </div>
          <p className="mt-6 text-[15px] text-ink-faint">{asOf ? `数据更新于 ${fmtDateTime(asOf)}` : '分钟级行情加载中…'}</p>
          <p className="mt-2 text-[13px] text-ink-faint">{marketStatus} · 今日口径 {todayKey}</p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-ink-faint">
            <span>组合总市值 <strong className="num ml-1 font-normal text-ink">{fmtCNY(totalValue)}</strong></span>
            <span>覆盖 <strong className="num ml-1 font-normal text-ink">{rows.length}</strong> 个标的</span>
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

      <PortfolioHistory
        series={historySeries}
        liveValue={liveInvestableValue}
        currentContributions={currentContributions}
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
        <div className="table-scroll">
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
                  {r.dayPnlCny != null && !r.currentPortfolioDay && (
                    <div className="mt-0.5 text-[12px] font-normal text-ink-faint">
                      交易日 {r.tradingDate ?? '未知'}
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
              <tr key={r.assetId} className="opacity-60 transition-colors hover:bg-panel2/50">
                <td className="px-4 py-2.5">
                  <Link href={`/positions/${r.assetId}`} className="text-ink-dim transition-colors hover:text-accent">{r.name}</Link>
                  <div className="num text-[12px] text-ink-faint">{r.symbol}</div>
                </td>
                <td className="px-2 py-2.5" colSpan={3}>
                  <span className="text-[12px] text-ink-faint">{r.note}</span>
                </td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtCNY(r.valueCny)}</td>
                <td className="num px-2 py-2.5 text-right text-ink-faint">—</td>
                <td className="px-4 py-2.5 text-right"><PositionSourceTag priceSource={r.priceSource} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>

      <p className="text-[13px] leading-relaxed text-ink-faint">
        当日曲线会同时纳入真实行情、基金盘中估值和静态资产；无可用分时线时按常量计入，每项实际口径见上表“来源”列。报价可能延迟，模拟数据不代表真实市场成交，盘中估值以官方净值为准。
      </p>
    </div>
  )
}
