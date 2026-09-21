'use client'

// 看盘客户端：30s 轮询分时数据与报价，合成当日组合收益曲线 + 实时估值表
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { buildIntradayCurves, type CurveHolding } from '@/lib/engine/intraday'
import { dailyQuoteValuation, summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import {
  HOLDING_SORT_HEADERS,
  holdingAriaSort,
  holdingSortKey,
  parseHoldingSort,
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
import { MarketSourceTag, PositionSourceTag, ValuationLegend } from './valuation-source'
import { HoldingFilterBar, type HoldingFilterValue } from './holding-filter-bar'
import {
  WATCH_OTHER_CLASS,
  parseWatchClassFilter,
  type WatchClassFilter,
} from '@/lib/engine/watch-filter'
import { PortfolioHistory } from './portfolio-history'
import type { PerformancePoint } from '@/lib/engine/period-performance'
import type { LoadedBenchmark } from '@/lib/engine/benchmark'
import type { DataSettlementState } from '@/lib/engine/data-settlement'
import { DataSettlementRail } from './data-settlement-rail'
import { TableScroll } from './table-scroll'
import { SortHeader } from './sort-header'
import { attributionDateKey, liveQuoteAttribution } from '@/lib/engine/portfolio-day'

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

const SORT_HEADERS: { key: HoldingSortKey; label: string }[] = [
  { key: 'value', label: HOLDING_SORT_HEADERS.value },
  { key: 'changePct', label: HOLDING_SORT_HEADERS.changePct },
  { key: 'dayPnl', label: HOLDING_SORT_HEADERS.dayPnl },
]

export function WatchClient({
  holdings,
  staticValueCny,
  staticInvestableValueCny,
  staticRows,
  provider,
  historySeries,
  currentContributions,
  initialSort,
  initialQuery,
  initialClass,
  initialOnlyExcluded,
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
  initialQuery: string
  initialClass: WatchClassFilter
  initialOnlyExcluded: boolean
  defaultRange?: string | null
  benchmarks: LoadedBenchmark[]
  settlement: DataSettlementState
}) {
  const [seriesMap, setSeriesMap] = useState<Map<string, IntradaySeries>>(new Map())
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map())
  const [asOf, setAsOf] = useState<string | null>(null)
  const [sort, setSort] = useState<HoldingSort>(initialSort)
  const [query, setQuery] = useState(initialQuery)
  const [classFilter, setClassFilter] = useState<WatchClassFilter>(initialClass)
  const [onlyExcluded, setOnlyExcluded] = useState(initialOnlyExcluded)
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
    const nextSort = parseHoldingSort(searchParams.get('sort') ?? undefined)
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
    const asset = { symbol: holding.symbol, currency: holding.currency, cls: holding.cls }
    const { currentValueCny, previousValueCny, included } = dailyQuoteValuation({
      quantity: holding.qty,
      quote: price == null ? null : { price, prevClose, tradingDate },
      fallbackValueCny: holding.fallbackValueCny,
      // 归属口径统一按北京日（ADR-027）：美股美东 D 日计入北京 D+1
      asset,
      now,
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
      attributionDate: attributionDateKey(asset, tradingDate),
      currentPortfolioDay: included,
      source: quote?.source ?? series?.source ?? holding.source ?? null,
      confidencePct: quote?.confidencePct ?? holding.confidencePct ?? null,
    }
  }), [holdings, quotes, seriesMap, now])
  // 今日盈亏的计入范围：北京归属日属于实时窗口（今天 / 进行中的明天场次）且有报价的标的
  const includedRows = rows.filter((row) => row.currentPortfolioDay && row.dayPnlCny != null).length
  const excludedRows = rows.length - includedRows

  const { chartData, totalValue, totalPnl, dayPct, marketStatus, selectedPoints } = useMemo(() => {
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
      chartData: curve.map((point) => ({
        time: INTRADAY_TIME_FORMATTER.format(new Date(point.t)),
        pnl: point.pnl,
        value: point.value,
      })),
      totalValue: nextTotalValue,
      totalPnl: nextTotalPnl,
      dayPct: baseline > 0 ? nextTotalPnl / baseline : null,
      marketStatus: latestActivePoint === 0 ? '休市' : currentLag <= 10 * 60_000 ? '交易中' : '已收市',
      selectedPoints: curves.series,
    }
  }, [rows, seriesMap, staticValueCny, todayKey, now])

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
  const liveDayReturn = useMemo(() => livePerformancePoint == null
    ? null
    : { date: todayKey, amount: totalPnl, pct: dayPct }, [dayPct, livePerformancePoint, todayKey, totalPnl])

  // 表格行 = 有行情的标的 + 常量计值项（现金/手工估值/在途）。
  // 常量项没有行情，因此不参与涨跌幅与当日盈亏排序，恒沉底。
  const allRows = useMemo(() => [
    ...rows.map((row) => ({ ...row, kind: 'market' as const, sortable: true as const })),
    ...staticRows.map((row) => ({ ...row, kind: 'static' as const, sortable: false as const, changePct: null, dayPnlCny: null })),
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
      if (onlyExcluded && !(row.kind === 'market' && !row.currentPortfolioDay)) return false
      return true
    })
  }, [allRows, classFilter, onlyExcluded, query])

  const displayRows = useMemo(() => {
    const sortable = shownRows.filter((row) => row.sortable).map((row) => ({
      ...row,
      name: row.name,
      valueCny: row.valueCny,
      changePct: 'changePct' in row ? row.changePct : null,
      dayPnlCny: 'dayPnlCny' in row ? row.dayPnlCny : null,
    }))
    const pinned = shownRows.filter((row) => !row.sortable)
    return [...sortHoldings(sortable, sort), ...pinned]
  }, [shownRows, sort])

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
          <p className="mt-2 text-[13px] text-ink-faint">{marketStatus} · 北京归属口径 {todayKey}</p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-ink-faint">
            <span><ScopeLabel scope="PORTFOLIO_ASSETS_LIVE" /> <strong className="num ml-1 font-normal text-ink">{fmtCNY(totalValue)}</strong></span>
            <span>覆盖 <strong className="num ml-1 font-normal text-ink">{rows.length}</strong> 个标的</span>
            <span title="按北京归属日计入：归属北京今天的场次，以及北京晚间正在进行、归属北京明天的海外场次；未计入不等于零盈亏">
              今日盈亏已计入 <strong className="num ml-1 font-normal text-ink">{includedRows}</strong> 只 · 未计入 <strong className="num ml-1 font-normal text-ink">{excludedRows}</strong> 只
            </span>
            <span>{provider} · 30 秒刷新</span>
          </div>
        </div>
        <div className="chart-surface">
        {canCompareIntraday ? (
          <>
            {activeRow && (
              <div className="mb-2 flex items-center gap-2 text-[12px]" data-testid="watch-chart-asset" data-symbol={activeRow.symbol}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: (activeRow.dayPnlCny ?? 0) >= 0 ? 'var(--color-up)' : 'var(--color-down)' }} />
                <span className="text-ink-dim">
                  {activeRow.name} · 当日 {activeRow.dayPnlCny != null ? fmtCNY(activeRow.dayPnlCny, { sign: true }) : '无数据'}
                </span>
                {selectedSymbol === activeRow.symbol && (
                  <button
                    type="button"
                    onClick={() => setSelectedSymbol(null)}
                    className="text-ink-faint transition-colors hover:text-ink"
                  >
                    取消选中 ×
                  </button>
                )}
              </div>
            )}
            <IntradayChart data={chartPoints} assetName={activeRow?.name} showAsset={activeRow != null} />
          </>
        ) : (
          <div
            data-testid="watch-chart-empty"
            className="flex min-h-28 items-center justify-center border-y border-line text-xs text-ink-faint"
          >
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
        bodyClassName="p-0"
      >
        <div className="border-b border-line px-4 py-2.5">
          <ValuationLegend />
        </div>
        <HoldingFilterBar
          value={filterValue}
          classCounts={classCounts}
          matched={shownRows.length}
          total={allRows.length}
          onChange={applyFilter}
        />
        <TableScroll label="看盘持仓实时估值表（点列头排序，点行在曲线上叠加该标的）">
        <table className="w-full text-[14px]">
          <caption className="sr-only">实时估值明细</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
              <th scope="col" className="px-4 py-2.5 font-normal" aria-sort={holdingAriaSort(sort, 'name')}>
                <SortHeader label="资产" sortKey="name" sort={sort} onClick={() => applySort('name-asc')} />
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-normal">数量</th>
              <th scope="col" className="px-2 py-2.5 text-right font-normal">现价</th>
              {SORT_HEADERS.map((header) => (
                <th
                  key={header.key}
                  scope="col"
                  aria-sort={holdingAriaSort(sort, header.key)}
                  className={cx('px-2 py-2.5 text-right font-normal', header.key === 'value' && 'min-w-[7.5rem]')}
                >
                  <SortHeader
                    label={header.label}
                    sortKey={header.key}
                    sort={sort}
                    className="justify-end"
                    onClick={() => applySortKey(header.key)}
                  />
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-right font-normal">来源</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-ink-faint">
                  当前筛选下没有标的
                  {hasFilter && (
                    <button
                      type="button"
                      onClick={() => applyFilter({ query: '', classFilter: null, onlyExcluded: false })}
                      className="ml-3 text-ink-dim transition-colors hover:text-ink"
                    >
                      清除筛选
                    </button>
                  )}
                </td>
              </tr>
            )}
            {displayRows.map((r) => r.kind === 'market' ? (
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
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtQty(r.qty)}</td>
                <td className="num px-2 py-2.5 text-right text-ink">{r.price != null ? fmtMoney(r.price, r.currency) : '—'}</td>
                <td className={cx('num px-2 py-2.5 text-right', r.changePct == null ? 'text-ink-faint' : r.changePct >= 0 ? 'text-up' : 'text-down')}>
                  {r.changePct != null ? fmtPct(r.changePct, { sign: true }) : '—'}
                </td>
                <td className="num px-2 py-2.5 text-right text-ink">{fmtCNY(r.valueCny)}</td>
                <td className={cx('num px-2 py-2.5 text-right', r.dayPnlCny == null ? 'text-ink-faint' : r.dayPnlCny >= 0 ? 'text-up' : 'text-down')}>
                  {r.dayPnlCny != null ? fmtCNY(r.dayPnlCny, { sign: true }) : '—'}
                  {/* 归属日不是北京今天时必须说清楚：此时该行不计入今日盈亏（旧条件是
                      dayPnlCny != null && !currentPortfolioDay，互斥因而永远不显示） */}
                  {!r.currentPortfolioDay && (r.attributionDate || r.price == null) && (
                    <div className="mt-0.5 text-[12px] font-normal text-ink-faint">
                      {r.price == null
                        ? '无行情 · 不计入今日盈亏'
                        : `${r.cls === 'FUND' ? '净值日' : '行情归属日'} ${r.attributionDate} · 不计入今日盈亏${r.changePct != null ? `（该场涨跌 ${fmtPct(r.changePct, { sign: true })}）` : ''}`}
                    </div>
                  )}
                  {/* 北京晚间正在进行的海外场次归属北京明天：实时计入，但会落进明天那一格 */}
                  {r.currentPortfolioDay && r.attributionDate != null && r.attributionDate > todayKey && r.dayPnlCny != null && (
                    <div className="mt-0.5 text-[12px] font-normal text-ink-faint">
                      进行中场次 · 归属北京 {r.attributionDate}
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
