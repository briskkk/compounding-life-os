// 决策时间带：把三条信息叠在一条时间轴上 —— 净值价值路径 + 每季买卖笔数 + 净值缺口。
// 真实坐标 SVG：X 轴按日期、Y 轴按金额，文字正常渲染不拉伸；
// 事件以季度为单位聚合（避免 434 笔逐点堆叠），缺口以连续段聚合。
import type { PerformancePoint } from '@/lib/engine/period-performance'
import { bucketEventsByQuarter, summarizeGapSegments, type SleeveEventPoint } from '@/lib/engine/investment-history'
import { fmtCNY } from '@/lib/format'

const W = 1200
const H = 408
const PAD = { l: 118, r: 24, t: 24 }
const VALUE_BOTTOM = 268
const LANE_TOP = 290
const LANE_BOTTOM = 334
const YEAR_Y = 368

function niceCeil(value: number): number {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const norm = value / pow
  const ceil = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return ceil * pow
}

export function InvestmentHistoryBand({
  series,
  events,
  startDate,
  endDate,
  openingValue,
  netInflow,
  investGain,
  endingValue,
}: {
  series: PerformancePoint[]
  events: SleeveEventPoint[]
  startDate: string
  endDate: string
  openingValue: number | null
  netInflow: number | null
  investGain: number | null
  endingValue: number | null
}) {
  const points = series.filter((p) => p.date >= startDate && p.date <= endDate)
  if (points.length < 2) {
    return <p className="review-empty">区间内没有可绘制的净值观察点。</p>
  }

  const startMs = new Date(`${startDate}T00:00:00Z`).getTime()
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime()
  const span = Math.max(1, endMs - startMs)
  const xAt = (date: string) =>
    PAD.l + ((new Date(`${date}T00:00:00Z`).getTime() - startMs) / span) * (W - PAD.l - PAD.r)

  // —— 金额域（Y 轴，完整精度刻度）——
  const values = points.map((p) => p.netWorth)
  const dataMin = Math.min(...values, 0)
  const dataMax = Math.max(...values, 1)
  const yMax = niceCeil(dataMax)
  const yMin = dataMin < 0 ? -niceCeil(Math.abs(dataMin)) : 0
  const ySpan = Math.max(yMax - yMin, 1e-9)
  const yAt = (v: number) => PAD.t + ((yMax - v) / ySpan) * (VALUE_BOTTOM - PAD.t)

  const ticks: number[] = []
  const TICK = 5
  for (let i = 0; i <= TICK; i++) ticks.push(yMin + (ySpan * i) / TICK)

  // —— 缺口段（净值沿用旧值，聚合为连续段）——
  const gaps = summarizeGapSegments(points, 3)
  const gapTotalDays = gaps.reduce((sum, g) => sum + g.days, 0)

  // —— 事件按季度聚合 ——
  const quarters = bucketEventsByQuarter(events, startDate, endDate)
  const buyEvents = events.filter((e) => e.direction === 'BUY').length
  const sellEvents = events.length - buyEvents
  const maxQuarterCount = Math.max(1, ...quarters.map((q) => Math.max(q.buyCount, q.sellCount)))
  const slotW = quarters.length > 0 ? (W - PAD.l - PAD.r) / quarters.length : 1
  const barW = Math.min(26, Math.max(6, slotW * 0.28))
  const laneH = LANE_BOTTOM - LANE_TOP - 8
  const qxAt = (quarter: string) => {
    const [year, q] = quarter.split('-Q')
    const midMonth = (Number(q) - 1) * 3 + 2
    return xAt(`${year}-${String(midMonth).padStart(2, '0')}-15`)
  }

  // —— 折线降采样（59k 点 → ≤ 900 段，坐标仍真实）——
  const step = Math.max(1, Math.ceil(points.length / 900))
  const polyline = points
    .filter((_, index) => index % step === 0 || index === points.length - 1)
    .map((p) => `${xAt(p.date).toFixed(1)},${yAt(p.netWorth).toFixed(1)}`)
    .join(' ')

  // —— 年份刻度（用该年实际观察点的中点，避免把刻度画到绘图区外）——
  const yearBounds = new Map<string, { first: string; last: string }>()
  for (const p of points) {
    const y = p.date.slice(0, 4)
    const bound = yearBounds.get(y)
    if (bound) bound.last = p.date
    else yearBounds.set(y, { first: p.date, last: p.date })
  }
  const years: Array<{ y: string; x: number }> = []
  for (const [y, { first, last }] of yearBounds) {
    years.push({ y, x: (xAt(first) + xAt(last)) / 2 })
  }
  years.sort((a, b) => a.y.localeCompare(b.y))

  // —— 顶部一句话结论 ——
  const parts: string[] = []
  if (endingValue != null) parts.push(`期末价值 ${fmtCNY(endingValue)}`)
  if (investGain != null && openingValue != null && netInflow != null) {
    parts.push(`= 期初 ${fmtCNY(openingValue)} + 外部净投入 ${fmtCNY(netInflow)} + 投资收益 ${fmtCNY(investGain)}（可投资组合口径）`)
  }
  if (events.length > 0) {
    parts.push(`区间内买入 ${buyEvents} 笔、卖出 ${sellEvents} 笔，集中在 ${quarters.length} 个季度`)
  }
  if (gaps.length > 0) {
    parts.push(`净值缺口 ${gaps.length} 段（合计约 ${gapTotalDays} 天沿用旧值，见灰色竖带）`)
  }

  return (
    <div className="ii-band-surface" aria-label="决策时间带">
      <div className="ii-band-takeaway">
        <b>怎么读这张图</b>
        <p>曲线＝全部可投资资产的每日价值；柱条＝季度买卖笔数；灰带＝沿用旧值的时段。柱条与灰带不代表盈亏方向。</p>
      </div>
      <p className="ii-band-summary">{parts.length > 0 ? parts.join('；') : '区间数据不足，无法生成一句话结论。'}</p>
      <div className="ii-band-legend" aria-hidden="true">
        <span><i className="l-line" />净值价值</span>
        <span className="l-buy"><i className="l-sq" />买入笔数</span>
        <span className="l-sell"><i className="l-sq" />卖出笔数</span>
        <span><i className="l-gap" />净值缺口（沿用旧值）</span>
      </div>
      <div className="ii-band-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${startDate} 至 ${endDate} 净值价值、季度买卖笔数与净值缺口时间带`}>
          {/* 缺口段 */}
          {gaps.map((gap) => (
            <g key={`${gap.from}-${gap.to}`}>
              <rect
                x={xAt(gap.from)}
                y={PAD.t}
                width={Math.max(2, xAt(gap.to) - xAt(gap.from))}
                height={VALUE_BOTTOM - PAD.t}
                style={{ fill: 'color-mix(in srgb, var(--color-ink-faint) 14%, transparent)' }}
              />
              <title>{`净值缺口 ${gap.from} → ${gap.to}（约 ${gap.days} 天沿用旧值）`}</title>
            </g>
          ))}
          {/* 金额网格与刻度 */}
          {ticks.map((tick) => {
            const y = yAt(tick)
            return (
              <g key={`tick-${tick}`}>
                <line
                  x1={PAD.l}
                  y1={y}
                  x2={W - PAD.r}
                  y2={y}
                  style={{ stroke: 'var(--color-line)', strokeWidth: 1 }}
                />
                <text
                  x={PAD.l - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  style={{ fill: 'var(--color-ink-faint)', fontVariantNumeric: 'tabular-nums' }}
                  className="num"
                >
                  {fmtCNY(tick)}
                </text>
              </g>
            )
          })}
          {/* 净值折线 */}
          <polyline
            points={polyline}
            fill="none"
            style={{ stroke: 'var(--color-accent)', strokeWidth: 2 }}
            vectorEffect="non-scaling-stroke"
          />
          {/* 活动带（季度买卖笔数） */}
          <text x={PAD.l} y={LANE_TOP - 6} fontSize={11} style={{ fill: 'var(--color-ink-faint)' }}>
            每季买卖笔数（柱高按区间内最大季度归一）
          </text>
          <line x1={PAD.l} y1={LANE_BOTTOM} x2={W - PAD.r} y2={LANE_BOTTOM} style={{ stroke: 'var(--color-line)', strokeWidth: 1 }} />
          {quarters.map((quarter) => {
            const rawCx = qxAt(quarter.quarter)
            const cx = Math.min(Math.max(rawCx, PAD.l + barW + 2), W - PAD.r - barW - 2)
            const buyH = (quarter.buyCount / maxQuarterCount) * laneH
            const sellH = (quarter.sellCount / maxQuarterCount) * laneH
            return (
              <g key={quarter.quarter}>
                <rect
                  x={cx - barW - 1.5}
                  y={LANE_BOTTOM - Math.max(buyH, quarter.buyCount > 0 ? 2 : 0)}
                  width={barW}
                  height={Math.max(buyH, quarter.buyCount > 0 ? 2 : 0)}
                  rx={1.5}
                  style={{ fill: 'var(--color-accent)' }}
                >
                  <title>{`${quarter.quarter} 买入 ${quarter.buyCount} 笔`}</title>
                </rect>
                <rect
                  x={cx + 1.5}
                  y={LANE_BOTTOM - Math.max(sellH, quarter.sellCount > 0 ? 2 : 0)}
                  width={barW}
                  height={Math.max(sellH, quarter.sellCount > 0 ? 2 : 0)}
                  rx={1.5}
                  style={{ fill: 'color-mix(in srgb, var(--color-ink-faint) 60%, var(--color-panel))' }}
                >
                  <title>{`${quarter.quarter} 卖出 ${quarter.sellCount} 笔`}</title>
                </rect>
              </g>
            )
          })}
          {/* 年份刻度 */}
          {years.map(({ y, x }, index) => (
            <text key={`${y}-${index}`} x={x} y={YEAR_Y} textAnchor="middle" fontSize={12} className="num" style={{ fill: 'var(--color-ink-faint)' }}>
              {y}
            </text>
          ))}
          <text x={PAD.l} y={YEAR_Y + 22} fontSize={10} style={{ fill: 'var(--color-ink-faint)' }} className="num">
            区间 {startDate} → {endDate}
          </text>
        </svg>
      </div>
      <p className="ii-band-note">
        买入/卖出沿用账本主腿笔数（内部结算与分红不作单独事件）；季度内多笔叠加为柱，不再逐点堆叠。
        更细的逐笔行为与前后窗口见“决策库”。
      </p>
    </div>
  )
}
