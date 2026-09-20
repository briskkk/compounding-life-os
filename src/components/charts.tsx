'use client'

// 图表组件（recharts，深色终端主题）
import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { C } from '@/lib/colors'
import { fmtCNY, fmtPrice, fmtQty } from '@/lib/format'
import { niceTicks } from '@/lib/engine/axis-ticks'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Y 轴格式化：万/亿以上缩写；<10 按净值惯例 4 位小数；其余 2 位小数 */
function fmtAxis(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(v / 1e4).toFixed(0)}万`
  if (abs < 10) return v.toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function DarkTooltip({ active, payload, label, money = true }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      {label != null && <div className="num mb-1 text-ink-faint">{label}</div>}
      {payload
        .filter((p: any) => !p.payload?.__bandBase)
        .map((p: any, i: number) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color ?? p.stroke ?? C.accent }} />
            <span className="text-ink-dim">{p.name}</span>
            <span className="num ml-auto pl-3 text-ink">{money ? fmtCNY(Number(p.value)) : fmtPrice(Number(p.value))}</span>
          </div>
        ))}
    </div>
  )
}

export interface WealthPoint {
  date: string
  netWorth: number
  investable: number
  contributions: number
}

type WealthRange = '3M' | '1Y' | 'ALL'

const WEALTH_RANGES: { key: WealthRange; months: number | null }[] = [
  { key: '3M', months: 3 },
  { key: '1Y', months: 12 },
  { key: 'ALL', months: null },
]

export function WealthChart({
  data,
  showRange = false,
  height = 340,
}: {
  data: WealthPoint[]
  showRange?: boolean
  height?: number
}) {
  const [range, setRange] = useState<WealthRange>('1Y')
  const ranged = useMemo(() => {
    const months = WEALTH_RANGES.find((r) => r.key === range)?.months ?? null
    if (months == null || data.length < 2) return data
    const cutoff = new Date(`${data[data.length - 1].date}T00:00:00`)
    cutoff.setMonth(cutoff.getMonth() - months)
    const result = data.filter((point) => new Date(`${point.date}T00:00:00`) >= cutoff)
    return result.length >= 2 ? result : data
  }, [data, range])
  // 纵轴域：数据极值上下留 12% 余量，避免 0.1% 的波动被画成陡坡。
  // 空数据/all-equal 时用兜底 span，保证 domain 永远有限且非零跨度（否则 min/max 会退化为 ±Infinity/NaN）。
  const values = ranged.map((point) => point.netWorth)
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 0
  const spread = max - min || Math.abs(max) * 0.02 || 1
  const domain: [number, number] = [min - spread * 0.12, max + spread * 0.12]
  // 显式刻度：窄区间下 recharts 自动刻度经 fmtCNYAxis 格式化后会重名
  const ticks = niceTicks(domain[0], domain[1])
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={ranged} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="gNW" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.info} stopOpacity={0.18} />
              <stop offset="100%" stopColor={C.info} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: C.inkFaint, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={80}
          />
          <YAxis
            width={56}
            tick={{ fill: C.inkFaint, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            domain={domain}
            ticks={ticks}
            tickFormatter={fmtCNYAxis}
          />
          <Tooltip content={<DarkTooltip />} />
          <Area type="monotone" dataKey="netWorth" name="净资产" stroke={C.info} strokeWidth={2.25} fill="url(#gNW)" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {ranged.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-faint">纵轴刻度 {fmtCNYAxis(domain[0])} – {fmtCNYAxis(domain[1])}（非零起点）</p>
      )}
      {showRange && (
        <div className="mt-5 flex justify-end gap-3 text-[15px]" role="group" aria-label="财富轨迹区间">
          {WEALTH_RANGES.map(({ key }) => (
            <button
              key={key}
              type="button"
              aria-pressed={range === key}
              onClick={() => setRange(key)}
              className={range === key ? 'rounded-lg bg-accent px-3 py-2 text-bg' : 'rounded-lg px-3 py-2 text-ink-faint transition-colors hover:text-ink'}
            >
              {key}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface PortfolioReturnDatum {
  date: string
  pct: number
  amount: number
  netWorth: number
  mwrPct?: number | null
  benchPct?: number | null
}

function fmtCNYAxis(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e8) return `${sign}¥${(abs / 1e8).toFixed(1)}亿`
  if (abs >= 1e4) return `${sign}¥${(abs / 1e4).toFixed(0)}万`
  return `${sign}¥${abs.toFixed(0)}`
}

function PortfolioReturnTooltip({ active, payload, label, benchmarkLabel = '基准' }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as PortfolioReturnDatum
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      <div className="num mb-1 text-ink-faint">{label}</div>
      <div className="flex items-center gap-4 py-0.5">
        <span className="text-ink-dim">累计收益率</span>
        <span className="num ml-auto text-ink">{point.pct >= 0 ? '+' : ''}{(point.pct * 100).toFixed(2)}%</span>
      </div>
      {point.benchPct != null && (
        <div className="flex items-center gap-4 py-0.5">
          <span className="text-ink-dim">{benchmarkLabel}基准</span>
          <span className="num ml-auto text-violet">{point.benchPct >= 0 ? '+' : ''}{(point.benchPct * 100).toFixed(2)}%</span>
        </div>
      )}
      <div className="flex items-center gap-4 py-0.5">
        <span className="text-ink-dim">累计收益金额</span>
        <span className="num ml-auto text-ink">{fmtCNY(point.amount, { sign: true })}</span>
      </div>
      <div className="flex items-center gap-4 py-0.5">
        <span className="text-ink-dim">可投资资产</span>
        <span className="num ml-auto text-ink">{fmtCNY(point.netWorth)}</span>
      </div>
    </div>
  )
}

/** 任意区间的累计时间加权收益率与扣除净投入后的累计收益金额曲线。 */
export function PortfolioReturnChart({ data, benchmarkLabel = '基准' }: { data: PortfolioReturnDatum[]; benchmarkLabel?: string }) {
  // 显式刻度：窄区间下 recharts 自动刻度格式化后会重名
  let pctLo = 0
  let pctHi = 0
  let amtLo = 0
  let amtHi = 0
  for (const d of data) {
    if (d.pct < pctLo) pctLo = d.pct
    if (d.pct > pctHi) pctHi = d.pct
    if (d.benchPct != null) {
      if (d.benchPct < pctLo) pctLo = d.benchPct
      if (d.benchPct > pctHi) pctHi = d.benchPct
    }
    if (d.amount < amtLo) amtLo = d.amount
    if (d.amount > amtHi) amtHi = d.amount
  }
  const pctTicks = niceTicks(pctLo, pctHi)
  const amtTicks = niceTicks(amtLo, amtHi)
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gPortfolioReturn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.info} stopOpacity={0.18} />
            <stop offset="100%" stopColor={C.info} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.line} strokeDasharray="2 8" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={64}
        />
        <YAxis
          yAxisId="rate"
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={54}
          domain={['auto', 'auto']}
          ticks={pctTicks}
          tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
        />
        <YAxis
          yAxisId="amount"
          orientation="right"
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={72}
          domain={['auto', 'auto']}
          ticks={amtTicks}
          tickFormatter={fmtCNYAxis}
        />
        <Tooltip content={<PortfolioReturnTooltip benchmarkLabel={benchmarkLabel} />} />
        <ReferenceLine yAxisId="rate" y={0} stroke={C.inkFaint} strokeDasharray="4 7" />
        <Area
          yAxisId="rate"
          type="monotone"
          dataKey="pct"
          name="累计收益率"
          stroke={C.info}
          strokeWidth={2.25}
          fill="url(#gPortfolioReturn)"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="amount"
          type="monotone"
          dataKey="amount"
          name="累计收益金额"
          stroke={C.amber}
          strokeWidth={1.75}
          strokeDasharray="7 5"
          dot={false}
          isAnimationActive={false}
        />
        {data.some((d) => d.benchPct != null) && (
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="benchPct"
            name={`${benchmarkLabel}基准`}
            stroke={C.violet}
            strokeWidth={1.5}
            strokeDasharray="2 6"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function PortfolioPctTooltip({ active, payload, label, benchmarkLabel = '基准' }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as PortfolioReturnDatum
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      <div className="num mb-1 text-ink-faint">{label}</div>
      <div className="flex items-center gap-4 py-0.5">
        <span className="text-ink-dim">时间加权收益率</span>
        <span className="num ml-auto text-ink">{point.pct >= 0 ? '+' : ''}{(point.pct * 100).toFixed(2)}%</span>
      </div>
      {point.mwrPct != null && (
        <div className="flex items-center gap-4 py-0.5">
          <span className="text-ink-dim">资金加权收益率</span>
          <span className="num ml-auto text-ink">{point.mwrPct >= 0 ? '+' : ''}{(point.mwrPct * 100).toFixed(2)}%</span>
        </div>
      )}
      {point.benchPct != null && (
        <div className="flex items-center gap-4 py-0.5">
          <span className="text-ink-dim">{benchmarkLabel}基准</span>
          <span className="num ml-auto text-violet">{point.benchPct >= 0 ? '+' : ''}{(point.benchPct * 100).toFixed(2)}%</span>
        </div>
      )}
    </div>
  )
}

/** 单百分比轴：时间加权 vs 资金加权（Modified Dietz）vs 基准的累计收益率曲线。 */
export function PortfolioPctChart({ data, benchmarkLabel = '基准' }: { data: PortfolioReturnDatum[]; benchmarkLabel?: string }) {
  // 显式刻度：窄区间下 recharts 自动刻度格式化后会重名
  let pctLo = 0
  let pctHi = 0
  for (const d of data) {
    if (d.pct < pctLo) pctLo = d.pct
    if (d.pct > pctHi) pctHi = d.pct
    if (d.mwrPct != null) {
      if (d.mwrPct < pctLo) pctLo = d.mwrPct
      if (d.mwrPct > pctHi) pctHi = d.mwrPct
    }
    if (d.benchPct != null) {
      if (d.benchPct < pctLo) pctLo = d.benchPct
      if (d.benchPct > pctHi) pctHi = d.benchPct
    }
  }
  const pctTicks = niceTicks(pctLo, pctHi)
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gPortfolioPct" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.info} stopOpacity={0.18} />
            <stop offset="100%" stopColor={C.info} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.line} strokeDasharray="2 8" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={64}
        />
        <YAxis
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={54}
          domain={['auto', 'auto']}
          ticks={pctTicks}
          tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
        />
        <Tooltip content={<PortfolioPctTooltip benchmarkLabel={benchmarkLabel} />} />
        <ReferenceLine y={0} stroke={C.inkFaint} strokeDasharray="4 7" />
        <Area
          type="monotone"
          dataKey="pct"
          name="时间加权"
          stroke={C.info}
          strokeWidth={2.25}
          fill="url(#gPortfolioPct)"
          dot={false}
          isAnimationActive={false}
        />
        {data.some((d) => d.mwrPct != null) && (
          <Line
            type="monotone"
            dataKey="mwrPct"
            name="资金加权"
            stroke={C.amber}
            strokeWidth={1.75}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
        {data.some((d) => d.benchPct != null) && (
          <Line
            type="monotone"
            dataKey="benchPct"
            name={`${benchmarkLabel}基准`}
            stroke={C.violet}
            strokeWidth={1.5}
            strokeDasharray="2 6"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** 单金额轴曲线：累计收益金额（amber）或可投资资产（info）随区间变化。 */
export function PortfolioMoneyChart({ data, dataKey, name }: { data: PortfolioReturnDatum[]; dataKey: 'amount' | 'netWorth'; name: string }) {
  const color = dataKey === 'amount' ? C.amber : C.info
  const gradientId = `gPortfolioMoney-${dataKey}`
  // 显式刻度：窄区间下 recharts 自动刻度格式化后会重名
  let lo = 0
  let hi = 0
  for (const d of data) {
    const value = d[dataKey]
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  const ticks = niceTicks(lo, hi)
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.line} strokeDasharray="2 8" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={64}
        />
        <YAxis
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={72}
          domain={['auto', 'auto']}
          ticks={ticks}
          tickFormatter={fmtCNYAxis}
        />
        <Tooltip content={<DarkTooltip />} />
        {dataKey === 'amount' && <ReferenceLine y={0} stroke={C.inkFaint} strokeDasharray="4 7" />}
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={2.25}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function Donut({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={168}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={2} stroke={C.panel} strokeWidth={2}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip content={<DarkTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export interface TradeMarker {
  date: string // YYYY-MM-DD（已吸附到图表内的交易日）
  price: number // 交易单价（原币，与曲线同口径）
  type: 'BUY' | 'SELL'
  qty: number
  amount: number
  note?: string
}

/** 买卖点圆点：颜色区分买卖，SVG title 悬停显示交易摘要（ReferenceDot shape，闭包捕获交易） */
function markerShape(m: TradeMarker) {
  return (props: any) => {
    const { cx, cy } = props
    if (cx == null || cy == null) return <g />
    const color = m.type === 'BUY' ? C.up : C.down
    const label = m.type === 'BUY' ? '买入' : '卖出'
    return (
      <g>
        <circle cx={cx} cy={cy} r={4.5} fill={color} stroke="#101214" strokeWidth={1.5} />
        <title>{`${label} ${m.qty > 0 ? fmtQty(m.qty) : ''} @ ${fmtPrice(m.price)}${m.note ? ` · ${m.note}` : ''}`}</title>
      </g>
    )
  }
}

export function PriceLineChart({
  data,
  color = C.accent,
  markers = [],
}: {
  data: { date: string; close: number }[]
  color?: string
  markers?: TradeMarker[]
}) {
  // 显式刻度：净值类窄价格区间下自动刻度格式化后会重名
  let lo = Infinity
  let hi = -Infinity
  for (const d of data) {
    if (d.close < lo) lo = d.close
    if (d.close > hi) hi = d.close
  }
  const ticks = niceTicks(lo, hi)
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gPx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.line} strokeDasharray="2 8" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: C.inkFaint, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} minTickGap={60} />
        <YAxis
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={64}
          domain={['auto', 'auto']}
          ticks={ticks}
          tickFormatter={fmtAxis}
        />
        <Tooltip content={<DarkTooltip money={false} />} />
        <Area type="monotone" dataKey="close" name="收盘价" stroke={color} strokeWidth={1.5} fill="url(#gPx)" dot={false} />
        {markers.map((m) => (
          <ReferenceDot key={`${m.date}-${m.type}`} x={m.date} y={m.price} shape={markerShape(m)} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface IntradayDatum {
  time: string
  pnl: number
  value: number
  /** 选中标的在该分钟的当日盈亏（人民币）；该标的此时没有分钟数据时为 null。 */
  assetPnl?: number | null
}

/** 当日盈亏 tooltip（含选中标的与组合市值） */
function IntradayTooltip({ active, payload, label, assetName }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as IntradayDatum
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      <div className="num mb-1 text-ink-faint">{label}</div>
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-ink-dim">当日盈亏</span>
        <span className={`num ml-auto pl-3 ${d.pnl >= 0 ? 'text-up' : 'text-down'}`}>{fmtCNY(d.pnl, { sign: true })}</span>
      </div>
      {assetName && d.assetPnl != null && (
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-ink-dim">{assetName}</span>
          <span className={`num ml-auto pl-3 ${d.assetPnl >= 0 ? 'text-up' : 'text-down'}`}>{fmtCNY(d.assetPnl, { sign: true })}</span>
        </div>
      )}
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-ink-dim">组合市值</span>
        <span className="num ml-auto pl-3 text-ink">{fmtCNY(d.value)}</span>
      </div>
    </div>
  )
}

/** 图例色板：组合与选中标的都用财务涨跌色，靠虚实线区分。 */
function pnlColor(value: number): string {
  return value >= 0 ? C.up : C.down
}

/**
 * 当日收益曲线（相对昨收的组合盈亏；Y 域 = 当日盈亏极值 + 15% 余量）。
 * 选中单个标的后叠加该标的同口径曲线：点表格行即可看清「今天是谁在拖累组合」。
 */
export function IntradayChart({
  data,
  assetName,
  showAsset = false,
}: {
  data: IntradayDatum[]
  assetName?: string
  showAsset?: boolean
}) {
  const last = data.length > 0 ? data[data.length - 1].pnl : 0
  const color = pnlColor(last)
  const assetLast = data.length > 0 ? data[data.length - 1].assetPnl : null
  const assetColor = assetLast == null ? C.info : pnlColor(assetLast)
  // 以当日盈亏极值定坐标上下限（含 0 轴），波动不再被总资产量级压平；
  // 叠加标的时把它的极值也纳入，否则小仓位标的会被组合量级压成一条直线。
  let lo = 0
  let hi = 0
  for (const d of data) {
    if (d.pnl < lo) lo = d.pnl
    if (d.pnl > hi) hi = d.pnl
    if (showAsset && d.assetPnl != null) {
      if (d.assetPnl < lo) lo = d.assetPnl
      if (d.assetPnl > hi) hi = d.assetPnl
    }
  }
  const span = hi - lo
  const pad = span > 0 ? span * 0.15 : Math.max(Math.abs(hi || lo) * 0.1, 100)
  const domain: [number, number] = [lo - pad, hi + pad]
  // 显式漂亮数刻度：窄盈亏域下 recharts 自动刻度经 fmtCNY 格式化后会重名/错位
  const ticks = niceTicks(domain[0], domain[1])
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gDay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="time" tick={{ fill: C.inkFaint, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={80} />
        <YAxis
          tick={{ fill: C.inkFaint, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={84}
          domain={domain}
          ticks={ticks}
          tickFormatter={(v: number) => fmtCNY(v, { compact: true })}
        />
        <Tooltip content={<IntradayTooltip assetName={showAsset ? assetName : undefined} />} />
        <ReferenceLine y={0} stroke={C.line} />
        <Area type="monotone" dataKey="pnl" name="当日盈亏" stroke={color} strokeWidth={2.25} fill="url(#gDay)" dot={false} isAnimationActive={false} />
        {showAsset && (
          <Line
            type="monotone"
            dataKey="assetPnl"
            name={assetName ?? '选中标的'}
            className="watch-asset-curve"
            stroke={assetColor}
            strokeWidth={1.75}
            strokeDasharray="5 3"
            dot={false}
            /* 不 connectNulls：该标的没有分钟数据的时段必须断开，不能被画成连续走势 */
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ---------- K 线（蜡烛图） ----------

export interface CandleDatum {
  date: string
  open: number
  close: number
  high: number
  low: number
}

function CandleShape(props: any) {
  const { x, y, width, height, payload } = props
  const span = payload.high - payload.low
  const ratio = span > 0 ? height / span : 0
  const isUp = payload.close >= payload.open
  const color = isUp ? C.up : C.down
  const center = x + width / 2
  const bodyTop = y + (payload.high - Math.max(payload.open, payload.close)) * ratio
  const bodyH = Math.max(1, Math.abs(payload.close - payload.open) * ratio)
  return (
    <g>
      <line x1={center} y1={y} x2={center} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x + 0.5} y={bodyTop} width={Math.max(1, width - 1)} height={bodyH} fill={color} fillOpacity={0.85} stroke={color} strokeWidth={0.5} />
    </g>
  )
}

function CandleTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as CandleDatum
  const changePct = d.open > 0 ? d.close / d.open - 1 : 0
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      <div className="num mb-1 text-ink-faint">{label}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-ink-dim">开盘</span>
        <span className="num text-right text-ink">{fmtPrice(d.open)}</span>
        <span className="text-ink-dim">收盘</span>
        <span className="num text-right text-ink">{fmtPrice(d.close)}</span>
        <span className="text-ink-dim">最高</span>
        <span className="num text-right text-ink">{fmtPrice(d.high)}</span>
        <span className="text-ink-dim">最低</span>
        <span className="num text-right text-ink">{fmtPrice(d.low)}</span>
      </div>
      <div className={`num mt-1 text-right ${changePct >= 0 ? 'text-up' : 'text-down'}`}>
        {changePct >= 0 ? '+' : ''}
        {(changePct * 100).toFixed(2)}%
      </div>
    </div>
  )
}

export function CandleChart({
  data,
  color = C.accent,
  markers = [],
}: {
  data: CandleDatum[]
  color?: string
  markers?: TradeMarker[]
}) {
  void color
  const ranged = data.map((d) => ({ ...d, range: [d.low, d.high] }))
  // 显式刻度：净值类窄价格区间下自动刻度格式化后会重名
  let lo = Infinity
  let hi = -Infinity
  for (const d of data) {
    if (d.low < lo) lo = d.low
    if (d.high > hi) hi = d.high
  }
  const ticks = niceTicks(lo, hi)
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={ranged} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 8" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: C.inkFaint, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} minTickGap={60} />
        <YAxis domain={['auto', 'auto']} tick={{ fill: C.inkFaint, fontSize: 11 }} tickLine={false} axisLine={false} width={64} ticks={ticks} tickFormatter={fmtAxis} />
        <Tooltip content={<CandleTooltip />} />
        <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} maxBarSize={8} />
        {markers.map((m) => (
          <ReferenceDot key={`${m.date}-${m.type}`} x={m.date} y={m.price} shape={markerShape(m)} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
export interface ProjectionDatum {
  label: string
  base: number // 透明基座 = p10
  band: number // p90 - p10
  p50: number
  target: number
}

export function ProjectionChart({
  data,
  target,
  targetLabel = '目标',
  dynamicTarget = false,
}: {
  data: ProjectionDatum[]
  target: number
  targetLabel?: string
  dynamicTarget?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 8" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: C.inkFaint, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} minTickGap={60} />
        <YAxis
          tick={{ fill: C.inkFaint, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={64}
          domain={['auto', 'auto']}
          tickFormatter={fmtAxis}
        />
        <Tooltip content={<DarkTooltip />} />
        <Area dataKey="base" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} name="base" />
        <Area dataKey="band" stackId="band" stroke="none" fill={C.info} fillOpacity={0.14} name="P10–P90 区间" isAnimationActive={false} />
        <Line type="monotone" dataKey="p50" name="中位路径" stroke={C.accent} strokeWidth={1.5} dot={false} />
        {dynamicTarget ? (
          <Line type="monotone" dataKey="target" name={targetLabel} stroke={C.up} strokeWidth={1.25} strokeDasharray="4 6" dot={false} isAnimationActive={false} />
        ) : (
          <ReferenceLine y={target} stroke={C.up} strokeDasharray="4 6" label={{ value: targetLabel, fill: C.up, fontSize: 11, position: 'insideTopRight' }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface SavingsRateDatum {
  month: string
  label: string
  rate: number | null
}

function SavingsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length || payload[0].value == null) return null
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      <div className="num text-ink-faint">{label}</div>
      <div className="mt-1 flex items-center gap-4">
        <span className="text-ink-dim">储蓄率</span>
        <span className="num text-ink">{(Number(payload[0].value) * 100).toFixed(1)}%</span>
      </div>
    </div>
  )
}

export function SavingsRateChart({ data, target = 0.3 }: { data: SavingsRateDatum[]; target?: number }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" tick={{ fill: C.inkFaint, fontSize: 12 }} tickLine={false} axisLine={{ stroke: C.line }} minTickGap={32} />
        <YAxis
          tick={{ fill: C.inkFaint, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={48}
          /* 负储蓄率（当月净流出）必须可见：下限交给数据而不是钉在 0 */
          domain={['auto', 'auto']}
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
        />
        <Tooltip content={<SavingsTooltip />} />
        <ReferenceLine
          y={target}
          stroke={C.inkFaint}
          strokeDasharray="4 7"
          label={{ value: `计划 ${Math.round(target * 100)}%`, fill: C.inkFaint, fontSize: 11, position: 'insideTopRight' }}
        />
        {/* 不 connectNulls：缺流水的月份断开，避免把「没有数据」画成连续趋势 */}
        <Line type="monotone" dataKey="rate" name="储蓄率" stroke={C.info} strokeWidth={2} dot={{ r: 3, fill: C.info, strokeWidth: 0 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
