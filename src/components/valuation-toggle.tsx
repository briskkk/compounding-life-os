'use client'

// 手动估值折叠区：默认收起，点击展开（不挤压持仓明细布局）
import { useId, useState, type ReactNode } from 'react'
import { ValuationForm } from './valuation-form'
import { cx } from '@/lib/format'

export function ValuationToggle({
  assets,
  actions,
}: {
  assets: { id: string; name: string; accountId: string; current: number | null }[]
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (assets.length === 0) return actions ?? null

  return (
    <div className="valuation-tools">
      <div className="valuation-tools-heading">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          title="更新房产等非行情资产的手动估值"
          className={cx(
            'flex w-full items-center justify-between px-4 py-2 text-left text-[14px] transition-colors',
            open ? 'border-b border-line text-accent' : 'text-ink-faint hover:text-ink-dim',
          )}
        >
          <span>手动估值</span>
          <span className="num text-[12px]">{open ? '▲ 收起' : '▼ 展开'}</span>
        </button>
        {actions}
      </div>
      {open && (
        <div id={id} className="border-b border-line bg-panel2/40 px-4 py-3.5">
          <ValuationForm assets={assets} />
        </div>
      )}
    </div>
  )
}
