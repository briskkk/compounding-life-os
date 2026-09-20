'use client'

// 看盘实时估值表的筛选条：名称/代码搜索、资产大类、未计入今日盈亏。
// 与排序一样把状态写进 URL，但用 history.replaceState + popstate 同步，
// 不触发服务端重新取数（这张表每 30 秒自轮询报价）。
import type { AssetClass } from '@prisma/client'
import { cx } from '@/lib/format'
// 取值与 URL 解析放在纯引擎模块里：'use client' 模块的导出在服务端会编译成客户端引用，
// 服务端组件（/watch 页面）直接调用会报 "Attempted to call … is on the client"。
import {
  WATCH_FILTER_CLASSES,
  WATCH_OTHER_CLASS,
  type WatchClassFilter,
  type WatchFilterValue,
} from '@/lib/engine/watch-filter'

export type HoldingFilterValue = WatchFilterValue

export function HoldingFilterBar({
  value,
  classCounts,
  matched,
  total,
  onChange,
}: {
  value: HoldingFilterValue
  /** 按 chip 统计的标的数；未出现的大类不渲染 chip。 */
  classCounts: Map<WatchClassFilter, number>
  matched: number
  total: number
  onChange: (next: HoldingFilterValue) => void
}) {
  const hasFilter = value.query.trim() !== '' || value.classFilter != null || value.onlyExcluded

  function patch(next: Partial<HoldingFilterValue>) {
    onChange({ ...value, ...next })
  }

  return (
    <div
      role="search"
      aria-label="看盘标的筛选"
      className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-3"
    >
      <input
        type="search"
        value={value.query}
        onChange={(event) => patch({ query: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') patch({ query: '' })
        }}
        placeholder="搜索名称或代码"
        aria-label="搜索标的名称或代码"
        className="watch-filter-search num"
      />
      <div className="flex flex-wrap items-center gap-2">
        {WATCH_FILTER_CLASSES.filter((cls) => (classCounts.get(cls) ?? 0) > 0).map((cls) => (
          <button
            key={cls}
            type="button"
            aria-pressed={value.classFilter === cls}
            onClick={() => patch({ classFilter: value.classFilter === cls ? null : cls })}
            className={cx('watch-filter-chip', value.classFilter === cls && 'is-active')}
          >
            {CLASS_CHIP_LABEL[cls]} <span className="num">({classCounts.get(cls)})</span>
          </button>
        ))}
        {(classCounts.get(WATCH_OTHER_CLASS) ?? 0) > 0 && (
          <button
            type="button"
            aria-pressed={value.classFilter === WATCH_OTHER_CLASS}
            onClick={() => patch({ classFilter: value.classFilter === WATCH_OTHER_CLASS ? null : WATCH_OTHER_CLASS })}
            className={cx('watch-filter-chip', value.classFilter === WATCH_OTHER_CLASS && 'is-active')}
          >
            其他 <span className="num">({classCounts.get(WATCH_OTHER_CLASS)})</span>
          </button>
        )}
        <button
          type="button"
          aria-pressed={value.onlyExcluded}
          onClick={() => patch({ onlyExcluded: !value.onlyExcluded })}
          title="只留没有计入今日盈亏的标的：无行情、或行情归属日不是北京今天"
          className={cx('watch-filter-chip', value.onlyExcluded && 'is-active')}
        >
          未计入今日盈亏
        </button>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="num text-[12px] text-ink-faint" role="status" data-testid="watch-filter-count">
          显示 {matched} / {total} 个标的
        </span>
        {hasFilter && (
          <button
            type="button"
            onClick={() => onChange({ query: '', classFilter: null, onlyExcluded: false })}
            className="text-[12px] text-ink-faint transition-colors hover:text-ink"
          >
            清除筛选 ×
          </button>
        )}
      </div>
    </div>
  )
}

const CLASS_CHIP_LABEL: Record<AssetClass, string> = {
  STOCK: '股票',
  ETF: 'ETF',
  FUND: '基金',
  GOLD: '黄金',
  CASH: '现金',
  REAL_ESTATE: '房产',
  HUAWEI_STOCK: '长期持股',
}
