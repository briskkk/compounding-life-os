'use client'

// 看盘客户端：30s 轮询分时数据与报价，合成当日组合收益曲线 + 实时估值表
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { buildIntradayCurves, type CurveHolding } from '@/lib/engine/intraday'
import { dailyQuoteValuation, summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import type { DailyTradeActivity } from '@/lib/engine/daily-trades'
import {
  HOLDING_SORT_HEADERS,
  holdingAriaSort,
  sortHoldings,
  toggleHoldingSort,
  type HoldingSort,
  type HoldingSortKey,
} from '@/lib/engine/holding-sort'
import { dateKeyAt, seriesTradingDate, summarizeValuationDate } from '@/lib/engine/watch-market'
import type { IntradaySeries } from '@/lib/market/intraday'
import { Panel, ScopeLabel } from './ui'
import { IntradayChart } from './charts'
import { cx, fmtCNY, fmtDateTime, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import type { PriceSource } from '@/lib/engine/types'
import type { AssetClass } from '@prisma/client'
import { MarketSourceTag, PositionSourceTag } from './valuation-source'
import { HoldingFilterBar, type HoldingFilterValue } from './holding-filter-bar'
import {
  WATCH_OTHER_CLASS,
  parseWatchClassFilter,
  parseWatchSort,
  type WatchClassFilter,
} from '@/lib/engine/watch-filter'
import {
  performanceBetween,
  performancePresetRange,
  upsertPerformancePoint,
  type PerformancePoint,
} from '@/lib/engine/period-performance'
import { alignBenchmark, type LoadedBenchmark } from '@/lib/engine/benchmark'
import { riskMetrics } from '@/lib/engine/risk'
import { TableScroll } from './table-scroll'
import { SortHeader } from './sort-header'
import { attributionDateKey, liveQuoteAttribution } from '@/lib/engine/portfolio-day'
import { InvestmentDomainNav } from './investment-domain-nav'

export interface WatchHolding {
  assetId: string
  symbol: string
  name: string
  cls: string
  currency: string
  qty: number
  dailyActivities?: DailyTradeActivity[]
  rateToCny: number
  prevClose: number | null
  price: number | null
  tradingDate: string | null
  source: string | null
  fallbackValueCny: number
  costCny: number
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
  unrealizedPnlCny: number | null
  unrealizedPnlPct: number | null
  priceSource: PriceSource
  sourceLabel?: string
}

interface QuoteLite {
  symbol: string
  price: number
  prevClose: number
  source: string
  asOf: string
  tradingDate?: string
  rawPrice?: number
  rawPrevClose?: number
  confidencePct?: number
}

const POLL_MS = 30_000
const COLLAPSED_ROW_COUNT = 8
const INTRADAY_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

const SORT_HEADERS: { key: HoldingSortKey; label: string }[] = [
  { key: 'unrealizedPnl', label: HOLDING_SORT_HEADERS.unrealizedPnl },
  { key: 'value', label: HOLDING_SORT_HEADERS.value },
]

export function WatchClient({
  holdings,
  staticValueCny,
  staticInvestableValueCny,
  staticRows,
  historySeries,
  currentContributions,
  initialSort,
  initialQuery,
  initialClass,
  initialOnlyExcluded,
  benchmark,
  historyHasGap,
}: {
  holdings: WatchHolding[]
  staticValueCny: number
  staticInvestableValueCny: number
  staticRows: StaticRow[]
  historySeries: PerformancePoint[]
  currentContributions: number
  initialSort: HoldingSort
  initialQuery: string
  initialClass: WatchClassFilter
  initialOnlyExcluded: boolean
  benchmark: LoadedBenchmark | null
  historyHasGap: boolean
}) {
  const [seriesMap, setSeriesMap] = useState<Map<string, IntradaySeries>>(new Map())
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map())
  const [asOf, setAsOf] = useState<string | null>(null)
  const [sort, setSort] = useState<HoldingSort>(initialSort)
  const [query, setQuery] = useState(initialQuery)
  const [classFilter, setClassFilter] = useState<WatchClassFilter>(initialClass)
  const [onlyExcluded, setOnlyExcluded] = useState(initialOnlyExcluded)
  const [showAllRows, setShowAllRows] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  // 最近一次由本页写进 URL 的状态：用来区分「浏览器前进/后退」与「服务端重新渲染」，
  // 避免回退时覆盖用户当前输入，也避免无谓地把 URL 再写一遍。
  const navSyncRef = useRef(`${initialSort}|${initialQuery}|${initialClass ?? ''}|${initialOnlyExcluded}`)
  // 最近一次「本页写过 / 已应用到视图」的查询串：用来把 URL 变化与本地输入区分开
  const appliedUrlRef = useRef(`?${searchParams.toString()}`)
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

  /**
   * 把「显式给出」的排序/筛选写进 URL。
   *
   * 两条纪律（都来自踩过的坑）：
   * 1. 必须走 router.replace，不能用 window.history.replaceState——Next 的 useSearchParams
   *    不跟着裸 history 变化，下一次更新就会基于旧的查询串重建 URL。
   * 2. 只能基于**当前渲染的状态**构造（调用点把 state 一起传进来），不能用 useSearchParams /
   *    自己缓存的查询串：连续点击时它们可能还停在上一轮，导致「切到市值再点一次」算错方向。
   * 只同步视图状态，watch 页本身是 force-dynamic，重新渲染服务端组件代价可控。
   */
  function writeUrl(next: HoldingFilterValue, nextSort: HoldingSort) {
    const syncKey = `${nextSort}|${next.query}|${next.classFilter ?? ''}|${next.onlyExcluded}`
    if (syncKey === navSyncRef.current) return
    // 记成本页刚写过的一份：URL 变化触发的 effect 看到一致就不会再覆盖用户输入
    navSyncRef.current = syncKey
    const params = new URLSearchParams()
    if (nextSort !== 'value-desc') params.set('sort', nextSort)
    const trimmed = next.query.trim()
    if (trimmed) params.set('q', trimmed)
    if (next.classFilter) params.set('cls', next.classFilter)
    if (next.onlyExcluded) params.set('excl', '1')
    const search = params.toString()
    appliedUrlRef.current = search ? `?${search}` : ''
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
  }

  // URL → 视图状态：浏览器前进/后退，以及服务端按 URL 重新渲染后回填。
  // 本页刚写过的那一份（appliedUrlRef）跳过，避免覆盖用户正在输入的内容。
  useEffect(() => {
    const search = searchParams.toString()
    const nextQueryString = search ? `?${search}` : ''
    if (nextQueryString === appliedUrlRef.current) return
    appliedUrlRef.current = nextQueryString
    const nextSort = parseWatchSort(searchParams.get('sort') ?? undefined)
    const nextQuery = searchParams.get('q') ?? ''
    const nextClass = parseWatchClassFilter(searchParams.get('cls'))
    const nextExcluded = searchParams.get('excl') === '1'
    navSyncRef.current = `${nextSort}|${nextQuery}|${nextClass ?? ''}|${nextExcluded}`
    setSort(nextSort)
    setQuery(nextQuery)
    setClassFilter(nextClass)
    setOnlyExcluded(nextExcluded)
  }, [searchParams])

  // 实时估值表行：保留各交易所交易日，并单独标注北京归属日（ADR-027）。
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
    const dailyActivity = holding.dailyActivities?.find((activity) => activity.tradingDate === tradingDate)
    const asset = { symbol: holding.symbol, currency: holding.currency, cls: holding.cls }
    const { currentValueCny, previousValueCny, included } = dailyQuoteValuation({
      quantity: holding.qty,
      dailyActivity,
      quote: price == null ? null : { price, prevClose, tradingDate },
      fallbackValueCny: holding.fallbackValueCny,
      // 归属口径统一按北京日（ADR-027）：美股美东 D 日计入北京 D+1
      asset,
      now,
      rateToCny: holding.rateToCny,
    })
    const attributionDate = attributionDateKey(asset, tradingDate)
    let pnlNote: string | null = null
    if (price == null) pnlNote = '无报价'
    else if (attributionDate == null) pnlNote = '缺归属日'
    else if (!included) pnlNote = '未计入'
    else if (previousValueCny == null) pnlNote = '缺昨收'
    else if (attributionDate > todayKey) pnlNote = '进行中'

    const dayPnlCny = previousValueCny == null ? null : currentValueCny - previousValueCny
    const unrealizedPnlCny = currentValueCny - holding.costCny
    return {
      ...holding,
      dailyActivity,
      price,
      prevClose,
      valueCny: currentValueCny,
      dayPnlCny,
      dayPnlPct: dayPnlCny != null && previousValueCny != null && previousValueCny > 0
        ? dayPnlCny / previousValueCny : null,
      unrealizedPnlCny,
      unrealizedPnlPct: holding.costCny > 0 ? unrealizedPnlCny / holding.costCny : null,
      tradingDate,
      attributionDate,
      pnlNote,
      currentPortfolioDay: included,
      source: quote?.source ?? series?.source ?? holding.source ?? null,
      confidencePct: quote?.confidencePct ?? holding.confidencePct ?? null,
    }
  }), [holdings, quotes, seriesMap, now, todayKey])
  // 今日盈亏的计入范围：北京归属日属于实时窗口（今天 / 进行中的明天场次）且有报价的标的
  const excludedRows = rows.filter((row) => row.dayPnlCny == null).length
  // 日期录入使用默认时刻；有交易的分钟路径是估算，实时金额仍以账本为准。
  const hasDailyTrades = rows.some((row) => row.dailyActivity?.tradingDate === row.tradingDate)

  const { chartData, totalPnl, dayPct, marketStatus, selectedPoints } = useMemo(() => {
    const curveHoldings: CurveHolding[] = rows.map((holding) => ({
      symbol: holding.symbol,
      qty: holding.qty,
      rateToCny: holding.rateToCny,
      prevClose: holding.prevClose,
      trades: holding.dailyActivity?.trades,
    }))
    const currentPrice = new Map(rows.map((row) => [row.symbol, row.price]))
    const holdingBySymbol = new Map(rows.map((row) => [row.symbol, row]))
    const activeSeries = [...seriesMap].filter(([symbol, series]) => {
      const holding = holdingBySymbol.get(symbol)
      if (!holding) return false
      // 北京晚间正在进行的海外场次归属明天，但仍是实时曲线的一部分
      return liveQuoteAttribution({
        asset: { symbol: holding.symbol, currency: holding.currency, cls: holding.cls },
        exchangeTradingDate: seriesTradingDate(series, holding.currency, holding.cls),
        now,
      }).included
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
    // 逐标的序列一次算全，选中不同标的不再重算组合曲线（图中同一时刻只会画一条标的线）
    const curves = buildIntradayCurves(
      curveHoldings,
      curveSeries,
      constantValueCny,
      constantPnlCny,
      new Set(activeSymbols),
    )
    const curve = curves.curve
    const rowSummary = summarizeDailyPortfolio(
      rows.map((row) => ({
        currentValueCny: row.valueCny,
        previousValueCny: !row.currentPortfolioDay || row.dayPnlCny == null
          ? null
          : row.valueCny - row.dayPnlCny,
      })),
      staticValueCny,
    )
    const nextTotalValue = rowSummary.valueCny
    const nextTotalPnl = rowSummary.pnlCny
    const baseline = nextTotalValue - nextTotalPnl
    const latestActivePoint = activeSeries.reduce(
      (latest, [, series]) => Math.max(latest, series.points.at(-1)?.t ?? 0),
      0,
    )
    const currentLag = latestActivePoint > 0 ? Date.now() - latestActivePoint : Number.POSITIVE_INFINITY
    return {
      chartData: curve.map((point) => ({
        time: INTRADAY_TIME_FORMATTER.format(new Date(point.t)),
        pnl: point.pnl,
        value: point.value,
      })),
      totalPnl: nextTotalPnl,
      dayPct: baseline > 0 ? nextTotalPnl / baseline : null,
      marketStatus: latestActivePoint === 0 ? '休市' : currentLag <= 10 * 60_000 ? '交易中' : '已收市',
      selectedPoints: curves.series,
    }
  }, [rows, seriesMap, staticValueCny, todayKey, now, hasDailyTrades])

  // 表格行 ↔ 当日曲线联动：悬停预览、点击（或 Enter/空格）钉住，再点一次取消。
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const activeSymbol = hoveredSymbol ?? selectedSymbol
  const activeRow = activeSymbol == null ? null : rows.find((row) => row.symbol === activeSymbol) ?? null
  const chartPoints = useMemo(() => {
    const points = selectedPoints.get(activeSymbol ?? '')
    if (activeRow == null || points == null) return chartData
    // 组合曲线与标的序列共用同一条时间轴、同样长度，按索引一一对齐
    return chartData.map((point, index) => ({ ...point, assetPnl: points[index]?.pnl ?? null }))
  }, [activeRow, activeSymbol, chartData, selectedPoints])

  const liveInvestableValue = useMemo(
    () => rows.reduce((sum, row) => sum + row.valueCny, 0) + staticInvestableValueCny,
    [rows, staticInvestableValueCny],
  )
  // 估值日按北京归属日聚合：同一格里既有 A 股当日场次，也有归属当天的美股场次。
  // 存在归属北京明天的进行中场次时（北京晚间 21:30 后），实时点不落格，
  // 否则会把明天的场次提前写进今天的财富轨迹与日历。
  const liveValuation = useMemo(
    () => summarizeValuationDate(rows.map((row) => ({ tradingDate: row.attributionDate, valueCny: row.valueCny }))),
    [rows],
  )
  const livePerformancePoint = useMemo(() => liveValuation == null || liveValuation.date !== todayKey ? null : ({
    date: liveValuation.date,
    netWorth: liveInvestableValue,
    contributions: currentContributions,
    valuationStatus: liveValuation.coverage >= 0.999999 ? 'LIVE' as const : 'PARTIAL' as const,
    valuationCoverage: liveValuation.coverage,
    latestValuationDate: liveValuation.date,
    valuationGaps: [],
  }), [currentContributions, liveInvestableValue, liveValuation, todayKey])

  const historySummary = useMemo(() => {
    const series = upsertPerformancePoint(historySeries, livePerformancePoint)
    const range = performancePresetRange('LAST_30_DAYS', new Date(`${todayKey}T12:00:00+08:00`), series[0]?.date)
    const performance = performanceBetween(series, range.startDate, range.endDate, range.label)
    const risk = riskMetrics(performance.curve)
    const benchmarkCurve = benchmark
      ? alignBenchmark(performance.curve.map((point) => point.date), benchmark.points)
      : []
    const validBenchmark = benchmarkCurve.filter((value): value is number => value != null)
    return {
      performance,
      maxDrawdown: risk.maxDrawdown,
      benchmarkPct: validBenchmark.length > 1 ? validBenchmark.at(-1) ?? null : null,
    }
  }, [benchmark, historySeries, livePerformancePoint, todayKey])

  // 表格行 = 有行情的标的 + 常量计值项（现金/手工估值/在途）。
  // 常量计值项固定列在行情标的之后。
  const allRows = useMemo(() => [
    ...rows.map((row) => ({ ...row, kind: 'market' as const, sortable: true as const })),
    ...staticRows.map((row) => ({ ...row, kind: 'static' as const, sortable: false as const })),
  ], [rows, staticRows])

  const shownRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allRows.filter((row) => {
      if (needle && !`${row.name} ${row.symbol}`.toLowerCase().includes(needle)) return false
      if (classFilter) {
        // 常量计值项（现金/房产/在途）没有资产大类，统一归入「其他」
        const bucket: WatchClassFilter = row.kind === 'market' ? row.cls as WatchClassFilter : WATCH_OTHER_CLASS
        if (bucket !== classFilter) return false
      }
      if (onlyExcluded && !(row.kind === 'market' && row.dayPnlCny == null)) return false
      return true
    })
  }, [allRows, classFilter, onlyExcluded, query])

  const displayRows = useMemo(() => {
    const sortable = shownRows.filter((row) => row.sortable)
    const pinned = shownRows.filter((row) => !row.sortable)
    return [...sortHoldings(sortable, sort), ...pinned]
  }, [shownRows, sort])

  const dailyLeaders = useMemo(() => {
    let best: (typeof rows)[number] | null = null
    let worst: (typeof rows)[number] | null = null
    for (const row of rows) {
      if (!row.currentPortfolioDay || row.dayPnlCny == null) continue
      if (best == null || row.dayPnlCny > (best.dayPnlCny ?? Number.NEGATIVE_INFINITY)) best = row
      if (worst == null || row.dayPnlCny < (worst.dayPnlCny ?? Number.POSITIVE_INFINITY)) worst = row
    }
    return { best, worst }
  }, [rows])

  const classCounts = useMemo(() => {
    const counts = new Map<WatchClassFilter, number>()
    for (const row of rows) counts.set(row.cls as WatchClassFilter, (counts.get(row.cls as WatchClassFilter) ?? 0) + 1)
    const other = staticRows.length
    if (other > 0) counts.set(WATCH_OTHER_CLASS, other)
    return counts
  }, [rows, staticRows])

  const hasFilter = query.trim() !== '' || classFilter != null || onlyExcluded
  const filterValue: HoldingFilterValue = { query, classFilter, onlyExcluded }
  const canCompareIntraday = chartData.length > 1
  const pnlTone = totalPnl >= 0 ? 'text-up' : 'text-down'
  const tableRows = hasFilter || showAllRows ? displayRows : displayRows.slice(0, COLLAPSED_ROW_COUNT)
  const hiddenRowCount = displayRows.length - tableRows.length

  function applyFilter(next: HoldingFilterValue) {
    setQuery(next.query)
    setClassFilter(next.classFilter)
    setOnlyExcluded(next.onlyExcluded)
    writeUrl(next, sort)
  }

  /** 列头点击：基于当前状态算下一档，避免用可能滞后的 state 再算一次。 */
  function applySortKey(key: HoldingSortKey) {
    applySort(toggleHoldingSort(sort, key))
  }

  function applySort(next: HoldingSort) {
    setSort(next)
    writeUrl({ query, classFilter, onlyExcluded }, next)
  }

  return (
    <div className="page-shell watch-workbench">
      <header className="watch-workbench-header">
        <h1 className="page-title">看盘</h1>
        <InvestmentDomainNav active="today" />
      </header>

      <section className="watch-monitor-grid" aria-labelledby="watch-today-title">
        <div className="watch-chart-panel">
          <div className="watch-panel-heading">
            <h2 id="watch-today-title">组合当日盈亏</h2>
            <span>北京归属日 <time dateTime={todayKey}>{todayKey}</time></span>
          </div>
          <div className="watch-workbench-result">
            <strong className={cx('num', pnlTone)} data-testid="watch-today-pnl" data-amount={totalPnl.toFixed(2)}>
              {fmtCNY(totalPnl, { sign: true })}
            </strong>
            <span className={cx('num', dayPct == null ? 'text-ink-faint' : pnlTone)}>
              {fmtPct(dayPct, { sign: true })}
            </span>
          </div>
          <div className="watch-chart-evidence">
            {asOf && <span>更新于 {fmtDateTime(asOf)}</span>}
            {excludedRows > 0 && (
              <a href="#watch-valuation" className="watch-pnl-note">{excludedRows} 项未计入今日盈亏 →</a>
            )}
            {hasDailyTrades && <span>曲线按成交时间估算 · 盈亏含账本费用</span>}
          </div>
          <div className="watch-chart">
            {canCompareIntraday ? (
              <>
                <IntradayChart data={chartPoints} assetName={activeRow?.name} showAsset={activeRow != null} estimated={hasDailyTrades} />
                {/* 预览与提示共用一行，悬停时保持图表高度不变。 */}
                <div className="watch-chart-legend">
                  {activeRow ? (
                    <div className="watch-chart-selection" data-testid="watch-chart-asset" data-symbol={activeRow.symbol}>
                      <span className="truncate" title={activeRow.name}>
                        {activeRow.name} · 当日 {activeRow.dayPnlCny != null ? fmtCNY(activeRow.dayPnlCny, { sign: true }) : '无数据'}
                      </span>
                      {selectedSymbol === activeRow.symbol && (
                        <button type="button" onClick={() => setSelectedSymbol(null)} className="text-ink-faint transition-colors hover:text-ink">
                          取消选中 ×
                        </button>
                      )}
                    </div>
                  ) : <span>点选下方持仓叠加曲线</span>}
                </div>
              </>
            ) : (
              <div data-testid="watch-chart-empty" className="flex min-h-28 items-center justify-center text-xs text-ink-faint">
                {rows.length === 0 ? '暂无行情类持仓' : marketStatus === '休市' ? '休市 · 今日暂无分时行情' : '分时数据加载中…'}
              </div>
            )}
          </div>
        </div>

        <div className="watch-context">
          <aside className="watch-attention" aria-labelledby="watch-attention-title">
            <div className="watch-panel-heading">
              <h2 id="watch-attention-title">今天需要留意</h2>
              <Link href="/review?period=THIS_MONTH">复盘本月 →</Link>
            </div>
            {dailyLeaders.best ? (
              <div className="watch-attention-item">
                <span>贡献最多</span>
                <strong>{dailyLeaders.best.name}</strong>
                <b className={cx('num', (dailyLeaders.best.dayPnlCny ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                  {fmtCNY(dailyLeaders.best.dayPnlCny ?? 0, { sign: true })}
                </b>
              </div>
            ) : <p className="watch-attention-empty">今日暂无可比较的持仓贡献。</p>}
            {dailyLeaders.worst && (dailyLeaders.worst.dayPnlCny ?? 0) < 0 && (
              <div className="watch-attention-item">
                <span>拖累最多</span>
                <strong>{dailyLeaders.worst.name}</strong>
                <b className="num text-down">{fmtCNY(dailyLeaders.worst.dayPnlCny ?? 0, { sign: true })}</b>
              </div>
            )}
          </aside>
          <section className="watch-history-snapshot" aria-labelledby="watch-history-title">
            <div className="watch-panel-heading">
              <h2 id="watch-history-title">近 30 日表现</h2>
              <Link href="/review/returns">打开收益历史 →</Link>
            </div>
            <p>{historySummary.performance.startDate ?? '—'} — {historySummary.performance.endDate ?? '—'}</p>
            {historyHasGap && <Link href="/health" className="text-xs text-amber">历史收盘数据有缺口 →</Link>}
            <div className="watch-history-metrics">
              <div>
                <span>组合 TWR</span>
                <strong className={cx('num', historySummary.performance.pct == null ? 'text-ink-faint' : historySummary.performance.pct >= 0 ? 'text-up' : 'text-down')}>
                  {fmtPct(historySummary.performance.pct, { sign: true })}
                </strong>
              </div>
              <div>
                <span>同期{benchmark?.label ?? '基准'}</span>
                <strong className={cx('num', historySummary.benchmarkPct == null ? 'text-ink-faint' : historySummary.benchmarkPct >= 0 ? 'text-up' : 'text-down')}>
                  {fmtPct(historySummary.benchmarkPct, { sign: true })}
                </strong>
              </div>
              <div>
                <span>最大回撤</span>
                <strong className={cx('num', historySummary.maxDrawdown == null ? 'text-ink-faint' : 'text-down')}>
                  {fmtPct(historySummary.maxDrawdown)}
                </strong>
              </div>
            </div>
          </section>
        </div>
      </section>

      <Panel
        title="实时估值"
        id="watch-valuation"
        bodyClassName="p-0"
        right={<span className="text-right text-xs text-ink-dim">可投资组合 <b className="num">{fmtCNY(liveInvestableValue)}</b></span>}
      >
        <HoldingFilterBar value={filterValue} classCounts={classCounts} matched={shownRows.length} total={allRows.length} onChange={applyFilter} />
        <TableScroll label="看盘持仓实时估值表（点列头排序，点行在曲线上叠加该标的）">
          <table className="watch-valuation-table" data-testid="watch-valuation-table">
            <caption className="sr-only">实时估值明细</caption>
            <thead>
              <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
                <th scope="col" className="px-4 py-2.5 font-normal" aria-sort={holdingAriaSort(sort, 'name')}>
                  <SortHeader label="资产" sortKey="name" sort={sort} onClick={() => applySort('name-asc')} />
                </th>
                <th scope="col" aria-sort={holdingAriaSort(sort, 'dayPnl')} className="px-2 py-2.5 text-right font-normal">
                  <SortHeader label={HOLDING_SORT_HEADERS.dayPnl} sortKey="dayPnl" sort={sort} className="justify-end" onClick={() => applySortKey('dayPnl')} />
                </th>
                {SORT_HEADERS.map((header) => (
                  <th key={header.key} scope="col" aria-sort={holdingAriaSort(sort, header.key)} className="px-2 py-2.5 text-right font-normal">
                    <SortHeader label={header.label} sortKey={header.key} sort={sort} className="justify-end" onClick={() => applySortKey(header.key)} />
                  </th>
                ))}
                <th scope="col" className="px-2 py-2.5 text-right font-normal">数量</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">现价</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">昨收</th>
                <th scope="col" className="px-2 py-2.5 text-right font-normal">行情归属日</th>
                <th scope="col" className="px-4 py-2.5 text-right font-normal">来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                    当前筛选下没有标的
                    {hasFilter && <button type="button" onClick={() => applyFilter({ query: '', classFilter: null, onlyExcluded: false })} className="ml-3 text-ink-dim transition-colors hover:text-ink">清除筛选</button>}
                  </td>
                </tr>
              )}
              {tableRows.map((r) => r.kind === 'market' ? (
              <tr
                key={r.assetId}
                data-testid="watch-row"
                data-symbol={r.symbol}
                aria-selected={selectedSymbol === r.symbol}
                data-chart-enabled={canCompareIntraday ? 'true' : 'false'}
                className={cx(
                  'transition-colors hover:bg-panel2/50',
                  canCompareIntraday ? 'cursor-pointer' : 'cursor-default',
                  activeSymbol === r.symbol && 'watch-row-active',
                )}
                onMouseEnter={() => { if (canCompareIntraday) setHoveredSymbol(r.symbol) }}
                onMouseLeave={() => setHoveredSymbol((current) => (current === r.symbol ? null : current))}
                onClick={() => { if (canCompareIntraday) setSelectedSymbol((current) => (current === r.symbol ? null : r.symbol)) }}
                onKeyDown={(event) => {
                  if (!canCompareIntraday) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedSymbol((current) => (current === r.symbol ? null : r.symbol))
                  }
                }}
                tabIndex={canCompareIntraday ? 0 : -1}
                title={canCompareIntraday ? '点击在曲线上叠加该标的当日盈亏，再点一次取消' : '今日没有可对比的分时曲线'}
              >
                <td className="px-4 py-2.5">
                  {/* 资产名仍是详情入口：点链接只跳转，不触发整行的曲线联动 */}
                  <Link
                    href={`/positions/${r.assetId}`}
                    onClick={(event) => event.stopPropagation()}
                    className="text-ink transition-colors hover:text-accent"
                  >
                    {r.name}
                  </Link>
                  <div className="num text-[12px] text-ink-faint">{r.symbol}</div>
                </td>
                <td className={cx('watch-pnl-cell num px-2 py-2.5 text-right', r.dayPnlCny == null ? 'text-ink-faint' : r.dayPnlCny >= 0 ? 'text-up' : 'text-down')}>
                  {r.dayPnlCny != null ? fmtCNY(r.dayPnlCny, { sign: true }) : '—'}
                  {r.dayPnlPct != null && <div className="text-xs font-normal opacity-80">{fmtPct(r.dayPnlPct, { sign: true })}</div>}
                </td>
                <td className={cx('num px-2 py-2.5 text-right', r.unrealizedPnlCny >= 0 ? 'text-up' : 'text-down')}>
                  {fmtCNY(r.unrealizedPnlCny, { sign: true })}
                  {r.unrealizedPnlPct != null && <div className="text-xs opacity-80">{fmtPct(r.unrealizedPnlPct, { sign: true })}</div>}
                </td>
                <td className="num px-2 py-2.5 text-right text-ink">{fmtCNY(r.valueCny)}</td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtQty(r.qty)}</td>
                <td className="num px-2 py-2.5 text-right">{r.price != null ? fmtMoney(r.price, r.currency) : '—'}</td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{r.prevClose != null ? fmtMoney(r.prevClose, r.currency) : '—'}</td>
                <td className="px-2 py-2.5 text-right text-xs text-ink-dim">
                  {r.attributionDate ? <time dateTime={r.attributionDate}>{r.attributionDate}</time> : '—'}
                  {r.pnlNote && <span className="block text-ink-faint">{r.pnlNote}</span>}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.source ? (
                    <MarketSourceTag source={r.source} confidencePct={r.confidencePct} />
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
                <td className="num px-2 py-2.5 text-right text-ink-faint">—</td>
                <td className={cx('num px-2 py-2.5 text-right', r.unrealizedPnlCny == null ? 'text-ink-faint' : r.unrealizedPnlCny >= 0 ? 'text-up' : 'text-down')}>
                  {r.unrealizedPnlCny != null ? fmtCNY(r.unrealizedPnlCny, { sign: true }) : '—'}
                  {r.unrealizedPnlPct != null && <div className="text-xs opacity-80">{fmtPct(r.unrealizedPnlPct, { sign: true })}</div>}
                </td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtCNY(r.valueCny)}</td>
                <td className="px-2 py-2.5 text-right" colSpan={4}>
                  <span className="text-[12px] text-ink-faint">{r.note}</span>
                </td>
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
        <div className="watch-table-foot">
          <span className="num">共 {displayRows.length} 项{hiddenRowCount > 0 ? ` · 当前显示 ${tableRows.length} 项` : ''}</span>
          <div>
            {!hasFilter && displayRows.length > COLLAPSED_ROW_COUNT && (
              <button type="button" aria-expanded={showAllRows} onClick={() => setShowAllRows((expanded) => !expanded)}>
                {showAllRows ? '收起列表' : `展开全部 ${displayRows.length} 项`}
              </button>
            )}
            <Link href="/positions">打开完整持仓 →</Link>
          </div>
        </div>
      </Panel>
    </div>
  )
}
