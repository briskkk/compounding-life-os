'use client'

// 看盘客户端：30s 轮询分时数据与报价，合成当日组合收益曲线 + 实时估值表
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildPortfolioCurve, type CurveHolding } from '@/lib/engine/intraday'
import { summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import { sortHoldings, type HoldingSort } from '@/lib/engine/holding-sort'
import type { IntradaySeries } from '@/lib/market/intraday'
import { Panel } from './ui'
import { IntradayChart } from './charts'
import { cx, fmtCNY, fmtDateTime, fmtMoney, fmtPct, fmtQty } from '@/lib/format'
import type { PriceSource } from '@/lib/engine/types'
import { MarketSourceTag, PositionSourceTag, ValuationLegend } from './valuation-source'

export interface PeriodPerformance {
  label: string
  amount: number | null
  pct: number | null
}

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
  source: string | null
  fallbackValueCny: number
  priceSource: PriceSource
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
  rawPrice?: number
  rawPrevClose?: number
}

const POLL_MS = 30_000

export function WatchClient({
  holdings,
  staticValueCny,
  staticRows,
  provider,
  periods,
}: {
  holdings: WatchHolding[]
  staticValueCny: number
  staticRows: StaticRow[]
  provider: string
  periods: PeriodPerformance[]
}) {
  const [seriesMap, setSeriesMap] = useState<Map<string, IntradaySeries>>(new Map())
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map())
  const [asOf, setAsOf] = useState<string | null>(null)
  const [sort, setSort] = useState<HoldingSort>('value-desc')

  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings])

  useEffect(() => {
    if (symbols.length === 0) return
    let alive = true
    const load = async () => {
      try {
        const [intraRes, priceRes] = await Promise.all([
          fetch(`/api/intraday?symbols=${symbols.join(',')}`, { cache: 'no-store' }),
          fetch(`/api/prices?symbols=${symbols.join(',')}`, { cache: 'no-store' }),
        ])
        const intra = (await intraRes.json()) as { asOf: string; series: Record<string, IntradaySeries> }
        const prices = (await priceRes.json()) as { quotes: QuoteLite[] }
        if (!alive) return
        setSeriesMap(new Map(Object.entries(intra.series)))
        setQuotes(new Map(prices.quotes.map((q) => [q.symbol, q])))
        setAsOf(intra.asOf)
      } catch {
        /* 下一轮重试 */
      }
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [symbols])

  // 实时估值表行
  const rows = holdings.map((h) => {
    const series = seriesMap.get(h.symbol)
    const q = quotes.get(h.symbol)
    // /api/prices 的 price 为人民币展示口径；组合计算必须使用原币报价，再统一乘一次汇率。
    const quotePrice = q?.rawPrice ?? (q ? q.price / h.rateToCny : null)
    const quotePrevClose = q?.rawPrevClose ?? (q ? q.prevClose / h.rateToCny : null)
    const price = quotePrice ?? series?.points.at(-1)?.price ?? h.price ?? null
    const prevClose = series?.prevClose ?? quotePrevClose ?? h.prevClose ?? series?.points[0]?.price ?? null
    const changePct = price != null && prevClose ? price / prevClose - 1 : null
    const valueCny = price != null ? h.qty * price * h.rateToCny : h.fallbackValueCny
    const dayPnlCny = price != null && prevClose != null ? h.qty * (price - prevClose) * h.rateToCny : null
    return { ...h, price, prevClose, changePct, valueCny, dayPnlCny, source: q?.source ?? series?.source ?? h.source ?? null }
  })

  const curveHoldings: CurveHolding[] = rows.map((h) => ({
    symbol: h.symbol,
    qty: h.qty,
    rateToCny: h.rateToCny,
    prevClose: h.prevClose,
  }))
  const curveSeries = new Map(
    [...seriesMap].map(([symbol, series]) => {
      const points = series.points.map((p) => ({ ...p }))
      const current = rows.find((r) => r.symbol === symbol)?.price
      // 报价轮询可能比分时端点更新；用同一价格替换末点，使曲线末点与顶部/表格完全同口径。
      if (current != null && points.length > 0) points[points.length - 1].price = current
      return [symbol, points] as const
    }),
  )
  const quoteOnlyRows = rows.filter((r) => !seriesMap.has(r.symbol))
  const constantValueCny = staticValueCny + quoteOnlyRows.reduce((sum, row) => sum + row.valueCny, 0)
  const constantPnlCny = quoteOnlyRows.reduce((sum, row) => sum + (row.dayPnlCny ?? 0), 0)
  const curve = buildPortfolioCurve(curveHoldings, curveSeries, constantValueCny, constantPnlCny)

  const chartData = curve.map((p) => ({
    time: new Date(p.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    pnl: p.pnl,
    value: p.value,
  }))

  const lastPoint = curve.length > 0 ? curve[curve.length - 1] : null
  const rowSummary = summarizeDailyPortfolio(
    rows.map((row) => ({
      currentValueCny: row.valueCny,
      previousValueCny: row.dayPnlCny == null ? null : row.valueCny - row.dayPnlCny,
    })),
    staticValueCny,
  )
  const totalValue = lastPoint?.value ?? rowSummary.valueCny
  const totalPnl = lastPoint?.pnl ?? rowSummary.pnlCny
  const baseline = totalValue - totalPnl
  // 金额和百分比共用同一基线，避免顶部卡片内部出现两套口径。
  const dayPct = baseline > 0 ? totalPnl / baseline : null
  const displayRows = sortHoldings([
    ...rows.map((row) => ({ ...row, kind: 'market' as const, name: row.name, valueCny: row.valueCny })),
    ...staticRows.map((row) => ({ ...row, kind: 'static' as const, dayPnlCny: null })),
  ], sort)

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
            {rows.length === 0 ? '暂无行情类持仓' : '分时数据加载中…'}
          </div>
        )}
        </div>
      </section>

      <section className="performance-strip" aria-label="阶段收益">
        {periods.map((period) => {
          const value = period.amount ?? 0
          return (
            <div key={period.label}>
              <div className="text-[15px] text-ink-faint">{period.label}涨跌</div>
              <div className={cx('num mt-3 text-[26px]', period.amount == null ? 'text-ink-faint' : value >= 0 ? 'text-up' : 'text-down')}>
                {period.amount == null ? '—' : fmtCNY(period.amount, { sign: true })}
              </div>
              <div className={cx('num mt-2 text-[14px]', period.pct == null ? 'text-ink-faint' : (period.pct ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                {period.pct == null ? '历史数据不足' : fmtPct(period.pct, { sign: true })}
              </div>
            </div>
          )
        })}
      </section>

      <p className="-mt-6 text-[14px] text-ink-faint">阶段涨跌按净资产变化扣除同期净投入计算，口径与财富轨迹一致。</p>

      {/* 实时估值表 */}
      <Panel
        title="实时估值"
        en="LIVE VALUATION"
        bodyClassName="p-0"
        right={(
          <label className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            排序
            <select
              aria-label="看盘资产排序"
              value={sort}
              onChange={(event) => setSort(event.target.value as HoldingSort)}
              className="rounded border border-line bg-panel2 px-2 py-1 text-[12px] text-ink-dim outline-none"
            >
              <option value="value-desc">市值：从高到低</option>
              <option value="value-asc">市值：从低到高</option>
              <option value="dayPnl-desc">当日盈亏：从高到低</option>
              <option value="dayPnl-asc">当日盈亏：从低到高</option>
              <option value="name-asc">名称：拼音顺序</option>
            </select>
          </label>
        )}
      >
        <div className="border-b border-line px-4 py-2.5">
          <ValuationLegend />
        </div>
        <div className="table-scroll">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] tracking-wider text-ink-faint">
              <th className="px-4 py-2.5 font-normal">资产</th>
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
                  <Link href={`/positions/${r.assetId}`} className="text-ink transition-colors hover:text-gold">{r.name}</Link>
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
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.source ? <MarketSourceTag source={r.source} showProvider /> : <PositionSourceTag priceSource={r.priceSource} />}
                </td>
              </tr>
            ) : (
              <tr key={r.assetId} className="opacity-60 transition-colors hover:bg-panel2/50">
                <td className="px-4 py-2.5">
                  <Link href={`/positions/${r.assetId}`} className="text-ink-dim transition-colors hover:text-gold">{r.name}</Link>
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
