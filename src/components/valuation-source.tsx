import type { PriceSource } from '@/lib/engine/types'
import {
  marketValuationSource,
  positionValuationSource,
  type ValuationSourceMeta,
} from '@/lib/valuation-source'
import { cx, fmtCNY } from '@/lib/format'
import { Tag } from './ui'

export function SourceTag({ meta, showProvider = false }: { meta: ValuationSourceMeta; showProvider?: boolean }) {
  return (
    <span title={!showProvider && meta.provider ? `${meta.provider} · ${meta.description}` : meta.description} className="inline-flex">
      <Tag tone={meta.tone}>
        {meta.label}
        {showProvider && meta.provider ? ` · ${meta.provider}` : ''}
      </Tag>
    </span>
  )
}

/** 模型估值置信度分档（%）：低于此值视为低置信，来源列弱化标注 */
const LOW_CONFIDENCE_FLOOR = 50

export function MarketSourceTag({
  source,
  showProvider = false,
  confidencePct,
}: {
  source: string | null | undefined
  showProvider?: boolean
  confidencePct?: number | null
}) {
  const meta = marketValuationSource(source)
  const lowConfidence = confidencePct != null && confidencePct < LOW_CONFIDENCE_FLOOR
  const display = lowConfidence
    ? {
        ...meta,
        label: '低置信估算',
        tone: 'dim' as const,
        description: `${meta.description} 当前模型置信度 ${Math.round(confidencePct)}%，估算偏差可能较大。`,
      }
    : meta
  return <SourceTag meta={display} showProvider={showProvider} />
}

export function PositionSourceTag({
  priceSource,
  marketSource,
  showProvider = false,
  confidencePct,
}: {
  priceSource: PriceSource
  marketSource?: string | null
  showProvider?: boolean
  confidencePct?: number | null
}) {
  if (priceSource === 'MARKET') {
    return (
      <MarketSourceTag
        source={marketSource}
        showProvider={showProvider}
        confidencePct={confidencePct}
      />
    )
  }
  return <SourceTag meta={positionValuationSource(priceSource, marketSource)} showProvider={showProvider} />
}

export interface ValuationSummaryItem {
  priceSource: PriceSource
  marketSource?: string | null
  value: number
}

export function ValuationSourceSummary({ items }: { items: ValuationSummaryItem[] }) {
  const groups = {
    observed: { count: 0, value: 0 },
    estimated: { count: 0, value: 0 },
    fallback: { count: 0, value: 0 },
  }
  for (const item of items) {
    const meta = positionValuationSource(item.priceSource, item.marketSource)
    groups[meta.quality].count++
    groups[meta.quality].value += item.value
  }
  if (!items.length) return null
  const rows = [
    { key: 'observed', label: '可观测数据', dot: 'bg-info' },
    { key: 'estimated', label: '手动估值', dot: 'bg-violet' },
    { key: 'fallback', label: '回退/模拟', dot: 'bg-amber' },
  ] as const

  return (
    <details className="text-[13px] text-ink-dim">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2">
        <span>估值来源明细</span>
        {groups.fallback.count > 0 && <span className="text-amber">{groups.fallback.count} 项回退/模拟</span>}
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="flex flex-wrap gap-x-5 gap-y-2 pb-2">
        {rows.filter(({ key }) => groups[key].count > 0).map(({ key, label, dot }) => (
          <span key={key}>
            <i aria-hidden="true" className={cx('mr-1.5 inline-block h-1.5 w-1.5 rounded-full', dot)} />
            {label} <span className="num text-ink">{groups[key].count} 项 · {fmtCNY(groups[key].value)}</span>
          </span>
        ))}
      </div>
    </details>
  )
}
