'use client'

// 组合构成：维度切换（资产大类 / 投资风格 / 市场分组）+ 环形图与图例
import { useState } from 'react'
import { Donut } from './charts'
import { Empty } from './ui'
import { fmtCNY, fmtPct } from '@/lib/format'

export interface CompositionSliceView {
  name: string
  value: number
  pct: number // 0–1
  color: string
}

export interface CompositionDimension {
  key: string
  label: string
  caption?: string
  slices: CompositionSliceView[]
}

export function CompositionChart({ dimensions }: { dimensions: CompositionDimension[] }) {
  const [active, setActive] = useState(0)
  const dim = dimensions[active] ?? dimensions[0]
  if (!dim) return null
  const total = dim.slices.reduce((sum, s) => sum + s.value, 0)
  return (
    <div>
      <div className="composition-grid">
        <div className="composition-dims" role="group" aria-label="构成维度">
          {dimensions.map((d, i) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={i === active}
              className="history-range-button"
              onClick={() => setActive(i)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {dim.slices.length === 0 ? (
          <Empty>该维度暂无可统计的持仓</Empty>
        ) : (
          <>
            <div className="composition-donut">
              <Donut data={dim.slices} />
              <div className="composition-donut-center" aria-hidden="true">
                <span>{dim.label}总计</span>
                <strong className="num">{fmtCNY(total, { compact: true })}</strong>
              </div>
            </div>
            <ul className="composition-legend">
              {dim.slices.map((s) => (
                <li key={s.name}>
                  <div className="composition-legend-row">
                    <i className="composition-legend-dot" style={{ background: s.color }} />
                    <span className="composition-legend-name">{s.name}</span>
                    <span className="num composition-legend-amount">{fmtCNY(s.value)}</span>
                    <span className="num composition-legend-pct">{fmtPct(s.pct)}</span>
                  </div>
                  <div className="composition-legend-track" aria-hidden="true">
                    <i style={{ width: `${Math.max(s.pct * 100, 0.8)}%`, background: s.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {dim.caption && <p className="mt-4 text-[13px] leading-relaxed text-ink-faint">{dim.caption}</p>}
    </div>
  )
}
