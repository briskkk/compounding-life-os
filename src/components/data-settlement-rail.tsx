import Link from 'next/link'
import type { DataSettlementState } from '@/lib/engine/data-settlement'
import { cx } from '@/lib/format'

export function DataSettlementRail({ state }: { state: DataSettlementState }) {
  const missingQuotes = Math.max(0, state.liveAssetCount - state.liveQuotedCount)
  const needsAttention = missingQuotes > 0
    || state.settledStatus === 'PARTIAL'
    || state.settledStatus === 'NO_UPDATE'
    || state.settledGapCount > 0
  const settledLabel = state.settledStatus === 'SETTLED' ? '最近完整收盘' : '最近历史数据'
  const title = state.liveAssetCount === 0
    ? '暂无需要行情更新的持仓'
    : missingQuotes > 0
      ? `${missingQuotes} 项持仓行情待更新`
      : needsAttention
        ? '历史收盘数据仍有缺口'
        : `行情已覆盖全部 ${state.liveAssetCount} 项持仓`

  return (
    <section className={cx('data-settlement-status', needsAttention && 'is-warning')} aria-label="行情数据状态">
      <i aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>
          最新行情 {state.liveDate}
          <b>·</b>{settledLabel} {state.settledDate ?? '尚无'}
        </span>
      </div>
      <Link href="/health">查看数据状态 →</Link>
    </section>
  )
}
