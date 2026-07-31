'use client'

// 图表组件（recharts，深色终端主题）
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { C } from '@/lib/colors'
import { fmtCNY, fmtPrice } from '@/lib/format'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Y 轴格式化：万/亿以上缩写；<10 按净值惯例 4 位小数；其余 2 位小数 */
function fmtAxis(v: number): string {
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
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color ?? p.stroke ?? C.gold }} />
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

export function WealthChart({ data }: { data: WealthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
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
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip content={<DarkTooltip />} />
        <Area type="monotone" dataKey="netWorth" name="净资产" stroke={C.info} strokeWidth={2.25} fill="url(#gNW)" dot={false} isAnimationActive={false} />
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

export function PriceLineChart({ data, color = C.gold }: { data: { date: string; close: number }[]; color?: string }) {
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
          tickFormatter={fmtAxis}
        />
        <Tooltip content={<DarkTooltip money={false} />} />
        <Area type="monotone" dataKey="close" name="收盘价" stroke={color} strokeWidth={1.5} fill="url(#gPx)" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface IntradayDatum {
  time: string
  pnl: number
  value: number
}

/** 当日盈亏 tooltip（含组合市值） */
function IntradayTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as IntradayDatum
  return (
    <div className="rounded border border-line bg-panel2 px-3 py-2 text-xs shadow-2xl">
      <div className="num mb-1 text-ink-faint">{label}</div>
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-ink-dim">当日盈亏</span>
        <span className={`num ml-auto pl-3 ${d.pnl >= 0 ? 'text-up' : 'text-down'}`}>{fmtCNY(d.pnl, { sign: true })}</span>
      </div>
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-ink-dim">组合市值</span>
        <span className="num ml-auto pl-3 text-ink">{fmtCNY(d.value)}</span>
      </div>
    </div>
  )
}

/** 当日收益曲线（相对昨收的组合盈亏；Y 域 = 当日盈亏极值 + 15% 余量） */
export function IntradayChart({ data }: { data: IntradayDatum[] }) {
  const last = data.length > 0 ? data[data.length - 1].pnl : 0
  const color = last >= 0 ? C.up : C.down
  // 以当日盈亏极值定坐标上下限（含 0 轴），波动不再被总资产量级压平
  let lo = 0
  let hi = 0
  for (const d of data) {
    if (d.pnl < lo) lo = d.pnl
    if (d.pnl > hi) hi = d.pnl
  }
  const span = hi - lo
  const pad = span > 0 ? span * 0.15 : Math.max(Math.abs(hi || lo) * 0.1, 100)
  const domain: [number, number] = [lo - pad, hi + pad]
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
          width={72}
          domain={domain}
          tickFormatter={(v: number) => fmtCNY(v)}
        />
        <Tooltip content={<IntradayTooltip />} />
        <ReferenceLine y={0} stroke={C.line} />
        <Area type="monotone" dataKey="pnl" name="当日盈亏" stroke={color} strokeWidth={2.25} fill="url(#gDay)" dot={false} isAnimationActive={false} />
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

export function CandleChart({ data, color = C.gold }: { data: CandleDatum[]; color?: string }) {
  void color
  const ranged = data.map((d) => ({ ...d, range: [d.low, d.high] }))
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={ranged} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.line} strokeDasharray="2 8" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: C.inkFaint, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.line }} minTickGap={60} />
        <YAxis domain={['auto', 'auto']} tick={{ fill: C.inkFaint, fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={fmtAxis} />
        <Tooltip content={<CandleTooltip />} />
        <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} maxBarSize={8} />
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

export function ProjectionChart({ data, target, targetLabel = '目标' }: { data: ProjectionDatum[]; target: number; targetLabel?: string }) {
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
        <Line type="monotone" dataKey="p50" name="中位路径" stroke={C.gold} strokeWidth={1.5} dot={false} />
        <ReferenceLine y={target} stroke={C.up} strokeDasharray="4 6" label={{ value: targetLabel, fill: C.up, fontSize: 11, position: 'insideTopRight' }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
