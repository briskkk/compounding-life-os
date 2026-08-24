import Link from 'next/link'
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
    <span title={meta.description} className="inline-flex">
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

export function ValuationSourceSummary({ items, className }: { items: ValuationSummaryItem[]; className?: string }) {
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
  const total = groups.observed.value + groups.estimated.value + groups.fallback.value

  return (
    <div className={cx('source-summary flex flex-wrap items-center gap-x-7 gap-y-3 px-5 py-4 text-[15px]', className)}>
      <span className="font-medium text-ink-dim">当前估值口径</span>
      <span className="text-ink-faint">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-down" />
        可观测数据 <span className="num text-ink">{groups.observed.count} 项 · {fmtCNY(groups.observed.value)}</span>
      </span>
      <span className="text-ink-faint">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-violet" />
        手动估值 <span className="num text-ink">{groups.estimated.count} 项 · {fmtCNY(groups.estimated.value)}</span>
      </span>
      <span className={groups.fallback.count > 0 ? 'text-amber' : 'text-ink-faint'}>
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber" />
        回退/模拟 <span className="num">{groups.fallback.count} 项 · {fmtCNY(groups.fallback.value)}</span>
      </span>
      <span className="ml-auto text-ink-faint">
        总计 <span className="num text-ink">{fmtCNY(total)}</span>
        <span className="mx-2">·</span>
        <Link href="/positions" className="hover:text-accent">查看来源明细 →</Link>
      </span>
    </div>
  )
}

export function ValuationLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-2 text-[12px] text-ink-faint', className)}>
      <span>来源说明：</span>
      <MarketSourceTag source="TENCENT" />
      <MarketSourceTag source="EASTMONEY-FUND" />
      <MarketSourceTag source="FUND-ENGINE" />
      <PositionSourceTag priceSource="MANUAL" />
      <PositionSourceTag priceSource="COST" />
      <MarketSourceTag source="SIMULATED" />
      <span className="ml-1">鼠标停留可查看口径。</span>
    </div>
  )
}
