'use client'

// 看盘客户端：30s 轮询分时数据与报价，合成当日组合收益曲线 + 实时估值表
import { useEffect, useMemo, useState } from 'react'
import { buildPortfolioCurve, type CurveHolding } from '@/lib/engine/intraday'
import { summarizeDailyPortfolio } from '@/lib/engine/daily-pnl'
import type { IntradaySeries } from '@/lib/market/intraday'
import { Panel, Tag } from './ui'
import { IntradayChart } from './charts'
import { cx, fmtCNY, fmtDateTime, fmtMoney, fmtPct, fmtQty } from '@/lib/format'

export interface WatchHolding {
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
}

export interface StaticRow {
  name: string
  valueCny: number
  note: string
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
}: {
  holdings: WatchHolding[]
  staticValueCny: number
  staticRows: StaticRow[]
  provider: string
}) {
  const [seriesMap, setSeriesMap] = useState<Map<string, IntradaySeries>>(new Map())
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map())
  const [asOf, setAsOf] = useState<string | null>(null)

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

  return (
    <div className="space-y-3">
      {/* 指标行 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">总市值（含现金/手动）</div>
          <div className="num mt-2 text-[26px] leading-none font-medium">{fmtCNY(totalValue)}</div>
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">当日盈亏</div>
          <div className={cx('num mt-2 text-[26px] leading-none font-medium', totalPnl >= 0 ? 'text-up' : 'text-down')}>
            {fmtCNY(totalPnl, { sign: true })}
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">{dayPct != null ? fmtPct(dayPct, { sign: true }) : '—'} · 相对昨收</div>
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">覆盖标的</div>
          <div className="num mt-2 text-[26px] leading-none font-medium">{rows.length}</div>
          <div className="mt-1 text-[11px] text-ink-faint">分时数据 {seriesMap.size} 个</div>
        </div>
        <div className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-xs text-ink-faint">数据刷新</div>
          <div className="num mt-2 text-[15px] leading-tight font-medium text-ink">{asOf ? fmtDateTime(asOf) : '加载中…'}</div>
          <div className="mt-1 text-[11px] text-ink-faint">每 30 秒 · {provider}</div>
        </div>
      </div>

      {/* 当日收益曲线 */}
      <Panel
        title="当日收益曲线"
        en="TODAY P&L"
        right={<span className="text-[10px] text-ink-faint">分钟级 · 相对昨收 · 曲线末点与顶部同口径</span>}
      >
        {chartData.length > 1 ? (
          <IntradayChart data={chartData} />
        ) : (
          <div className="flex h-24 items-center justify-center text-xs text-ink-faint">
            {rows.length === 0 ? '暂无行情类持仓' : '分时数据加载中…'}
          </div>
        )}
      </Panel>

      {/* 实时估值表 */}
      <Panel title="实时估值" en="LIVE VALUATION" bodyClassName="p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] tracking-wider text-ink-faint">
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
            {rows.map((r) => (
              <tr key={r.symbol} className="transition-colors hover:bg-panel2/50">
                <td className="px-4 py-2.5">
                  <div className="text-ink">{r.name}</div>
                  <div className="num text-[10px] text-ink-faint">{r.symbol}</div>
                </td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtQty(r.qty)}</td>
                <td className="num px-2 py-2.5 text-right text-ink">{r.price != null ? fmtMoney(r.price, r.currency) : '—'}</td>
                <td className={cx('num px-2 py-2.5 text-right', r.changePct == null ? 'text-ink-faint' : r.changePct >= 0 ? 'text-up' : 'text-down')}>
                  {r.changePct != null ? fmtPct(r.changePct, { sign: true }) : '—'}
                </td>
                <td className="num px-2 py-2.5 text-right text-ink">{r.valueCny != null ? fmtCNY(r.valueCny) : '—'}</td>
                <td className={cx('num px-2 py-2.5 text-right', r.dayPnlCny == null ? 'text-ink-faint' : r.dayPnlCny >= 0 ? 'text-up' : 'text-down')}>
                  {r.dayPnlCny != null ? fmtCNY(r.dayPnlCny, { sign: true }) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Tag tone={r.source && r.source !== 'SIMULATED' ? 'down' : 'dim'}>{r.source ?? '—'}</Tag>
                </td>
              </tr>
            ))}
            {staticRows.map((r) => (
              <tr key={r.name} className="opacity-60">
                <td className="px-4 py-2.5 text-ink-dim">{r.name}</td>
                <td className="px-2 py-2.5" colSpan={3}>
                  <span className="text-[10px] text-ink-faint">{r.note} · 无分时数据</span>
                </td>
                <td className="num px-2 py-2.5 text-right text-ink-dim">{fmtCNY(r.valueCny)}</td>
                <td className="num px-2 py-2.5 text-right text-ink-faint">—</td>
                <td className="px-4 py-2.5 text-right text-[10px] text-ink-faint">静态</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        A 股/ETF 分时来自腾讯分钟线，US/HK 来自 Yahoo
        分钟线；场外基金按盘中估值或已公布净值，无可用分时线时按常量计入；报价存在交易所固有延迟，仅供参考。
      </p>
    </div>
  )
}
